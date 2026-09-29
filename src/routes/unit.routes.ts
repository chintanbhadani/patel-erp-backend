import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';

const router = Router();
const prisma = new PrismaClient();

// GET all units
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }
    const units = await prisma.unit.findMany({
      where,
      orderBy: { name: 'asc' }
    });
    res.json(units);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch units' });
  }
});

// POST new unit
router.post('/', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const unit = await prisma.unit.create({
      data: { name }
    });

    await logActivity({
      entityType: 'Unit',
      entityId: String(unit.id),
      action: 'CREATE',
      description: `Created unit ${unit.name}`,
      userId: (req as any).user?.id
    });

    res.status(201).json(unit);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create unit' });
  }
});

// PUT update unit
router.put('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const unit = await prisma.unit.update({
      where: { id },
      data: { name }
    });

    await logActivity({
      entityType: 'Unit',
      entityId: String(unit.id),
      action: 'UPDATE',
      description: `Updated unit ${unit.name}`,
      userId: (req as any).user?.id
    });

    res.json(unit);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update unit' });
  }
});

// DELETE unit
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    await prisma.unit.delete({
      where: { id }
    });

    await logActivity({
      entityType: 'Unit',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted unit`,
      userId: (req as any).user?.id
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete unit' });
  }
});

export default router;
