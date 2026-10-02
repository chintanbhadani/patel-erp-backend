import { Router, Request, Response } from 'express';
import { logActivity, createFieldDiffDescriptionAsync } from '../services/activityLogger';

const router = Router();

// In-memory Purchase Order store initialized with default sample data
export let purchaseOrders: any[] = [
  {
    id: 'PO-2026-09-00004',
    series: 'NCL-.2026.-.09.-',
    status: 'Draft',
    approvalStatus: 'Draft',
    company: 'PATEL STRAP INDUSTRIES LTD',
    supplier: 'Taparia',
    transactionDate: new Date().toISOString().split('T')[0],
    requiredByDate: new Date().toISOString().split('T')[0],
    paymentTerms: 'Cash',
    purchaseType: 'Local',
    gstin: '24ETSPB1142M1ZL',
    tin: '24ETSPB1142M1ZL',
    vrn: '40-018878-T',
    pfiNo: '',
    user: 'admin',
    contact: '+255...',
    email: 'supplier@example.com',
    setWarehouse: 'Main Store - PSL',
    currency: 'INR',
    priceList: 'Standard Buying',
    applyTaxWithholding: false,
    isSubcontracted: false,
    assignedTo: 'admin',
    createdBy: 'admin',
    tags: 'PURCHASE,BUYING',
    attachments: [
      { name: 'PatelInvoice.pdf', url: '#' }
    ],
    updatedAt: new Date().toISOString(),
    items: [
      { id: '1', itemCode: 'NGTL047: SHANK DRILL BIT', requiredByDate: new Date().toISOString().split('T')[0], itemGroup: 'TOOLS', quantity: 100, uom: 'Pcs', rate: 40254, receivedQty: 0, amount: 4025400 }
    ]
  },
  {
    id: 'PO-2026-09-00008',
    series: 'NCL-.2026.-.09.-',
    status: 'Partially Received',
    approvalStatus: 'Approved',
    company: 'PATEL STRAP INDUSTRIES LTD',
    supplier: 'MAIKA GENERAL SUPPLIES',
    transactionDate: '2026-09-01',
    requiredByDate: '2026-09-25',
    paymentTerms: 'Credit',
    purchaseType: 'Local',
    tin: '100-220-330',
    vrn: '40-001299-M',
    pfiNo: 'PFI-2026-08',
    user: 'Harsh Thakkar',
    contact: '+255 754 000 999',
    email: 'info@maikageneral.com',
    setWarehouse: 'Main Store - PSL',
    currency: 'INR',
    priceList: 'Standard Buying',
    applyTaxWithholding: false,
    isSubcontracted: false,
    assignedTo: 'Harsh Thakkar',
    createdBy: 'Harsh Thakkar',
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    items: [
      { id: '1', itemCode: 'NLMS011: OXYGEN CYLINDER 8.5', requiredByDate: '2026-09-25', itemGroup: 'CONSUMABLE', quantity: 100, uom: 'Pcs', rate: 30000, receivedQty: 64, amount: 3000000 },
      { id: '2', itemCode: 'NLMS033: LPG CYLINDER', requiredByDate: '2026-09-25', itemGroup: 'CONSUMABLE', quantity: 20, uom: 'Pcs', rate: 140000, receivedQty: 2, amount: 2800000 }
    ]
  },
  {
    id: 'PO-2026-09-00001',
    series: 'NCL-.2026.-.09.-',
    status: 'Submitted',
    approvalStatus: 'Approved',
    company: 'PATEL STRAP INDUSTRIES LTD',
    supplier: 'VICTOR SUPPLIERS LTD',
    transactionDate: '2026-09-20',
    requiredByDate: '2026-09-25',
    paymentTerms: 'Credit',
    purchaseType: 'Local',
    tin: '123-423-801',
    vrn: '40-018878-T',
    pfiNo: 'PFI-2026-99',
    user: 'Administrator',
    contact: '+255 712 345 678',
    email: 'victor@suppliers.com',
    setWarehouse: 'Main Store - PSL',
    currency: 'INR',
    priceList: 'Standard Buying',
    applyTaxWithholding: false,
    isSubcontracted: false,
    assignedTo: 'Administrator',
    createdBy: 'Admin',
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    items: [
      { id: '1', itemCode: 'NGTL047: SHANK DRILL BIT', requiredByDate: '2026-09-25', itemGroup: 'TOOLS', quantity: 100, uom: 'Pcs', rate: 40254, receivedQty: 0, amount: 4025400 }
    ]
  },
  {
    id: 'PO-2026-09-00002',
    series: 'NCL-.2026.-.09.-',
    status: 'Draft',
    approvalStatus: 'Draft',
    company: 'PATEL STRAP INDUSTRIES LTD',
    supplier: 'AURA INDUSTRIAL CONSUMABLES',
    transactionDate: '2026-09-22',
    requiredByDate: '2026-09-28',
    paymentTerms: 'Cash',
    purchaseType: 'Local',
    tin: '998-112-334',
    vrn: '40-099887-B',
    pfiNo: 'PFI-2026-102',
    user: 'System User',
    contact: '+255 789 000 111',
    email: 'info@auraindustrial.com',
    setWarehouse: 'Main Store - PSL',
    currency: 'INR',
    priceList: 'Standard Buying',
    applyTaxWithholding: false,
    isSubcontracted: false,
    assignedTo: 'Harsh Thakkar',
    createdBy: 'Harsh Thakkar',
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    items: [
      { id: '1', itemCode: 'NGMD008: AMOXYCLAVE TABLET', requiredByDate: '2026-09-28', itemGroup: 'HSE', quantity: 50, uom: 'BOX', rate: 12500, receivedQty: 0, amount: 625000 }
    ]
  }
];

let nextNumber = 9;

// GET all purchase orders
router.get('/', (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      const filtered = purchaseOrders.filter(po =>
        po.id.toLowerCase().includes(q) ||
        po.supplier?.toLowerCase().includes(q) ||
        po.company?.toLowerCase().includes(q) ||
        po.items?.some((i: any) => i.itemCode?.toLowerCase().includes(q))
      );
      return res.json(filtered);
    }
    res.json(purchaseOrders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

// GET single purchase order by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let po = purchaseOrders.find(p => p.id === id);
    if (!po) {
      // Auto-create missing PO record so frontend can edit & save seamlessly
      po = {
        id,
        series: 'NCL-.2026.-.09.-',
        status: 'Draft',
        approvalStatus: 'Draft',
        company: 'PATEL STRAP INDUSTRIES LTD',
        supplier: '',
        transactionDate: new Date().toISOString().split('T')[0],
        requiredByDate: new Date().toISOString().split('T')[0],
        paymentTerms: '',
        purchaseType: '',
        gstin: '',
        tin: '',
        vrn: '',
        pfiNo: '',
        user: 'admin',
        contact: '',
        email: '',
        setWarehouse: 'Main Store - PSL',
        currency: 'INR',
        priceList: 'Standard Buying',
        applyTaxWithholding: false,
        isSubcontracted: false,
        assignedTo: 'admin',
        createdBy: 'admin',
        tags: 'PURCHASE,BUYING',
        attachments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          { id: '1', itemCode: '', requiredByDate: new Date().toISOString().split('T')[0], itemGroup: 'GENERAL', quantity: 1, uom: 'Pcs', rate: 0, receivedQty: 0, amount: 0 }
        ]
      };
      purchaseOrders.unshift(po);
    }
    res.json(po);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch purchase order' });
  }
});

// POST create purchase order
router.post('/', (req: Request, res: Response) => {
  try {
    const data = req.body;
    const numStr = (nextNumber++).toString().padStart(5, '0');
    const newId = `PO-2026-09-${numStr}`;

    const newPO = {
      id: newId,
      series: data.series || 'NCL-.2026.-.09.-',
      status: data.status || 'Draft',
      approvalStatus: data.approvalStatus || 'Draft',
      company: data.company || 'PATEL STRAP INDUSTRIES LTD',
      supplier: data.supplier || '',
      transactionDate: data.transactionDate || new Date().toISOString().split('T')[0],
      requiredByDate: data.requiredByDate || new Date().toISOString().split('T')[0],
      paymentTerms: data.paymentTerms || 'Credit',
      purchaseType: data.purchaseType || 'Local',
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
      applyTaxWithholding: data.applyTaxWithholding || false,
      isSubcontracted: data.isSubcontracted || false,
      assignedTo: data.assignedTo || 'Administrator',
      tags: data.tags || '',
      attachments: data.attachments || [],
      createdBy: data.createdBy || 'Administrator',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: data.items || []
    };

    purchaseOrders.unshift(newPO);
    res.status(201).json(newPO);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create purchase order' });
  }
});

// PUT update purchase order
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const index = purchaseOrders.findIndex(p => p.id === id);
    if (index === -1) {
      // Upsert: Create entry if not found
      const newPO = {
        id,
        series: data.series || 'NCL-.2026.-.09.-',
        status: data.status || 'Draft',
        approvalStatus: data.approvalStatus || 'Draft',
        company: data.company || 'PATEL STRAP INDUSTRIES LTD',
        supplier: data.supplier || '',
        transactionDate: data.transactionDate || new Date().toISOString().split('T')[0],
        requiredByDate: data.requiredByDate || new Date().toISOString().split('T')[0],
        paymentTerms: data.paymentTerms || 'Credit',
        purchaseType: data.purchaseType || 'Local',
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
        applyTaxWithholding: data.applyTaxWithholding || false,
        isSubcontracted: data.isSubcontracted || false,
        assignedTo: data.assignedTo || 'Administrator',
        tags: data.tags || '',
        attachments: data.attachments || [],
        createdBy: data.createdBy || 'Administrator',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: data.items || [],
        ...data
      };
      purchaseOrders.unshift(newPO);
      return res.json(newPO);
    }

    const oldPO = JSON.parse(JSON.stringify(purchaseOrders[index]));
    const updatedPO = {
      ...oldPO,
      ...data,
      updatedAt: new Date().toISOString()
    };
    purchaseOrders[index] = updatedPO;

    // Generate detailed diff description
    const fieldDiff = await createFieldDiffDescriptionAsync(oldPO, updatedPO);
    let actionDescription = fieldDiff;
    if (oldPO.status !== updatedPO.status) {
      if (updatedPO.status === 'Submitted') {
        actionDescription = fieldDiff !== 'updated record' ? `submitted purchase order (${fieldDiff})` : 'submitted purchase order';
      } else if (updatedPO.status === 'Rejected') {
        actionDescription = fieldDiff !== 'updated record' ? `rejected purchase order (${fieldDiff})` : 'rejected purchase order';
      }
    }

    // Log Activity in DB
    await logActivity({
      entityType: 'PurchaseOrder',
      entityId: id,
      action: updatedPO.status === 'Submitted' ? 'SUBMIT' : 'UPDATE',
      description: actionDescription,
      userId: (req as any).user?.id || (data as any).userId,
      metadata: { userName: data.user || data.createdBy || 'admin' }
    }).catch(err => console.error('Error logging PO update activity:', err));

    res.json(purchaseOrders[index]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update purchase order' });
  }
});

// DELETE purchase order
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    purchaseOrders = purchaseOrders.filter(p => p.id !== id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete purchase order' });
  }
});

export default router;
