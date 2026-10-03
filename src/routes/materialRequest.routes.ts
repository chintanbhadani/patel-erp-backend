import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logActivity, createFieldDiffDescriptionAsync } from '../services/activityLogger';

const router = Router();
const prisma = new PrismaClient();

// Helper to generate dynamic PR ID in format PR-YYYY-MM-00001
export async function generateMaterialRequestId(transactionDate?: string): Promise<{ id: string; series: string }> {
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

  const count = await prisma.materialRequest.count({
    where: {
      id: { startsWith: prefix }
    }
  });

  const nextNum = count + 1;
  const numStr = nextNum.toString().padStart(5, '0');
  const id = `${prefix}${numStr}`;
  const series = `PR-.${year}.-.${month}.-`;

  return { id, series };
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

async function getAcceptedGrnItems() {
  const acceptedGrns = await prisma.grn.findMany({
    where: { status: 'ACCEPTED' },
    include: { items: true }
  });
  const items: any[] = [];
  for (const g of acceptedGrns) {
    if (g.items) items.push(...g.items);
  }
  return items;
}

function computeMaterialRequestStatusAndReceivedQty(mr: any, acceptedGrnItems: any[]) {
  const grnItemsMap = new Map<string, number>();
  for (const gi of acceptedGrnItems) {
    if (gi.productId) {
      const current = grnItemsMap.get(gi.productId) || 0;
      grnItemsMap.set(gi.productId, current + Number(gi.acceptedQuantity || 0));
    }
    if (gi.remarks) {
      const skuCode = String(gi.remarks).split(':')[0].trim().toLowerCase();
      const current = grnItemsMap.get(skuCode) || 0;
      grnItemsMap.set(skuCode, current + Number(gi.acceptedQuantity || 0));
    }
  }

  let totalReq = 0;
  let totalRec = 0;

  const items = (mr.items || []).map((it: any) => {
    const skuCode = String(it.itemCode || '').split(':')[0].trim().toLowerCase();
    const grnReceived = (it.productId ? grnItemsMap.get(it.productId) : 0) || grnItemsMap.get(skuCode) || 0;
    const receivedQty = Math.max(Number(it.receivedQty || 0), grnReceived);

    totalReq += Number(it.quantity || 0);
    totalRec += receivedQty;

    return {
      ...it,
      receivedQty,
      requiredByDate: it.requiredByDate ? (typeof it.requiredByDate === 'string' ? it.requiredByDate : it.requiredByDate.toISOString().split('T')[0]) : ''
    };
  });

  let status = mr.status || 'Submitted';
  if (totalReq > 0) {
    if (totalRec >= totalReq) {
      status = 'Received';
    } else if (totalRec > 0) {
      status = 'Partially Received';
    }
  }

  return {
    ...mr,
    status,
    materialRequestCode: mr.materialRequestCode || mr.id,
    transactionDate: mr.transactionDate ? (typeof mr.transactionDate === 'string' ? mr.transactionDate : mr.transactionDate.toISOString().split('T')[0]) : '',
    requiredByDate: mr.requiredByDate ? (typeof mr.requiredByDate === 'string' ? mr.requiredByDate : mr.requiredByDate.toISOString().split('T')[0]) : '',
    items
  };
}

// GET all material requests
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;

    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { materialRequestCode: { contains: q, mode: 'insensitive' } },
        { purpose: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { items: { some: { itemCode: { contains: q, mode: 'insensitive' } } } }
      ];
    }

    const mrs = await prisma.materialRequest.findMany({
      where,
      include: {
        items: {
          include: { product: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const acceptedGrnItems = await getAcceptedGrnItems();
    const formatted = mrs.map(m => computeMaterialRequestStatusAndReceivedQty(m, acceptedGrnItems));

    res.json(formatted);
  } catch (error: any) {
    console.error('Error fetching material requests:', error);
    res.status(500).json({ error: 'Failed to fetch material requests' });
  }
});

// GET next available material request ID
router.get('/next-id', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const { id, series } = await generateMaterialRequestId(typeof date === 'string' ? date : undefined);
    res.json({ id, series });
  } catch (error: any) {
    console.error('Error generating next ID:', error);
    res.status(500).json({ error: 'Failed to generate next ID' });
  }
});

// GET single material request by ID or materialRequestCode
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const mr = await prisma.materialRequest.findFirst({
      where: {
        OR: [
          { id },
          { materialRequestCode: id }
        ]
      },
      include: {
        items: {
          include: { product: true }
        }
      }
    });

    if (!mr) {
      return res.status(404).json({ error: 'Material Request not found' });
    }

    const acceptedGrnItems = await getAcceptedGrnItems();
    const formatted = computeMaterialRequestStatusAndReceivedQty(mr, acceptedGrnItems);

    res.json(formatted);
  } catch (error: any) {
    console.error('Error fetching material request:', error);
    res.status(500).json({ error: 'Failed to fetch material request' });
  }
});

// POST create material request
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const { id: generatedCode, series: generatedSeries } = await generateMaterialRequestId(data.transactionDate);
    
    const mrCode = (data.materialRequestCode || data.id) && (data.id !== 'new' && data.materialRequestCode !== 'new') 
      ? (data.materialRequestCode || data.id) 
      : generatedCode;
    const series = (data.series && data.series !== 'PR-.YYYY.-.MM.-') ? data.series : generatedSeries;

    const itemsData = await Promise.all((data.items || []).map(async (it: any) => {
      const pId = await resolveProductId(it.productId, it.itemCode);
      return {
        itemCode: it.itemCode || '',
        productId: pId,
        sparePart: it.sparePart || '',
        requiredByDate: it.requiredByDate ? new Date(it.requiredByDate) : null,
        quantity: Number(it.quantity) || 1,
        uom: it.uom || 'Pcs'
      };
    }));

    const created = await prisma.materialRequest.create({
      data: {
        id: mrCode,
        materialRequestCode: mrCode,
        series: series,
        approvalStatus: data.approvalStatus || 'Draft',
        status: data.status || 'Draft',
        purpose: data.purpose || 'Purchase',
        transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(),
        requiredByDate: data.requiredByDate ? new Date(data.requiredByDate) : null,
        department: data.department || 'PURCHASING',
        requiredFor: data.requiredFor || '',
        priceList: data.priceList || 'Standard Buying',
        company: data.company || 'PATEL STRAP INDUSTRIES LTD',
        attendBy: data.attendBy || 'System User',
        purchaseType: data.purchaseType || 'Local',
        setWarehouse: data.setWarehouse || '',
        assignedTo: data.assignedTo || 'Administrator',
        tags: data.tags || '',
        attachments: data.attachments || [],
        createdBy: data.createdBy || 'Administrator',
        items: {
          create: itemsData
        }
      },
      include: {
        items: {
          include: { product: true }
        }
      }
    });

    // Log Activity in DB once
    await logActivity({
      entityType: 'MaterialRequest',
      entityId: created.materialRequestCode || created.id,
      action: 'CREATE',
      description: `created material request`,
      userId: (req as any).user?.id || (data as any).userId,
      metadata: { userName: data.createdBy || 'admin' }
    }).catch(err => console.error('Error logging MR create activity:', err));

    const formatted = {
      ...created,
      materialRequestCode: created.materialRequestCode || created.id,
      transactionDate: created.transactionDate ? created.transactionDate.toISOString().split('T')[0] : '',
      requiredByDate: created.requiredByDate ? created.requiredByDate.toISOString().split('T')[0] : '',
      items: created.items.map(it => ({
        ...it,
        requiredByDate: it.requiredByDate ? it.requiredByDate.toISOString().split('T')[0] : ''
      }))
    };

    res.status(201).json(formatted);
  } catch (error: any) {
    console.error('Error creating material request:', error);
    res.status(500).json({ error: error.message || 'Failed to create material request' });
  }
});

// PUT update material request
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existing = await prisma.materialRequest.findFirst({
      where: {
        OR: [
          { id },
          { materialRequestCode: id }
        ]
      },
      include: { items: true }
    });

    const itemsData = await Promise.all((data.items || []).map(async (it: any) => {
      const pId = await resolveProductId(it.productId, it.itemCode);
      return {
        itemCode: it.itemCode || '',
        productId: pId,
        sparePart: it.sparePart || '',
        requiredByDate: it.requiredByDate ? new Date(it.requiredByDate) : null,
        quantity: Number(it.quantity) || 1,
        uom: it.uom || 'Pcs'
      };
    }));

    let updated;
    if (!existing) {
      // Upsert: Create if not existing
      const { id: generatedCode, series: generatedSeries } = await generateMaterialRequestId(data.transactionDate);
      const mrCode = data.materialRequestCode || id || generatedCode;
      updated = await prisma.materialRequest.create({
        data: {
          id: mrCode,
          materialRequestCode: mrCode,
          series: data.series || generatedSeries,
          approvalStatus: data.approvalStatus || 'Draft',
          status: data.status || 'Draft',
          purpose: data.purpose || 'Purchase',
          transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(),
          requiredByDate: data.requiredByDate ? new Date(data.requiredByDate) : null,
          department: data.department || 'PURCHASING',
          requiredFor: data.requiredFor || '',
          priceList: data.priceList || 'Standard Buying',
          company: data.company || 'PATEL STRAP INDUSTRIES LTD',
          attendBy: data.attendBy || 'System User',
          purchaseType: data.purchaseType || 'Local',
          setWarehouse: data.setWarehouse || '',
          assignedTo: data.assignedTo || 'Administrator',
          tags: data.tags || '',
          attachments: data.attachments || [],
          createdBy: data.createdBy || 'Administrator',
          items: {
            create: itemsData
          }
        },
        include: {
          items: {
            include: { product: true }
          }
        }
      });

      await logActivity({
        entityType: 'MaterialRequest',
        entityId: updated.materialRequestCode || updated.id,
        action: 'CREATE',
        description: `created material request`,
        userId: (req as any).user?.id || (data as any).userId,
        metadata: { userName: data.createdBy || 'admin' }
      }).catch(err => console.error('Error logging MR create activity:', err));
    } else {
      // Re-create items
      await prisma.materialRequestItem.deleteMany({
        where: { materialRequestId: existing.id }
      });

      updated = await prisma.materialRequest.update({
        where: { id: existing.id },
        data: {
          materialRequestCode: data.materialRequestCode || existing.materialRequestCode || existing.id,
          series: data.series !== undefined ? data.series : existing.series,
          status: data.status !== undefined ? data.status : existing.status,
          approvalStatus: data.approvalStatus !== undefined ? data.approvalStatus : existing.approvalStatus,
          purpose: data.purpose !== undefined ? data.purpose : existing.purpose,
          transactionDate: data.transactionDate ? new Date(data.transactionDate) : existing.transactionDate,
          requiredByDate: data.requiredByDate ? new Date(data.requiredByDate) : existing.requiredByDate,
          department: data.department !== undefined ? data.department : existing.department,
          requiredFor: data.requiredFor !== undefined ? data.requiredFor : existing.requiredFor,
          priceList: data.priceList !== undefined ? data.priceList : existing.priceList,
          company: data.company !== undefined ? data.company : existing.company,
          attendBy: data.attendBy !== undefined ? data.attendBy : existing.attendBy,
          purchaseType: data.purchaseType !== undefined ? data.purchaseType : existing.purchaseType,
          setWarehouse: data.setWarehouse !== undefined ? data.setWarehouse : existing.setWarehouse,
          assignedTo: data.assignedTo !== undefined ? data.assignedTo : existing.assignedTo,
          tags: data.tags !== undefined ? data.tags : existing.tags,
          attachments: data.attachments !== undefined ? data.attachments : (existing.attachments as any),
          items: {
            create: itemsData
          }
        },
        include: {
          items: {
            include: { product: true }
          }
        }
      });

      // Log Activity diff only if changes detected
      const fieldDiff = await createFieldDiffDescriptionAsync(existing, updated);
      if (fieldDiff !== 'updated record' || existing.status !== updated.status) {
        let actionDescription = fieldDiff;
        if (existing.status !== updated.status) {
          if (updated.status === 'Submitted') {
            actionDescription = fieldDiff !== 'updated record' ? `submitted material request (${fieldDiff})` : 'submitted material request';
          } else if (updated.status === 'Rejected') {
            actionDescription = fieldDiff !== 'updated record' ? `rejected material request (${fieldDiff})` : 'rejected material request';
          }
        }

        await logActivity({
          entityType: 'MaterialRequest',
          entityId: updated.materialRequestCode || updated.id,
          action: updated.status === 'Submitted' ? 'SUBMIT' : 'UPDATE',
          description: actionDescription,
          userId: (req as any).user?.id || (data as any).userId,
          metadata: { userName: data.createdBy || data.lastEditedBy || 'admin' }
        }).catch(err => console.error('Error logging MR update activity:', err));
      }
    }

    const formatted = {
      ...updated,
      materialRequestCode: updated.materialRequestCode || updated.id,
      transactionDate: updated.transactionDate ? updated.transactionDate.toISOString().split('T')[0] : '',
      requiredByDate: updated.requiredByDate ? updated.requiredByDate.toISOString().split('T')[0] : '',
      items: updated.items.map(it => ({
        ...it,
        requiredByDate: it.requiredByDate ? it.requiredByDate.toISOString().split('T')[0] : ''
      }))
    };

    res.json(formatted);
  } catch (error: any) {
    console.error('Error updating material request:', error);
    res.status(500).json({ error: error.message || 'Failed to update material request' });
  }
});

// DELETE material request
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.materialRequest.findFirst({
      where: {
        OR: [
          { id },
          { materialRequestCode: id }
        ]
      }
    });

    if (existing) {
      await prisma.materialRequest.delete({
        where: { id: existing.id }
      });
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting material request:', error);
    res.status(500).json({ error: 'Failed to delete material request' });
  }
});

export default router;
