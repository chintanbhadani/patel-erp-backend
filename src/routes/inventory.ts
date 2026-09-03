import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get Raw Materials Inventory
router.get('/raw', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR', 'QC_INSPECTOR', 'SALES_REP'), async (req, res) => {
  try {
    const rawMaterials = await prisma.inventory.findMany();
    res.json(rawMaterials);
  } catch (error) {
    console.error('Error fetching raw materials:', error);
    res.status(500).json({ error: 'Failed to fetch raw materials inventory' });
  }
});

// Add Raw Material Stock
router.post('/raw', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR'), async (req, res) => {
  try {
    const { materialName, quantityKg } = req.body;
    
    if (!materialName || quantityKg === undefined) {
      return res.status(400).json({ error: 'Missing materialName or quantityKg' });
    }

    const updated = await prisma.inventory.upsert({
      where: { materialName },
      update: { quantityKg: { increment: Number(quantityKg) } },
      create: { materialName, quantityKg: Number(quantityKg) }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add stock' });
  }
});

// Get Finished Goods (Production) Inventory
router.get('/production', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR', 'QC_INSPECTOR', 'SALES_REP'), async (req, res) => {
  try {
    // We fetch all rolls that have passed QC and group them by Machine/Job
    // For simplicity, we just fetch them all with their job details to aggregate on frontend,
    // OR we aggregate them here. Let's return raw list of finished goods and a summary.
    
    const finishedRolls = await prisma.rollEntry.findMany({
      where: {
        status: 'QC_PASSED'
      },
      include: {
        job: true
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    const summary = finishedRolls.reduce((acc, roll) => {
      acc.totalRolls += 1;
      acc.totalWeight += roll.netWeight;
      return acc;
    }, { totalRolls: 0, totalWeight: 0 });

    res.json({
      summary,
      items: finishedRolls
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch production inventory' });
  }
});

export default router;
