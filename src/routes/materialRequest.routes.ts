import { Router, Request, Response } from 'express';

const router = Router();

// In-memory material request store initialized with default requests
let materialRequests: any[] = [
  {
    id: 'PR-2026-08-00013',
    series: 'PR-.2026.-.08.-',
    approvalStatus: 'Approved',
    status: 'Partially Received',
    purpose: 'Purchase',
    transactionDate: '2026-08-13',
    requiredByDate: '2026-08-13',
    department: 'HEALTH & SAFETY',
    requiredFor: 'HSE ITEMS',
    priceList: 'Standard Buying',
    company: 'PATEL STRAP INDUSTRIES LTD',
    attendBy: 'JAYDEEP DHAKAN',
    purchaseType: 'Local',
    setWarehouse: 'Main Store - PSL',
    assignedTo: 'Administrator',
    createdBy: 'Harsh Thakkar',
    tags: 'HEALTH & SAFETY,PURCHASE',
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    items: [
      { id: '1', itemCode: 'NGMD008: AMOXYCLAVE TABLET', sparePart: '', requiredByDate: '2026-08-13', quantity: 10, uom: 'Pcs' },
      { id: '2', itemCode: 'NGMD023: AMPLICLOX TABLETS', sparePart: '', requiredByDate: '2026-08-13', quantity: 10, uom: 'BOX' },
      { id: '3', itemCode: 'NGMD004: CETRIZINE TABLETS', sparePart: '', requiredByDate: '2026-08-13', quantity: 10, uom: 'Pcs' }
    ]
  },
  {
    id: 'PR-2026-08-00012',
    series: 'PR-.2026.-.08.-',
    approvalStatus: 'Approved',
    status: 'Submitted',
    purpose: 'Purchase',
    transactionDate: '2026-08-12',
    requiredByDate: '2026-08-12',
    department: 'PURCHASE',
    requiredFor: 'OFFICE SUPPLIES',
    priceList: 'Standard Buying',
    company: 'PATEL STRAP INDUSTRIES LTD',
    attendBy: 'Nayan Vegad',
    purchaseType: 'Local',
    setWarehouse: 'Main Store - PSL',
    assignedTo: 'Nayan Vegad',
    createdBy: 'Administrator',
    tags: 'PURCHASE',
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    items: [
      { id: '1', itemCode: 'NG00012: A4 PAPER RIM', sparePart: '', requiredByDate: '2026-08-12', quantity: 20, uom: 'BOX' }
    ]
  },
  {
    id: 'PR-2026-08-00011',
    series: 'PR-.2026.-.08.-',
    approvalStatus: 'Pending',
    status: 'Draft',
    purpose: 'Material Issue',
    transactionDate: '2026-08-10',
    requiredByDate: '2026-08-10',
    department: 'MAINTENANCE',
    requiredFor: 'BEARING REPLACEMENT',
    priceList: 'Standard Buying',
    company: 'PATEL STRAP INDUSTRIES LTD',
    attendBy: 'Administrator',
    purchaseType: 'Local',
    setWarehouse: 'Workshop Store',
    assignedTo: 'Administrator',
    createdBy: 'Harsh Thakkar',
    tags: 'MAINTENANCE',
    updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    items: [
      { id: '1', itemCode: 'BRG-6204-ZZ', sparePart: 'BEARING', requiredByDate: '2026-08-10', quantity: 5, uom: 'Pcs' }
    ]
  }
];

let nextNumber = 14;

// GET all material requests
router.get('/', (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      const filtered = materialRequests.filter(mr => 
        mr.id.toLowerCase().includes(q) || 
        mr.purpose?.toLowerCase().includes(q) ||
        mr.company?.toLowerCase().includes(q) ||
        mr.items?.some((i: any) => i.itemCode?.toLowerCase().includes(q))
      );
      return res.json(filtered);
    }
    res.json(materialRequests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch material requests' });
  }
});

// GET single material request by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const mr = materialRequests.find(m => m.id === id);
    if (!mr) {
      return res.status(404).json({ error: 'Material Request not found' });
    }
    res.json(mr);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch material request' });
  }
});

// POST create material request
router.post('/', (req: Request, res: Response) => {
  try {
    const data = req.body;
    const numStr = (nextNumber++).toString().padStart(5, '0');
    const newId = `PR-2026-08-${numStr}`;

    const newMaterialRequest = {
      id: newId,
      series: data.series || 'PR-.YYYY.-.MM.-',
      approvalStatus: data.approvalStatus || 'Draft',
      status: data.status || 'Draft',
      purpose: data.purpose || 'Purchase',
      transactionDate: data.transactionDate || new Date().toISOString().split('T')[0],
      requiredByDate: data.requiredByDate || new Date().toISOString().split('T')[0],
      department: data.department || 'PURCHASING',
      requiredFor: data.requiredFor || '',
      priceList: data.priceList || 'Standard Buying',
      company: data.company || 'PATEL STRAP INDUSTRIES LTD',
      attendBy: data.attendBy || 'System User',
      purchaseType: data.purchaseType || 'Local',
      linkedSpareRequisition: data.linkedSpareRequisition || '',
      scanBarcode: data.scanBarcode || '',
      setWarehouse: data.setWarehouse || '',
      assignedTo: data.assignedTo || 'Harsh Thakkar',
      tags: data.tags || '',
      createdAt: new Date().toISOString(),
      createdBy: data.createdBy || 'Harsh Thakkar',
      updatedAt: new Date().toISOString(),
      items: data.items || []
    };

    materialRequests.unshift(newMaterialRequest);
    res.status(201).json(newMaterialRequest);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create material request' });
  }
});

// PUT update material request
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const index = materialRequests.findIndex(m => m.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Material Request not found' });
    }

    materialRequests[index] = {
      ...materialRequests[index],
      ...data,
      updatedAt: new Date().toISOString()
    };

    res.json(materialRequests[index]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update material request' });
  }
});

// DELETE material request
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    materialRequests = materialRequests.filter(m => m.id !== id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete material request' });
  }
});

export default router;
