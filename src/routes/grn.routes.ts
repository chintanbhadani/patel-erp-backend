import { Router, Request, Response } from 'express';
import { PrismaClient, GrnStatus } from '@prisma/client';
import { logActivity } from '../services/activityLogger';

const router = Router();
const prisma = new PrismaClient();

async function generateNextGrnId(transactionDate?: string): Promise<string> {
  const now = transactionDate ? new Date(transactionDate) : new Date();
  const validDate = isNaN(now.getTime()) ? new Date() : now;
  const yearStr = validDate.getFullYear().toString();
  const monthStr = (validDate.getMonth() + 1).toString().padStart(2, '0');
  const prefix = `PS-GR-${yearStr}-${monthStr}-`;

  let maxSeq = 0;
  try {
    const dbGrns = await prisma.grn.findMany({
      where: { grnNumber: { startsWith: prefix } },
      select: { grnNumber: true }
    });

    for (const g of dbGrns) {
      if (g.grnNumber && g.grnNumber.startsWith(prefix)) {
        const numPart = g.grnNumber.replace(prefix, '');
        const parsed = parseInt(numPart, 10);
        if (!isNaN(parsed) && parsed > maxSeq) {
          maxSeq = parsed;
        }
      }
    }
  } catch (err) {}

  const nextSeq = maxSeq + 1;
  return `${prefix}${nextSeq.toString().padStart(5, '0')}`;
}

function formatGrnResponse(g: any) {
  if (!g) return null;
  return {
    ...g,
    id: g.grnNumber || g.id,
    grnNumber: g.grnNumber || g.id,
    series: g.series || 'PS-GR-.YYYY.-.MM.-',
    status: g.status || 'Draft',
    supplier: g.supplier?.name || (typeof g.supplier === 'string' ? g.supplier : '') || '',
    acceptedWarehouse: g.acceptedWarehouse || 'Main Store - PSL',
    postingDate: g.receivedDate ? new Date(g.receivedDate).toISOString().split('T')[0] : (g.postingDate || ''),
    postingTime: g.postingTime || '12:00',
    totalQuantity: g.items?.reduce((sum: number, i: any) => sum + (Number(i.acceptedQuantity || i.orderedQuantity || i.quantity) || 0), 0) || 0,
    totalAmount: g.items?.reduce((sum: number, i: any) => sum + ((Number(i.acceptedQuantity || i.orderedQuantity || i.quantity) || 0) * (Number(i.unitPrice || i.rate) || 0)), 0) || 0,
    items: g.items?.map((it: any) => ({
      id: it.id,
      itemCode: it.remarks || (it.product?.sku ? `${it.product.sku}: ${it.product.name}` : it.itemCode || 'ITEM-001'),
      uom: it.uom || it.product?.unit?.name || 'Pcs',
      acceptedQuantity: Number(it.acceptedQuantity || it.orderedQuantity || it.quantity || 0),
      rate: Number(it.unitPrice || it.rate || 0),
      amount: Number(it.acceptedQuantity || it.orderedQuantity || it.quantity || 0) * Number(it.unitPrice || it.rate || 0)
    })) || []
  };
}

async function processStockIncrementForGrn(grn: any) {
  if (!grn) return;
  const statusUpper = String(grn.status || '').toUpperCase();
  if (statusUpper !== 'ACCEPTED' && statusUpper !== 'SUBMITTED') return;

  if (!grn.items || !Array.isArray(grn.items)) return;

  for (const item of grn.items) {
    const rawCode = String(item.itemCode || item.remarks || '').trim();
    if (!rawCode) continue;

    const qty = Number(item.acceptedQuantity || item.quantity || item.orderedQuantity || 0);
    if (qty <= 0) continue;

    const parts = rawCode.split(':');
    const sku = parts[0].trim();
    const name = parts.length > 1 ? parts.slice(1).join(':').trim() : sku;
    const rate = Number(item.rate || item.unitPrice || 0);
    const warehouse = grn.acceptedWarehouse || 'Main Store - PSL';

    try {
      let product = await prisma.product.findFirst({
        where: {
          OR: [
            { sku: { equals: sku, mode: 'insensitive' } },
            { name: { equals: name, mode: 'insensitive' } }
          ]
        }
      });

      if (product) {
        // Prevent duplicate ledger entry for the same GRN and product
        const existingLedger = await prisma.stockLedger.findFirst({
          where: { grnId: grn.id, productId: product.id }
        });
        if (existingLedger) {
          console.log(`Stock ledger already exists for GRN ${grn.id} and Product ${product.id}, skipping duplicate creation.`);
          continue;
        }

        const newQty = Number(product.quantity || 0) + qty;
        await prisma.product.update({
          where: { id: product.id },
          data: {
            quantity: newQty,
            location: product.location || warehouse
          }
        });

        await prisma.stockLedger.create({
          data: {
            productId: product.id,
            grnId: grn.id,
            date: new Date(grn.receivedDate || grn.postingDate || Date.now()),
            type: 'GRN_RECEIPT',
            quantityChange: qty,
            runningBalance: newQty
          }
        }).catch(e => console.error('Failed to create stockLedger:', e));
      } else {
        const category = await prisma.category.findFirst({ where: { name: { contains: 'SCREW', mode: 'insensitive' } } })
          || await prisma.category.findFirst();

        const createdProduct = await prisma.product.create({
          data: {
            sku: sku,
            name: name,
            quantity: qty,
            cost_price: rate,
            selling_price: rate,
            location: warehouse,
            status: 'Active',
            categoryId: category?.id || null,
            partOf: 'RAW MATERIAL',
            subPartOf: 'WORKSHOP'
          }
        });

        try {
          await prisma.skuMaster.upsert({
            where: { sku: createdProduct.sku },
            update: { name: createdProduct.name, categoryId: createdProduct.categoryId },
            create: { sku: createdProduct.sku, name: createdProduct.name, categoryId: createdProduct.categoryId }
          });
        } catch (e) {}

        await prisma.stockLedger.create({
          data: {
            productId: createdProduct.id,
            grnId: grn.id,
            date: new Date(grn.receivedDate || grn.postingDate || Date.now()),
            type: 'GRN_RECEIPT',
            quantityChange: qty,
            runningBalance: qty
          }
        }).catch(e => console.error('Failed to create stockLedger:', e));
      }
    } catch (err) {
      console.error(`Error incrementing stock for ${sku}:`, err);
    }
  }
}

async function saveGrnToDatabase(data: any) {
  const grnId = data.grnNumber || data.id;
  if (!grnId) return null;

  let grnStatus: GrnStatus = GrnStatus.DRAFT;
  const statusUpper = String(data.status || '').toUpperCase();
  if (statusUpper === 'ACCEPTED') grnStatus = GrnStatus.ACCEPTED;
  else if (statusUpper === 'REJECTED') grnStatus = GrnStatus.REJECTED;
  else if (statusUpper === 'PENDING_INSPECTION' || statusUpper === 'PENDING') grnStatus = GrnStatus.PENDING_INSPECTION;

  let supplierId: number | null = null;
  if (data.supplier) {
    const suppName = typeof data.supplier === 'string' ? data.supplier : (data.supplier.name || data.supplier.companyName);
    if (suppName) {
      let supp = await prisma.supplier.findFirst({ where: { name: { equals: suppName.trim(), mode: 'insensitive' } } });
      if (!supp) {
        supp = await prisma.supplier.create({ data: { name: suppName.trim() } }).catch(() => null);
      }
      if (supp) supplierId = supp.id;
    }
  }

  let purchaseOrderId: string | null = null;
  if (data.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { OR: [{ id: data.purchaseOrderId }, { poNumber: data.purchaseOrderId }] }
    });
    if (po) purchaseOrderId = po.id;
  }

  const existing = await prisma.grn.findFirst({
    where: { OR: [{ id: grnId }, { grnNumber: grnId }] }
  });

  const wasAlreadyAccepted = existing?.status === GrnStatus.ACCEPTED;

  let dbGrn;
  if (existing) {
    dbGrn = await prisma.grn.update({
      where: { id: existing.id },
      data: {
        status: grnStatus,
        acceptedWarehouse: data.acceptedWarehouse || existing.acceptedWarehouse || 'Main Store - PSL',
        supplierId: supplierId ?? existing.supplierId,
        purchaseOrderId: purchaseOrderId ?? existing.purchaseOrderId,
        receivedDate: data.postingDate ? new Date(data.postingDate) : existing.receivedDate
      }
    });
    await prisma.grnItem.deleteMany({ where: { grnId: dbGrn.id } });
  } else {
    dbGrn = await prisma.grn.create({
      data: {
        id: grnId,
        grnNumber: grnId,
        status: grnStatus,
        acceptedWarehouse: data.acceptedWarehouse || 'Main Store - PSL',
        supplierId,
        purchaseOrderId,
        receivedDate: data.postingDate ? new Date(data.postingDate) : new Date()
      }
    });
  }

  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      const rawCode = String(item.itemCode || '').trim();
      if (!rawCode) continue;

      const parts = rawCode.split(':');
      const sku = parts[0].trim();
      const name = parts.length > 1 ? parts.slice(1).join(':').trim() : sku;
      const acceptedQty = Number(item.acceptedQuantity || item.quantity || 0);
      const rate = Number(item.rate || item.unitPrice || 0);

      let product = await prisma.product.findFirst({
        where: {
          OR: [
            { sku: { equals: sku, mode: 'insensitive' } },
            { name: { equals: name, mode: 'insensitive' } }
          ]
        }
      });

      if (!product) {
        const category = await prisma.category.findFirst({ where: { name: { contains: 'SCREW', mode: 'insensitive' } } })
          || await prisma.category.findFirst();

        product = await prisma.product.create({
          data: {
            sku,
            name,
            quantity: 0,
            cost_price: rate,
            selling_price: rate,
            location: data.acceptedWarehouse || 'Main Store - PSL',
            status: 'Active',
            categoryId: category?.id || null,
            partOf: 'RAW MATERIAL',
            subPartOf: 'WORKSHOP'
          }
        });
      }

      await prisma.grnItem.create({
        data: {
          grnId: dbGrn.id,
          productId: product.id,
          orderedQuantity: acceptedQty,
          receivedQuantity: acceptedQty,
          acceptedQuantity: acceptedQty,
          rejectedQuantity: 0,
          unitPrice: rate,
          remarks: item.itemCode
        }
      });
    }
  }

  const finalGrn = await prisma.grn.findUnique({
    where: { id: dbGrn.id },
    include: { supplier: true, invoice: true, items: { include: { product: true } } }
  });

  if (grnStatus === GrnStatus.ACCEPTED && !wasAlreadyAccepted) {
    await processStockIncrementForGrn(finalGrn);
  }

  return finalGrn;
}

// GET all GRNs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, status, invoiceId, supplierId, purchaseOrderId } = req.query;

    const whereConditions: any[] = [];
    if (status && status !== 'ALL') {
      const statusUpper = String(status).toUpperCase();
      if (statusUpper === 'ACCEPTED') whereConditions.push({ status: GrnStatus.ACCEPTED });
      else if (statusUpper === 'REJECTED') whereConditions.push({ status: GrnStatus.REJECTED });
      else if (statusUpper === 'DRAFT') whereConditions.push({ status: GrnStatus.DRAFT });
    }

    if (invoiceId) whereConditions.push({ invoiceId: String(invoiceId) });
    if (supplierId) whereConditions.push({ supplierId: Number(supplierId) || undefined });
    if (purchaseOrderId) whereConditions.push({ purchaseOrderId: String(purchaseOrderId) });

    if (search) {
      const q = String(search).trim();
      whereConditions.push({
        OR: [
          { grnNumber: { contains: q, mode: 'insensitive' } },
          { id: { contains: q, mode: 'insensitive' } },
          { supplier: { name: { contains: q, mode: 'insensitive' } } },
          { items: { some: { remarks: { contains: q, mode: 'insensitive' } } } }
        ]
      });
    }

    const dbGrns = await prisma.grn.findMany({
      where: whereConditions.length > 0 ? { AND: whereConditions } : {},
      orderBy: { createdAt: 'desc' },
      include: { supplier: true, invoice: true, items: { include: { product: true } } }
    });

    const formatted = dbGrns.map(formatGrnResponse);
    res.json(formatted);
  } catch (error) {
    console.error('Failed to fetch GRNs:', error);
    res.status(500).json({ error: 'Failed to fetch GRNs' });
  }
});

// GET single GRN by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dbGrn = await prisma.grn.findFirst({
      where: { OR: [{ id }, { grnNumber: id }] },
      include: { supplier: true, invoice: true, items: { include: { product: true } } }
    });

    if (!dbGrn) {
      return res.status(404).json({ error: 'GRN not found' });
    }

    res.json(formatGrnResponse(dbGrn));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GRN' });
  }
});

// GET generate next GRN ID
router.get('/generate-id', async (req: Request, res: Response) => {
  try {
    const { postingDate } = req.query;
    const nextId = await generateNextGrnId(postingDate as string);
    res.json({ id: nextId, series: 'PS-GR-.YYYY.-.MM.-' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate GRN ID' });
  }
});

// POST create new GRN
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const autoGeneratedId = await generateNextGrnId(data.postingDate);
    data.grnNumber = data.grnNumber || data.id || autoGeneratedId;
    data.id = data.grnNumber;

    const saved = await saveGrnToDatabase(data);
    res.status(201).json(formatGrnResponse(saved));
  } catch (error: any) {
    console.error('Failed to create GRN:', error);
    res.status(500).json({ error: error.message || 'Failed to create GRN' });
  }
});

// PUT update GRN
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = { ...req.body, id, grnNumber: id };

    const saved = await saveGrnToDatabase(data);

    try {
      await logActivity({
        entityType: 'GRN',
        entityId: id,
        action: 'UPDATE',
        description: `Updated GRN ${id}`,
        userId: (req as any).user?.id || (data as any).userId
      });
    } catch (e) {}

    res.json(formatGrnResponse(saved));
  } catch (error: any) {
    console.error('Failed to update GRN:', error);
    res.status(500).json({ error: 'Failed to update GRN' });
  }
});

// POST accept GRN
router.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let grn = await prisma.grn.findFirst({
      where: { OR: [{ id }, { grnNumber: id }] }
    });

    if (grn) {
      const updated = await prisma.grn.update({
        where: { id: grn.id },
        data: { status: GrnStatus.ACCEPTED },
        include: { supplier: true, invoice: true, items: { include: { product: true } } }
      });
      await processStockIncrementForGrn(updated);
      return res.json({ message: 'GRN accepted successfully', grn: formatGrnResponse(updated) });
    }

    res.status(404).json({ error: 'GRN not found' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to accept GRN' });
  }
});

// DELETE GRN
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.grnItem.deleteMany({
      where: { grn: { OR: [{ id }, { grnNumber: id }] } }
    });
    await prisma.grn.deleteMany({
      where: { OR: [{ id }, { grnNumber: id }] }
    });
    res.json({ message: 'GRN deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete GRN' });
  }
});

export default router;
