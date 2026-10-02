import { Router, Request, Response } from 'express';
import { logActivity, createFieldDiffDescription, createFieldDiffDescriptionAsync } from '../services/activityLogger';

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

// Helper function to generate dynamic PR ID in format PR-YYYY-MM-00001
export function generateMaterialRequestId(transactionDate?: string): { id: string; series: string } {
  let dateObj: Date;
  if (transactionDate) {
    const parts = transactionDate.split('-');
    if (parts.length >= 2) {
      const yearNum = parseInt(parts[0], 10);
      const monthNum = parseInt(parts[1], 10) - 1;
      const dayNum = parts[2] ? parseInt(parts[2], 10) : 1;
      dateObj = new Date(yearNum, monthNum, dayNum);
    } else {
      dateObj = new Date(transactionDate);
    }
  } else {
    dateObj = new Date();
  }

  if (isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const year = dateObj.getFullYear().toString();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const prefix = `PR-${year}-${month}-`;

  let maxNum = 0;
  for (const mr of materialRequests) {
    if (mr.id && typeof mr.id === 'string' && mr.id.startsWith(prefix)) {
      const seqPart = mr.id.slice(prefix.length);
      const num = parseInt(seqPart, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  const numStr = nextNum.toString().padStart(5, '0');
  const id = `${prefix}${numStr}`;
  const series = `PR-.${year}.-.${month}.-`;

  return { id, series };
}

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

// GET next available material request ID
router.get('/next-id', (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const { id, series } = generateMaterialRequestId(typeof date === 'string' ? date : undefined);
    res.json({ id, series });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate next ID' });
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
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const { id: generatedId, series: generatedSeries } = generateMaterialRequestId(data.transactionDate);
    
    // Auto-generate ID in backend if not provided or set to temporary value
    const newId = (data.id && data.id !== 'new') ? data.id : generatedId;
    const series = (data.series && data.series !== 'PR-.YYYY.-.MM.-') ? data.series : generatedSeries;

    const newMaterialRequest = {
      id: newId,
      series: series,
      submit: data.submit !== undefined ? Boolean(data.submit) : (data.status === 'Submitted'),
      docStatus: data.docStatus !== undefined ? Number(data.docStatus) : (data.status === 'Submitted' ? 1 : 0),
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
      attachments: data.attachments || [],
      createdAt: new Date().toISOString(),
      createdBy: data.createdBy || 'Harsh Thakkar',
      updatedAt: new Date().toISOString(),
      items: data.items || []
    };

    materialRequests.unshift(newMaterialRequest);

    // Log Activity in DB
    await logActivity({
      entityType: 'MaterialRequest',
      entityId: newMaterialRequest.id,
      action: 'CREATE',
      description: `created material request`,
      userId: (req as any).user?.id || (data as any).userId,
      metadata: { userName: data.createdBy || 'admin' }
    }).catch(err => console.error('Error logging MR create activity:', err));

    res.status(201).json(newMaterialRequest);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create material request' });
  }
});

// PUT update material request
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const index = materialRequests.findIndex(m => m.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Material Request not found' });
    }

    const oldMR = JSON.parse(JSON.stringify(materialRequests[index]));
    const updatedMR = {
      ...oldMR,
      ...data,
      updatedAt: new Date().toISOString()
    };
    materialRequests[index] = updatedMR;

    // Generate detailed diff description matching Product edit page
    const fieldDiff = await createFieldDiffDescriptionAsync(oldMR, updatedMR);
    let actionDescription = fieldDiff;
    if (oldMR.status !== updatedMR.status) {
      if (updatedMR.status === 'Submitted') {
        actionDescription = fieldDiff !== 'updated record' ? `submitted material request (${fieldDiff})` : 'submitted material request';
      } else if (updatedMR.status === 'Rejected') {
        actionDescription = fieldDiff !== 'updated record' ? `rejected material request (${fieldDiff})` : 'rejected material request';
      }
    }

    // Log Activity in DB
    await logActivity({
      entityType: 'MaterialRequest',
      entityId: id,
      action: updatedMR.status === 'Submitted' ? 'SUBMIT' : 'UPDATE',
      description: actionDescription,
      userId: (req as any).user?.id || (data as any).userId,
      metadata: { userName: data.createdBy || data.lastEditedBy || 'admin' }
    }).catch(err => console.error('Error logging MR update activity:', err));

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
