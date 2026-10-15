import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';
import multer from 'multer';
import * as xlsx from 'xlsx';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// GET all PartOf entries
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }
    const partOfs = await prisma.partOf.findMany({
      where,
      orderBy: { id: 'asc' }
    });
    res.json(partOfs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Part Of entries' });
  }
});

// GET PartOf by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    const item = await prisma.partOf.findUnique({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });
    if (!item) {
      return res.status(404).json({ error: 'Part Of entry not found' });
    }
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Part Of details' });
  }
});

// POST new PartOf
router.post('/', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { name, disabled } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const item = await prisma.partOf.create({
      data: {
        name: name.trim(),
        disabled: disabled !== undefined ? Boolean(disabled) : false
      }
    });

    await logActivity({
      entityType: 'PartOf',
      entityId: String(item.id),
      action: 'CREATE',
      description: `Created Part Of ${item.name}`,
      userId: (req as any).user?.id
    });

    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create Part Of entry' });
  }
});

// PUT update PartOf
router.put('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, disabled } = req.body;

    const numId = parseInt(id, 10);
    const item = await prisma.partOf.update({
      where: { id: isNaN(numId) ? (id as any) : numId },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        disabled: disabled !== undefined ? Boolean(disabled) : undefined
      }
    });

    await logActivity({
      entityType: 'PartOf',
      entityId: String(item.id),
      action: 'UPDATE',
      description: `Updated Part Of ${item.name}`,
      userId: (req as any).user?.id
    });

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update Part Of entry' });
  }
});

// DELETE PartOf
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    await prisma.partOf.delete({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });

    await logActivity({
      entityType: 'PartOf',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted Part Of`,
      userId: (req as any).user?.id
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete Part Of entry' });
  }
});

// Process bulk PartOf entries helper
export async function processBulkPartOfs(rows: any[]): Promise<{ successCount: number; errors: string[]; createdCount: number; updatedCount: number }> {
  let successCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const name = String(
        row.name ||
        row['Part Of Name'] ||
        row.partOfName ||
        row['Part Of'] ||
        row.partOf ||
        row.Name ||
        ''
      ).trim();

      if (!name) {
        errors.push(`Row ${rowNum}: Part Of Name is required`);
        continue;
      }

      const parseBool = (val: any, def = false): boolean => {
        if (val === undefined || val === null || val === '') return def;
        if (typeof val === 'boolean') return val;
        const s = String(val).toLowerCase().trim();
        return s === 'true' || s === 'yes' || s === '1' || s === 'y';
      };

      const disabled = parseBool(row.disabled || row['Disabled'], false);

      const existing = await prisma.partOf.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } }
      });

      if (existing) {
        await prisma.partOf.update({
          where: { id: existing.id },
          data: { disabled }
        });
        updatedCount++;
      } else {
        await prisma.partOf.create({
          data: { name, disabled }
        });
        createdCount++;
      }

      successCount++;
    } catch (err: any) {
      errors.push(`Row ${rowNum}: ${err.message || 'Failed to process row'}`);
    }
  }

  return { successCount, errors, createdCount, updatedCount };
}

// POST bulk import (JSON array)
router.post('/bulk-import', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const items = req.body.items || req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No Part Of items provided for import' });
    }

    const result = await processBulkPartOfs(items);

    res.json({
      message: `Successfully processed ${result.successCount} Part Of items (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk import Part Of error', error);
    res.status(500).json({ error: 'Failed to process bulk import', message: error?.message });
  }
});

// POST bulk upload (multipart Excel file)
router.post('/bulk-upload', authorizeRole('PLANT_ADMIN'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any>(sheet);

    const result = await processBulkPartOfs(rows);

    res.json({
      message: `Successfully processed ${result.successCount} Part Of items (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk upload Part Of error', error);
    res.status(500).json({ error: 'Failed to process bulk upload', message: error?.message });
  }
});

export default router;
