import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const DEFAULT_WEIGHT_LETTER_MAP = {
  '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E',
  '6': 'F', '7': 'G', '8': 'H', '9': 'I', '0': 'J'
};

const DEFAULT_MONTH_LETTER_MAP = {
  '0': 'A',
  '1': 'B',
  '2': 'C',
  '3': 'D',
  '4': 'E',
  '5': 'F',
  '6': 'G',
  '7': 'H',
  '8': 'I',
  '9': 'J',
  '10': 'K',
  '11': 'L'
};

const DEFAULT_YEAR_LETTER_MAP = {
  '2021': 'U', '2022': 'V', '2023': 'W', '2024': 'X', '2025': 'Y', '2026': 'Z', '2027': 'A', '2028': 'B', '2029': 'C', '2030': 'D'
};

const DEFAULT_SHIFT_MAP = {
  'D': 'D',
  'N': 'N'
};

// GET /api/sticker-config - Get or initialize sticker code mapping config
router.get('/', async (req, res) => {
  try {
    let config = await prisma.stickerCodeConfig.findUnique({
      where: { key: 'DEFAULT' }
    });

    if (!config) {
      config = await prisma.stickerCodeConfig.create({
        data: {
          key: 'DEFAULT',
          weightLetterMap: DEFAULT_WEIGHT_LETTER_MAP,
          monthLetterMap: DEFAULT_MONTH_LETTER_MAP,
          yearLetterMap: DEFAULT_YEAR_LETTER_MAP,
          shiftMap: DEFAULT_SHIFT_MAP
        }
      });
    }

    res.json({
      success: true,
      data: config
    });
  } catch (error: any) {
    console.error('Error fetching sticker code config:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/sticker-config - Update sticker code mapping config in database
router.put('/', async (req, res) => {
  try {
    const { weightLetterMap, monthLetterMap, yearLetterMap, shiftMap } = req.body;

    const config = await prisma.stickerCodeConfig.upsert({
      where: { key: 'DEFAULT' },
      update: {
        weightLetterMap: weightLetterMap || DEFAULT_WEIGHT_LETTER_MAP,
        monthLetterMap: monthLetterMap || DEFAULT_MONTH_LETTER_MAP,
        yearLetterMap: yearLetterMap || DEFAULT_YEAR_LETTER_MAP,
        shiftMap: shiftMap || DEFAULT_SHIFT_MAP
      },
      create: {
        key: 'DEFAULT',
        weightLetterMap: weightLetterMap || DEFAULT_WEIGHT_LETTER_MAP,
        monthLetterMap: monthLetterMap || DEFAULT_MONTH_LETTER_MAP,
        yearLetterMap: yearLetterMap || DEFAULT_YEAR_LETTER_MAP,
        shiftMap: shiftMap || DEFAULT_SHIFT_MAP
      }
    });

    res.json({
      success: true,
      data: config,
      message: 'Sticker code configuration updated successfully in database.'
    });
  } catch (error: any) {
    console.error('Error updating sticker code config:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
