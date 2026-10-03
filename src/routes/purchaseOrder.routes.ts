import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logActivity, createFieldDiffDescriptionAsync } from '../services/activityLogger';

const router = Router();
const prisma = new PrismaClient();

// Helper to auto-generate PO ID: PO-YYYY-MM-XXXXX
async function generateNextPoId(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const prefix = `PO-${year}-${month}-`;

  const count = await prisma.purchaseOrder.count({
    where: {
      id: { startsWith: prefix }
    }
  });

  const nextSeq = (count + 1).toString().padStart(5, '0');
  return `${prefix}${nextSeq}`;
}

// Helper to resolve product ID from Product table
async function resolveProductId(productId?: string, itemCode?: string): Promise<string | null> {
  if (productId) {
    const p = await prisma.product.findUnique({ where: { id: productId } });
    if (p) return p.id;
  }
  if (itemCode) {
    const skuCode = itemCode.split(':')[0].trim();
    const p = await prisma.product.findFirst({
      where: {
        OR: [
          { sku: { equals: skuCode, mode: 'insensitive' } },
          { id: { equals: skuCode, mode: 'insensitive' } },
          { name: { contains: skuCode, mode: 'insensitive' } }
        ]
      }
    });
    if (p) return p.id;
  }
  return null;
}

// Helper to resolve supplier ID from Supplier table
async function resolveSupplierId(supplierId?: number, supplierName?: string): Promise<number | null> {
  if (supplierId) {
    const s = await prisma.supplier.findUnique({ where: { id: Number(supplierId) } });
    if (s) return s.id;
  }
  if (supplierName) {
    const s = await prisma.supplier.findFirst({
      where: { name: { contains: supplierName.trim(), mode: 'insensitive' } }
    });
    if (s) return s.id;
  }
  return null;
}

// GET all purchase orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;

    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { poNumber: { contains: q, mode: 'insensitive' } },
        { supplier: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { items: { some: { itemCode: { contains: q, mode: 'insensitive' } } } }
      ];
    }

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplierObj: true,
        client: true,
        items: {
          include: { product: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = pos.map(p => ({
      ...p,
      poNumber: p.poNumber || p.id,
      transactionDate: p.transactionDate ? p.transactionDate.toISOString().split('T')[0] : '',
      requiredByDate: p.requiredByDate ? p.requiredByDate.toISOString().split('T')[0] : '',
      items: p.items.map(it => ({
        ...it,
        requiredByDate: it.requiredByDate ? it.requiredByDate.toISOString().split('T')[0] : ''
      }))
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

// GET single purchase order by ID or poNumber
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let po = await prisma.purchaseOrder.findFirst({
      where: {
        OR: [
          { id },
          { poNumber: id }
        ]
      },
      include: {
        supplierObj: true,
        client: true,
        items: {
          include: { product: true }
        }
      }
    });

    if (!po) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }

    const formatted = {
      ...po,
      poNumber: po.poNumber || po.id,
      transactionDate: po.transactionDate ? po.transactionDate.toISOString().split('T')[0] : '',
      requiredByDate: po.requiredByDate ? po.requiredByDate.toISOString().split('T')[0] : '',
      items: po.items.map(it => ({
        ...it,
        requiredByDate: it.requiredByDate ? it.requiredByDate.toISOString().split('T')[0] : ''
      }))
    };

    res.json(formatted);
  } catch (error: any) {
    console.error('Error fetching purchase order:', error);
    res.status(500).json({ error: 'Failed to fetch purchase order' });
  }
});

// POST create purchase order
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const generatedPoCode = await generateNextPoId();
    const poNum = (data.poNumber || data.id) && (data.id !== 'new' && data.poNumber !== 'new')
      ? (data.poNumber || data.id)
      : generatedPoCode;
    const suppId = await resolveSupplierId(data.supplierId, data.supplier);

    const itemsData = await Promise.all((data.items || []).map(async (it: any) => {
      const pId = await resolveProductId(it.productId, it.itemCode);
      return {
        itemCode: it.itemCode || '',
        productId: pId,
        requiredByDate: it.requiredByDate ? new Date(it.requiredByDate) : null,
        itemGroup: it.itemGroup || 'GENERAL',
        quantity: Number(it.quantity) || 1,
        uom: it.uom || 'Pcs',
        rate: Number(it.rate) || 0,
        receivedQty: Number(it.receivedQty) || 0,
        amount: Number(it.amount) || ((Number(it.quantity) || 1) * (Number(it.rate) || 0))
      };
    }));

    const created = await prisma.purchaseOrder.create({
      data: {
        id: poNum,
        poNumber: poNum,
        series: data.series || 'NCL-.YYYY.-.MM.-',
        status: data.status || 'Draft',
        approvalStatus: data.approvalStatus || 'Draft',
        company: data.company || 'PATEL STRAP INDUSTRIES LTD',
        supplier: data.supplier || '',
        supplierId: suppId,
        clientId: data.clientId ? Number(data.clientId) : null,
        transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(),
        requiredByDate: data.requiredByDate ? new Date(data.requiredByDate) : null,
        paymentTerms: data.paymentTerms || '',
        purchaseType: data.purchaseType || '',
        gstin: data.gstin || '',
        tin: data.tin || '',
        vrn: data.vrn || '',
        pfiNo: data.pfiNo || '',
        user: data.user || 'Administrator',
        contact: data.contact || '',
        email: data.email || '',
        setWarehouse: data.setWarehouse || 'Main Store - PSL',
        currency: data.currency || 'INR',
        priceList: data.priceList || 'Standard Buying',
        applyTaxWithholding: Boolean(data.applyTaxWithholding),
        isSubcontracted: Boolean(data.isSubcontracted),
        assignedTo: data.assignedTo || 'Administrator',
        tags: data.tags || '',
        attachments: data.attachments || [],
        createdBy: data.createdBy || 'Administrator',
        items: {
          create: itemsData
        }
      },
      include: {
        supplierObj: true,
        client: true,
        items: {
          include: { product: true }
        }
      }
    });

    await logActivity({
      entityType: 'PurchaseOrder',
      entityId: created.poNumber || created.id,
      action: 'CREATE',
      description: `created purchase order`,
      userId: (req as any).user?.id || (data as any).userId,
      metadata: { userName: data.user || data.createdBy || 'admin' }
    }).catch(err => console.error('Error logging PO create activity:', err));

    const formatted = {
      ...created,
      poNumber: created.poNumber || created.id,
      transactionDate: created.transactionDate ? created.transactionDate.toISOString().split('T')[0] : '',
      requiredByDate: created.requiredByDate ? created.requiredByDate.toISOString().split('T')[0] : '',
      items: created.items.map(it => ({
        ...it,
        requiredByDate: it.requiredByDate ? it.requiredByDate.toISOString().split('T')[0] : ''
      }))
    };

    res.status(201).json(formatted);
  } catch (error: any) {
    console.error('Error creating purchase order:', error);
    res.status(500).json({ error: error.message || 'Failed to create purchase order' });
  }
});

// PUT update purchase order
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const suppId = await resolveSupplierId(data.supplierId, data.supplier);

    const existing = await prisma.purchaseOrder.findFirst({
      where: {
        OR: [
          { id },
          { poNumber: id }
        ]
      },
      include: { items: true }
    });

    const itemsData = await Promise.all((data.items || []).map(async (it: any) => {
      const pId = await resolveProductId(it.productId, it.itemCode);
      return {
        itemCode: it.itemCode || '',
        productId: pId,
        requiredByDate: it.requiredByDate ? new Date(it.requiredByDate) : null,
        itemGroup: it.itemGroup || 'GENERAL',
        quantity: Number(it.quantity) || 1,
        uom: it.uom || 'Pcs',
        rate: Number(it.rate) || 0,
        receivedQty: Number(it.receivedQty) || 0,
        amount: Number(it.amount) || ((Number(it.quantity) || 1) * (Number(it.rate) || 0))
      };
    }));

    let updated;
    if (!existing) {
      // Create if not exists
      const generatedPoCode = await generateNextPoId();
      const poNum = data.poNumber || id || generatedPoCode;
      updated = await prisma.purchaseOrder.create({
        data: {
          id: poNum,
          poNumber: poNum,
          series: data.series || 'NCL-.YYYY.-.MM.-',
          status: data.status || 'Draft',
          approvalStatus: data.approvalStatus || 'Draft',
          company: data.company || 'PATEL STRAP INDUSTRIES LTD',
          supplier: data.supplier || '',
          supplierId: suppId,
          clientId: data.clientId ? Number(data.clientId) : null,
          transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(),
          requiredByDate: data.requiredByDate ? new Date(data.requiredByDate) : null,
          paymentTerms: data.paymentTerms || '',
          purchaseType: data.purchaseType || '',
          gstin: data.gstin || '',
          tin: data.tin || '',
          vrn: data.vrn || '',
          pfiNo: data.pfiNo || '',
          user: data.user || 'Administrator',
          contact: data.contact || '',
          email: data.email || '',
          setWarehouse: data.setWarehouse || 'Main Store - PSL',
          currency: data.currency || 'INR',
          priceList: data.priceList || 'Standard Buying',
          applyTaxWithholding: Boolean(data.applyTaxWithholding),
          isSubcontracted: Boolean(data.isSubcontracted),
          assignedTo: data.assignedTo || 'Administrator',
          tags: data.tags || '',
          attachments: data.attachments || [],
          createdBy: data.createdBy || 'Administrator',
          items: {
            create: itemsData
          }
        },
        include: {
          supplierObj: true,
          client: true,
          items: {
            include: { product: true }
          }
        }
      });

      await logActivity({
        entityType: 'PurchaseOrder',
        entityId: updated.poNumber || updated.id,
        action: 'CREATE',
        description: `created purchase order`,
        userId: (req as any).user?.id || (data as any).userId,
        metadata: { userName: data.user || data.createdBy || 'admin' }
      }).catch(err => console.error('Error logging PO create activity:', err));
    } else {
      // Re-create items for this PO
      await prisma.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: existing.id }
      });

      updated = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          poNumber: data.poNumber || existing.poNumber || existing.id,
          series: data.series !== undefined ? data.series : existing.series,
          status: data.status !== undefined ? data.status : existing.status,
          approvalStatus: data.approvalStatus !== undefined ? data.approvalStatus : existing.approvalStatus,
          company: data.company !== undefined ? data.company : existing.company,
          supplier: data.supplier !== undefined ? data.supplier : existing.supplier,
          supplierId: suppId !== null ? suppId : existing.supplierId,
          clientId: data.clientId ? Number(data.clientId) : existing.clientId,
          transactionDate: data.transactionDate ? new Date(data.transactionDate) : existing.transactionDate,
          requiredByDate: data.requiredByDate ? new Date(data.requiredByDate) : existing.requiredByDate,
          paymentTerms: data.paymentTerms !== undefined ? data.paymentTerms : existing.paymentTerms,
          purchaseType: data.purchaseType !== undefined ? data.purchaseType : existing.purchaseType,
          gstin: data.gstin !== undefined ? data.gstin : existing.gstin,
          tin: data.tin !== undefined ? data.tin : existing.tin,
          vrn: data.vrn !== undefined ? data.vrn : existing.vrn,
          pfiNo: data.pfiNo !== undefined ? data.pfiNo : existing.pfiNo,
          user: data.user !== undefined ? data.user : existing.user,
          contact: data.contact !== undefined ? data.contact : existing.contact,
          email: data.email !== undefined ? data.email : existing.email,
          setWarehouse: data.setWarehouse !== undefined ? data.setWarehouse : existing.setWarehouse,
          currency: data.currency !== undefined ? data.currency : existing.currency,
          priceList: data.priceList !== undefined ? data.priceList : existing.priceList,
          applyTaxWithholding: data.applyTaxWithholding !== undefined ? Boolean(data.applyTaxWithholding) : existing.applyTaxWithholding,
          isSubcontracted: data.isSubcontracted !== undefined ? Boolean(data.isSubcontracted) : existing.isSubcontracted,
          assignedTo: data.assignedTo !== undefined ? data.assignedTo : existing.assignedTo,
          tags: data.tags !== undefined ? data.tags : existing.tags,
          attachments: data.attachments !== undefined ? data.attachments : (existing.attachments as any),
          items: {
            create: itemsData
          }
        },
        include: {
          supplierObj: true,
          client: true,
          items: {
            include: { product: true }
          }
        }
      });

      // Log Activity diff only if changed
      const fieldDiff = await createFieldDiffDescriptionAsync(existing, updated);
      if (fieldDiff !== 'updated record' || existing.status !== updated.status) {
        let actionDescription = fieldDiff;
        if (existing.status !== updated.status) {
          if (updated.status === 'Submitted') {
            actionDescription = fieldDiff !== 'updated record' ? `submitted purchase order (${fieldDiff})` : 'submitted purchase order';
          } else if (updated.status === 'Rejected') {
            actionDescription = fieldDiff !== 'updated record' ? `rejected purchase order (${fieldDiff})` : 'rejected purchase order';
          }
        }

        await logActivity({
          entityType: 'PurchaseOrder',
          entityId: updated.poNumber || updated.id,
          action: updated.status === 'Submitted' ? 'SUBMIT' : 'UPDATE',
          description: actionDescription,
          userId: (req as any).user?.id || (data as any).userId,
          metadata: { userName: data.user || data.createdBy || 'admin' }
        }).catch(err => console.error('Error logging PO update activity:', err));
      }
    }

    const formatted = {
      ...updated,
      poNumber: updated.poNumber || updated.id,
      transactionDate: updated.transactionDate ? updated.transactionDate.toISOString().split('T')[0] : '',
      requiredByDate: updated.requiredByDate ? updated.requiredByDate.toISOString().split('T')[0] : '',
      items: updated.items.map(it => ({
        ...it,
        requiredByDate: it.requiredByDate ? it.requiredByDate.toISOString().split('T')[0] : ''
      }))
    };

    res.json(formatted);
  } catch (error: any) {
    console.error('Error updating purchase order:', error);
    res.status(500).json({ error: error.message || 'Failed to update purchase order' });
  }
});

// DELETE purchase order
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.purchaseOrder.findFirst({
      where: {
        OR: [
          { id },
          { poNumber: id }
        ]
      }
    });

    if (existing) {
      await prisma.purchaseOrder.delete({
        where: { id: existing.id }
      });
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting purchase order:', error);
    res.status(500).json({ error: 'Failed to delete purchase order' });
  }
});

export default router;
