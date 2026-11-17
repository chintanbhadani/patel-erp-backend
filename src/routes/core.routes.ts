import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';
import multer from 'multer';
import * as xlsx from 'xlsx';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// GET all Core entries
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search, disabled, status, onlyEnabled } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }
    if (disabled !== undefined) {
      where.disabled = disabled === 'true' || disabled === '1';
    } else if (status !== undefined) {
      if (String(status).toLowerCase() === 'enabled') where.disabled = false;
      else if (String(status).toLowerCase() === 'disabled') where.disabled = true;
    } else if (onlyEnabled === 'true' || onlyEnabled === '1') {
      where.disabled = false;
    }
    const cores = await prisma.coreMaster.findMany({
      where,
      orderBy: { id: 'asc' }
    });
    res.json(cores);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Core entries' });
  }
});

// GET Core by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    const item = await prisma.coreMaster.findUnique({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });
    if (!item) {
      return res.status(404).json({ error: 'Core entry not found' });
    }
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Core details' });
  }
});

// POST new Core
router.post('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { name, imageUrl, disabled } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Core name is required' });

    const trimmedName = String(name).trim();

    // Check if already exists (case-insensitive)
    const existing = await prisma.coreMaster.findFirst({
      where: { name: { equals: trimmedName, mode: 'insensitive' } }
    });
    if (existing) {
      return res.status(200).json(existing);
    }

    const item = await prisma.coreMaster.create({
      data: {
        name: trimmedName,
        imageUrl: imageUrl || null,
        disabled: disabled !== undefined ? Boolean(disabled) : false
      }
    });

    await logActivity({
      entityType: 'Core',
      entityId: String(item.id),
      action: 'CREATE',
      description: `Created Core ${item.name}`,
      userId: (req as any).user?.id
    });

    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create Core entry' });
  }
});

// PUT update Core
router.put('/:id', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR', 'SALES_REP'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, imageUrl, disabled } = req.body;

    const numId = parseInt(id, 10);
    const item = await prisma.coreMaster.update({
      where: { id: isNaN(numId) ? (id as any) : numId },
      data: {
        name: name !== undefined ? String(name).trim() : undefined,
        imageUrl: imageUrl !== undefined ? imageUrl : undefined,
        disabled: disabled !== undefined ? Boolean(disabled) : undefined
      }
    });

    await logActivity({
      entityType: 'Core',
      entityId: String(item.id),
      action: 'UPDATE',
      description: `Updated Core ${item.name}`,
      userId: (req as any).user?.id
    });

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update Core entry' });
  }
});

// DELETE Core
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    await prisma.coreMaster.delete({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });

    await logActivity({
      entityType: 'Core',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted Core`,
      userId: (req as any).user?.id
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete Core entry' });
  }
});

// Process bulk Core entries helper
export async function processBulkCores(rows: any[]): Promise<{ successCount: number; errors: string[]; createdCount: number; updatedCount: number }> {
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
        row['Core Name'] ||
        row.coreName ||
        row['Core'] ||
        row.core ||
        row.Name ||
        ''
      ).trim();

      if (!name) {
        errors.push(`Row ${rowNum}: Core Name is required`);
        continue;
      }

      const parseBool = (val: any, def = false): boolean => {
        if (val === undefined || val === null || val === '') return def;
        if (typeof val === 'boolean') return val;
        const s = String(val).toLowerCase().trim();
        return s === 'true' || s === 'yes' || s === '1' || s === 'y';
      };

      const disabled = parseBool(row.disabled || row['Disabled'], false);

      const existing = await prisma.coreMaster.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } }
      });

      if (existing) {
        await prisma.coreMaster.update({
          where: { id: existing.id },
          data: { disabled }
        });
        updatedCount++;
      } else {
        await prisma.coreMaster.create({
          data: { name, disabled }
        });
        createdCount++;
      }

      successCount++;
    } catch (err: any) {
      errors.push(`Row ${rowNum}: ${err?.message || 'Failed to import row'}`);
    }
  }

  return { successCount, errors, createdCount, updatedCount };
}

// Bulk import JSON
router.post('/bulk-import', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided for import' });
    }

    const result = await processBulkCores(items);

    await logActivity({
      entityType: 'Core',
      entityId: 'BULK',
      action: 'IMPORT',
      description: `Bulk imported ${result.successCount} Core entries (${result.createdCount} created, ${result.updatedCount} updated)`,
      userId: (req as any).user?.id
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to process bulk import' });
  }
});

export default router;

