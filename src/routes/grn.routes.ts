import { Router, Request, Response } from 'express';
import { PrismaClient, GrnStatus } from '@prisma/client';
import { purchaseOrders } from './purchaseOrder.routes';

const router = Router();
const prisma = new PrismaClient();

// In-memory fallback store for GRNs
let sampleGrns: any[] = [
  {
    id: 'GRN-2026-09-00001',
    grnNumber: 'GRN-2026-09-00001',
    series: 'NCL-GR-.2026.-.09.-',
    status: 'ACCEPTED',
    postingDate: '2026-09-24',
    postingTime: '10:32:06',
    supplier: 'AURA INDUSTRIAL CONSUMABLES',
    supplierDeliveryNote: 'DN-99812',
    supplierInvoiceNumber: 'INV-2026-99',
    efdReceipt: 'EFD-9012',
    company: 'PATEL STRAP INDUSTRIES LTD',
    applyPutawayRule: false,
    isReturn: false,
    defaultHod: 'Stock Manager',
    payment: 'Pending',
    acceptedWarehouse: 'Main Store - PSL',
    scanBarcode: '',
    purchaseOrderId: 'PO-2026-09-00002',
    invoiceId: 'INV-2026-09-00001',
    createdBy: 'System User',
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    totalQuantity: 50,
    totalTrips: 1,
    totalAmount: 625000,
    items: [
      {
        id: '1',
        itemCode: 'NGMD008: AMOXYCLAVE TABLET',
        uom: 'BOX',
        acceptedQuantity: 50,
        rate: 12500,
        amount: 625000,
        wbNo: 'WB-102',
        wbSlipNo: 'SLIP-88',
        mine: 'Sector 4'
      }
    ],
    taxes: [
      { id: '1', type: 'On Net Total', accountHead: 'Input Tax CGST - PS', taxRate: 9, amount: 56250, total: 681250 },
      { id: '2', type: 'On Net Total', accountHead: 'Input Tax SGST - PS', taxRate: 9, amount: 56250, total: 737500 }
    ]
  },
  {
    id: 'GRN-2026-09-00002',
    grnNumber: 'GRN-2026-09-00002',
    series: 'NCL-GR-.2026.-.09.-',
    status: 'Draft',
    postingDate: '2026-09-24',
    postingTime: '11:15:00',
    supplier: 'VICTOR SUPPLIERS LTD',
    supplierDeliveryNote: 'DN-88120',
    supplierInvoiceNumber: 'INV-2026-104',
    efdReceipt: 'EFD-9088',
    company: 'PATEL STRAP INDUSTRIES LTD',
    applyPutawayRule: false,
    isReturn: false,
    defaultHod: 'Plant Admin',
    payment: 'Pending',
    acceptedWarehouse: 'Main Store - PSL',
    scanBarcode: '',
    purchaseOrderId: 'PO-2026-09-00001',
    invoiceId: '',
    createdBy: 'Harsh Thakkar',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalQuantity: 100,
    totalTrips: 1,
    totalAmount: 4025400,
    items: [
      {
        id: '1',
        itemCode: 'NGTL047: SHANK DRILL BIT',
        uom: 'Pcs',
        acceptedQuantity: 100,
        rate: 40254,
        amount: 4025400,
        wbNo: 'WB-108',
        wbSlipNo: 'SLIP-95',
        mine: 'Plant Yard'
      }
    ],
    taxes: []
  }
];

let nextGrnNum = 313;

const syncPurchaseOrderReceivedQty = (poId: string) => {
  if (!poId) return;
  const po = purchaseOrders.find(p => p.id === poId);
  if (!po) return;

  const linkedGrns = sampleGrns.filter(g => g.purchaseOrderId === poId);

  po.items = po.items.map((poItem: any) => {
    let sumReceived = 0;
    linkedGrns.forEach(grn => {
      grn.items?.forEach((gItem: any) => {
        const poCode = (poItem.itemCode || '').split(':')[0].trim().toLowerCase();
        const grnCode = (gItem.itemCode || '').split(':')[0].trim().toLowerCase();
        if (poCode === grnCode || (gItem.itemCode && poItem.itemCode && gItem.itemCode.includes(poItem.itemCode))) {
          sumReceived += Number(gItem.acceptedQuantity || gItem.quantity || 0);
        }
      });
    });
    return {
      ...poItem,
      receivedQty: sumReceived
    };
  });

  const totalOrdered = po.items.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
  const totalReceived = po.items.reduce((s: number, i: any) => s + (Number(i.receivedQty) || 0), 0);

  if (totalReceived >= totalOrdered && totalOrdered > 0) {
    po.status = 'Completed';
  } else if (totalReceived > 0) {
    po.status = 'Partially Received';
  }
};

// GET all GRNs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, status, invoiceId, supplierId, purchaseOrderId } = req.query;

    let dbGrns: any[] = [];
    try {
      const whereConditions: any[] = [];
      if (status && status !== 'ALL') whereConditions.push({ status: status as GrnStatus });
      if (invoiceId) whereConditions.push({ invoiceId: invoiceId as string });
      if (supplierId) whereConditions.push({ supplierId: supplierId as string });
      if (search) {
        const q = (search as string).trim();
        whereConditions.push({
          OR: [
            { grnNumber: { contains: q, mode: 'insensitive' } },
            { invoice: { invoiceNumber: { contains: q, mode: 'insensitive' } } },
            { supplier: { name: { contains: q, mode: 'insensitive' } } },
          ],
        });
      }

      dbGrns = await prisma.grn.findMany({
        where: whereConditions.length > 0 ? { AND: whereConditions } : {},
        orderBy: { createdAt: 'desc' },
        include: { supplier: true, invoice: true, items: { include: { product: true } } },
      });
    } catch (dbErr) {
      console.log('Database read fallback to memory store for GRNs');
    }

    const dbFormatted = dbGrns.map(g => ({
      ...g,
      grnNumber: g.grnNumber || g.id,
      supplier: g.supplier?.name || g.supplier || 'TATA STEEL',
      acceptedWarehouse: g.acceptedWarehouse || 'Main Store - PSL',
      items: g.items?.map((it: any) => ({
        id: it.id,
        itemCode: it.product?.sku ? `${it.product.sku}: ${it.product.name}` : it.itemCode || 'ITEM-001',
        uom: it.uom || 'Pcs',
        acceptedQuantity: it.quantity || it.acceptedQuantity || 0,
        rate: it.rate || 0,
        amount: (it.quantity || it.acceptedQuantity || 0) * (it.rate || 0)
      })) || []
    }));

    // Combine memory store and DB store (so newly generated GRNs and sample PO GRNs are always returned)
    const grnMap = new Map();
    [...sampleGrns, ...dbFormatted].forEach(g => {
      if (g.id) grnMap.set(g.id, g);
    });

    let filtered = Array.from(grnMap.values());

    if (purchaseOrderId && typeof purchaseOrderId === 'string') {
      filtered = filtered.filter(g => g.purchaseOrderId === purchaseOrderId || g.id.includes(purchaseOrderId));
    }
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(g =>
        (g.grnNumber || '').toLowerCase().includes(q) ||
        (g.supplier && (typeof g.supplier === 'string' ? g.supplier : g.supplier.name || '').toLowerCase().includes(q)) ||
        (g.supplierInvoiceNumber || '').toLowerCase().includes(q) ||
        (g.company || '').toLowerCase().includes(q)
      );
    }
    if (status && typeof status === 'string' && status !== 'ALL') {
      filtered = filtered.filter(g => g.status?.toLowerCase() === status.toLowerCase());
    }

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GRNs' });
  }
});

// GET single GRN by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    try {
      const dbGrn = await prisma.grn.findUnique({
        where: { id },
        include: { supplier: true, invoice: true, items: { include: { product: true } } },
      });
      if (dbGrn) return res.json(dbGrn);
    } catch (dbErr) {
      // Memory fallback
    }

    const grn = sampleGrns.find(g => g.id === id || g.grnNumber === id);
    if (!grn) {
      return res.status(404).json({ error: 'GRN not found' });
    }
    res.json(grn);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GRN' });
  }
});

// POST create new GRN
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const numStr = (nextGrnNum++).toString().padStart(5, '0');
    const grnId = data.grnNumber || `GRN-2026-09-${numStr}`;

    const newGrn = {
      id: grnId,
      grnNumber: grnId,
      series: data.series || 'NCL-GR-.2026.-.09.-',
      status: data.status || 'Draft',
      postingDate: data.postingDate || new Date().toISOString().split('T')[0],
      postingTime: data.postingTime || new Date().toTimeString().split(' ')[0],
      supplier: data.supplier || '',
      supplierDeliveryNote: data.supplierDeliveryNote || '',
      supplierInvoiceNumber: data.supplierInvoiceNumber || '',
      efdReceipt: data.efdReceipt || '',
      company: data.company || 'PATEL STRAP INDUSTRIES LTD',
      applyPutawayRule: Boolean(data.applyPutawayRule),
      isReturn: Boolean(data.isReturn),
      defaultHod: data.defaultHod || 'Stock Manager',
      payment: data.payment || 'Pending',
      acceptedWarehouse: data.acceptedWarehouse || 'Main Store - PSL',
      scanBarcode: data.scanBarcode || '',
      purchaseOrderId: data.purchaseOrderId || '',
      invoiceId: data.invoiceId || '',
      createdBy: data.createdBy || 'System User',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalQuantity: data.items?.reduce((sum: number, i: any) => sum + (Number(i.acceptedQuantity || i.quantity) || 0), 0) || 0,
      totalTrips: data.totalTrips || 1,
      totalAmount: data.items?.reduce((sum: number, i: any) => sum + (Number(i.amount || ((i.acceptedQuantity || i.quantity || 0) * (i.rate || 0)))), 0) || 0,
      items: data.items || [],
      taxes: data.taxes || []
    };

    sampleGrns.unshift(newGrn);
    if (newGrn.purchaseOrderId) {
      syncPurchaseOrderReceivedQty(newGrn.purchaseOrderId);
    }

    res.status(201).json(newGrn);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create GRN' });
  }
});

// PUT update GRN
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const idx = sampleGrns.findIndex(g => g.id === id || g.grnNumber === id);

    if (idx !== -1) {
      sampleGrns[idx] = {
        ...sampleGrns[idx],
        ...data,
        updatedAt: new Date().toISOString()
      };
      if (sampleGrns[idx].purchaseOrderId) {
        syncPurchaseOrderReceivedQty(sampleGrns[idx].purchaseOrderId);
      }
      return res.json(sampleGrns[idx]);
    }

    res.status(404).json({ error: 'GRN not found' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update GRN' });
  }
});

// POST accept GRN
router.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const grn = sampleGrns.find(g => g.id === id || g.grnNumber === id);
    if (grn) {
      grn.status = 'ACCEPTED';
      grn.updatedAt = new Date().toISOString();
      if (grn.purchaseOrderId) {
        syncPurchaseOrderReceivedQty(grn.purchaseOrderId);
      }
      return res.json({ message: 'GRN accepted successfully', grn });
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
    sampleGrns = sampleGrns.filter(g => g.id !== id && g.grnNumber !== id);
    res.json({ message: 'GRN deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete GRN' });
  }
});

export default router;
