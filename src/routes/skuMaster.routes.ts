import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// GET all SKUs
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const skus = await prisma.skuMaster.findMany({
      include: { category: true },
      orderBy: { name: 'asc' }
    });
    res.json(skus);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch SKUs' });
  }
});

// POST new SKU
router.post('/', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { name, sku, categoryId } = req.body;
    if (!name || !sku) {
      return res.status(400).json({ error: 'Name and SKU are required' });
    }
    const skuMaster = await prisma.skuMaster.create({
      data: { name, sku, categoryId: categoryId || null },
      include: { category: true }
    });
    res.status(201).json(skuMaster);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'SKU must be unique' });
    }
    res.status(500).json({ error: 'Failed to create SKU' });
  }
});

// PUT update SKU
router.put('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, sku, categoryId } = req.body;
    const skuMaster = await prisma.skuMaster.update({
      where: { id },
      data: { name, sku, categoryId: categoryId || null },
      include: { category: true }
    });
    res.json(skuMaster);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update SKU' });
  }
});

// DELETE SKU
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.skuMaster.delete({
      where: { id }
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete SKU' });
  }
});

export default router;
