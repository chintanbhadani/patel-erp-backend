import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';

const router = Router();
const prisma = new PrismaClient();

// GET all inquiries
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search, status, clientId } = req.query;
    const where: any = {};

    if (clientId) {
      const cId = parseInt(clientId as string, 10);
      if (!isNaN(cId)) where.clientId = cId;
    }

    if (status && typeof status === 'string' && status !== 'ALL') {
      where.status = { equals: status, mode: 'insensitive' };
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { status: { contains: q, mode: 'insensitive' } },
        { client: { companyName: { contains: q, mode: 'insensitive' } } }
      ];
    }

    const inquiries = await prisma.inquiry.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            companyName: true,
            email: true,
            phone: true,
            gstNumber: true,
            assignedRep: { select: { id: true, username: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(inquiries);
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    res.status(500).json({ error: 'Failed to fetch inquiries' });
  }
});

// GET inquiry by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: {
        client: {
          select: {
            id: true,
            companyName: true,
            email: true,
            phone: true,
            gstNumber: true,
            assignedRep: { select: { id: true, username: true } }
          }
        }
      }
    });

    if (!inquiry) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }

    res.json(inquiry);
  } catch (error) {
    console.error('Error fetching inquiry by ID:', error);
    res.status(500).json({ error: 'Failed to fetch inquiry details' });
  }
});

// POST new inquiry
router.post('/', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req: Request, res: Response) => {
  try {
    const { clientId, clientName, sizeInTons, quotedPrice, status } = req.body;

    let targetClientId = clientId ? parseInt(String(clientId), 10) : null;

    if (!targetClientId && clientName) {
      let client = await prisma.client.findFirst({
        where: { companyName: { equals: clientName.trim(), mode: 'insensitive' } }
      });
      if (!client) {
        client = await prisma.client.create({
          data: { companyName: clientName.trim() }
        });
      }
      targetClientId = client.id;
    }

    if (!targetClientId) {
      return res.status(400).json({ error: 'Valid client is required' });
    }

    const inquiry = await prisma.inquiry.create({
      data: {
        clientId: targetClientId,
        sizeInTons: parseFloat(String(sizeInTons || 0)) || 0,
        quotedPrice: parseFloat(String(quotedPrice || 0)) || 0,
        status: status || 'OPEN'
      },
      include: {
        client: true
      }
    });

    await logActivity({
      entityType: 'Inquiry',
      entityId: String(inquiry.id),
      action: 'CREATE',
      description: `Created new inquiry ${inquiry.id} for client ID ${targetClientId}`,
      userId: (req as any).user?.id
    });

    res.status(201).json(inquiry);
  } catch (error) {
    console.error('Error creating inquiry:', error);
    res.status(500).json({ error: 'Failed to create inquiry' });
  }
});

// PUT update inquiry
router.put('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { clientId, sizeInTons, quotedPrice, status } = req.body;

    const dataToUpdate: any = {};
    if (clientId !== undefined) dataToUpdate.clientId = parseInt(String(clientId), 10);
    if (sizeInTons !== undefined) dataToUpdate.sizeInTons = parseFloat(String(sizeInTons)) || 0;
    if (quotedPrice !== undefined) dataToUpdate.quotedPrice = parseFloat(String(quotedPrice)) || 0;
    if (status !== undefined) dataToUpdate.status = status;

    const inquiry = await prisma.inquiry.update({
      where: { id },
      data: dataToUpdate,
      include: {
        client: true
      }
    });

    await logActivity({
      entityType: 'Inquiry',
      entityId: String(id),
      action: 'UPDATE',
      description: `Updated inquiry ${id}`,
      userId: (req as any).user?.id
    });

    res.json(inquiry);
  } catch (error) {
    console.error('Error updating inquiry:', error);
    res.status(500).json({ error: 'Failed to update inquiry' });
  }
});

// DELETE inquiry
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.inquiry.delete({ where: { id } });

    await logActivity({
      entityType: 'Inquiry',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted inquiry ${id}`,
      userId: (req as any).user?.id
    });

    res.json({ message: 'Inquiry deleted successfully' });
  } catch (error) {
    console.error('Error deleting inquiry:', error);
    res.status(500).json({ error: 'Failed to delete inquiry' });
  }
});

export default router;
