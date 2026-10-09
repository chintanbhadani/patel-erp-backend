import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/weighment-ledger - Fetch all weighing ledger records
router.get('/', async (req, res) => {
  try {
    const entries = await prisma.weighmentLedgerEntry.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: entries
    });
  } catch (error: any) {
    console.error('Error fetching weighment ledger entries:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/weighment-ledger - Add a new weighment entry
router.post('/', async (req, res) => {
  try {
    const {
      rollStickerCode,
      ginningStickerCode,
      productionOrderId,
      machineNo,
      productName,
      sizeDimensions,
      color,
      rollGrade,
      grossWeightKg,
      tareWeightKg,
      actualNetWeightKg,
      billedWeightKg,
      giveawayWeightKg,
      strapLengthMeters,
      shift,
      manualSuffix,
      operatorName,
      notes
    } = req.body;

    const newEntry = await prisma.weighmentLedgerEntry.create({
      data: {
        rollStickerCode,
        ginningStickerCode,
        productionOrderId,
        machineNo,
        productName,
        sizeDimensions,
        color,
        rollGrade: rollGrade || 'GRADE_A',
        grossWeightKg: Number(grossWeightKg),
        tareWeightKg: Number(tareWeightKg),
        actualNetWeightKg: Number(actualNetWeightKg),
        billedWeightKg: Number(billedWeightKg),
        giveawayWeightKg: Number(giveawayWeightKg),
        strapLengthMeters: Number(strapLengthMeters),
        shift: shift || 'D',
        manualSuffix: manualSuffix || '1',
        operatorName,
        notes
      }
    });

    res.json({
      success: true,
      data: newEntry,
      message: 'Weighment record saved to database successfully.'
    });
  } catch (error: any) {
    console.error('Error creating weighment entry:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/weighment-ledger/:id - Delete a weighment entry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.weighmentLedgerEntry.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Entry deleted from database successfully.'
    });
  } catch (error: any) {
    console.error('Error deleting weighment entry:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
