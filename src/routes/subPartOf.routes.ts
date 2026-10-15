import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';
import multer from 'multer';
import * as xlsx from 'xlsx';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// GET all SubPartOf entries
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }
    const items = await prisma.subPartOf.findMany({
      where,
      orderBy: { id: 'asc' }
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Sub Part Of entries' });
  }
});

// GET SubPartOf by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    const item = await prisma.subPartOf.findUnique({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });
    if (!item) {
      return res.status(404).json({ error: 'Sub Part Of entry not found' });
    }
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Sub Part Of details' });
  }
});

// POST new SubPartOf
router.post('/', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { name, disabled } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const item = await prisma.subPartOf.create({
      data: {
        name: name.trim(),
        disabled: disabled !== undefined ? Boolean(disabled) : false
      }
    });

    await logActivity({
      entityType: 'SubPartOf',
      entityId: String(item.id),
      action: 'CREATE',
      description: `Created Sub Part Of ${item.name}`,
      userId: (req as any).user?.id
    });

    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create Sub Part Of entry' });
  }
});

// PUT update SubPartOf
router.put('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, disabled } = req.body;

    const numId = parseInt(id, 10);
    const item = await prisma.subPartOf.update({
      where: { id: isNaN(numId) ? (id as any) : numId },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        disabled: disabled !== undefined ? Boolean(disabled) : undefined
      }
    });

    await logActivity({
      entityType: 'SubPartOf',
      entityId: String(item.id),
      action: 'UPDATE',
      description: `Updated Sub Part Of ${item.name}`,
      userId: (req as any).user?.id
    });

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update Sub Part Of entry' });
  }
});

// DELETE SubPartOf
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    await prisma.subPartOf.delete({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });

    await logActivity({
      entityType: 'SubPartOf',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted Sub Part Of`,
      userId: (req as any).user?.id
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete Sub Part Of entry' });
  }
});

// Process bulk SubPartOf entries helper
export async function processBulkSubPartOfs(rows: any[]): Promise<{ successCount: number; errors: string[]; createdCount: number; updatedCount: number }> {
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
        row['Sub Part Of Name'] ||
        row.subPartOfName ||
        row['Sub Part Of'] ||
        row.subPartOf ||
        row.Name ||
        ''
      ).trim();

      if (!name) {
        errors.push(`Row ${rowNum}: Sub Part Of Name is required`);
        continue;
      }

      const parseBool = (val: any, def = false): boolean => {
        if (val === undefined || val === null || val === '') return def;
        if (typeof val === 'boolean') return val;
        const s = String(val).toLowerCase().trim();
        return s === 'true' || s === 'yes' || s === '1' || s === 'y';
      };

      const disabled = parseBool(row.disabled || row['Disabled'], false);

      const existing = await prisma.subPartOf.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } }
      });

      if (existing) {
        await prisma.subPartOf.update({
          where: { id: existing.id },
          data: { disabled }
        });
        updatedCount++;
      } else {
        await prisma.subPartOf.create({
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
      return res.status(400).json({ error: 'No Sub Part Of items provided for import' });
    }

    const result = await processBulkSubPartOfs(items);

    res.json({
      message: `Successfully processed ${result.successCount} Sub Part Of items (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk import Sub Part Of error', error);
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

    const result = await processBulkSubPartOfs(rows);

    res.json({
      message: `Successfully processed ${result.successCount} Sub Part Of items (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk upload Sub Part Of error', error);
    res.status(500).json({ error: 'Failed to process bulk upload', message: error?.message });
  }
});

export default router;
