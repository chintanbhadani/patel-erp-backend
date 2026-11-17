import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';
import multer from 'multer';
import * as xlsx from 'xlsx';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_GRADES = [
  'Manual Grade',
  'Semi-Automatic Grade',
  'Fully Automatic Machine Grade',
  'High Tensile (A-Grade)',
  'Virgin Grade',
  'Commercial Grade'
];

// GET all Grade entries (auto-seeds defaults if table is empty)
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search, disabled, status, onlyEnabled } = req.query;
    const count = await prisma.gradeMaster.count();
    if (count === 0) {
      await prisma.gradeMaster.createMany({
        data: DEFAULT_GRADES.map(name => ({ name, disabled: false }))
      });
    }

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
    const grades = await prisma.gradeMaster.findMany({
      where,
      orderBy: { id: 'asc' }
    });
    res.json(grades);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Grade entries' });
  }
});

// GET Grade by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    const item = await prisma.gradeMaster.findUnique({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });
    if (!item) {
      return res.status(404).json({ error: 'Grade entry not found' });
    }
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Grade details' });
  }
});

// POST new Grade
router.post('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { name, imageUrl, disabled } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Grade name is required' });

    const trimmedName = String(name).trim();

    // Check if already exists (case-insensitive)
    const existing = await prisma.gradeMaster.findFirst({
      where: { name: { equals: trimmedName, mode: 'insensitive' } }
    });
    if (existing) {
      return res.status(200).json(existing);
    }

    const item = await prisma.gradeMaster.create({
      data: {
        name: trimmedName,
        imageUrl: imageUrl || null,
        disabled: disabled !== undefined ? Boolean(disabled) : false
      }
    });

    await logActivity({
      entityType: 'Grade',
      entityId: String(item.id),
      action: 'CREATE',
      description: `Created Grade ${item.name}`,
      userId: (req as any).user?.id
    });

    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create Grade entry' });
  }
});

// PUT update Grade
router.put('/:id', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR', 'SALES_REP'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, imageUrl, disabled } = req.body;

    const numId = parseInt(id, 10);
    const item = await prisma.gradeMaster.update({
      where: { id: isNaN(numId) ? (id as any) : numId },
      data: {
        name: name !== undefined ? String(name).trim() : undefined,
        imageUrl: imageUrl !== undefined ? imageUrl : undefined,
        disabled: disabled !== undefined ? Boolean(disabled) : undefined
      }
    });

    await logActivity({
      entityType: 'Grade',
      entityId: String(item.id),
      action: 'UPDATE',
      description: `Updated Grade ${item.name}`,
      userId: (req as any).user?.id
    });

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update Grade entry' });
  }
});

// DELETE Grade
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    const target = await prisma.gradeMaster.findUnique({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });
    if (!target) {
      return res.status(404).json({ error: 'Grade entry not found' });
    }

    await prisma.gradeMaster.delete({
      where: { id: isNaN(numId) ? (id as any) : numId }
    });

    await logActivity({
      entityType: 'Grade',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted Grade ${target.name}`,
      userId: (req as any).user?.id
    });

    res.json({ message: 'Grade deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete Grade entry' });
  }
});

// POST bulk import Grades from Excel / CSV
router.post('/bulk-import', authorizeRole('PLANT_ADMIN'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload an Excel or CSV file' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any>(sheet);

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'No data found in uploaded file' });
    }

    let createdCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const name = row['Grade Name'] || row['Grade'] || row['Name'] || row['name'];
      if (!name || !String(name).trim()) {
        skippedCount++;
        continue;
      }

      const trimmedName = String(name).trim();
      const existing = await prisma.gradeMaster.findFirst({
        where: { name: { equals: trimmedName, mode: 'insensitive' } }
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      const disabledVal = row['Disabled'] || row['Status'] === 'Disabled' || false;
      await prisma.gradeMaster.create({
        data: {
          name: trimmedName,
          disabled: Boolean(disabledVal)
        }
      });
      createdCount++;
    }

    await logActivity({
      entityType: 'Grade',
      entityId: 'BULK',
      action: 'BULK_IMPORT',
      description: `Bulk imported ${createdCount} Grades (Skipped: ${skippedCount})`,
      userId: (req as any).user?.id
    });

    res.json({
      message: `Successfully imported ${createdCount} Grades (${skippedCount} duplicates/invalid skipped)`,
      createdCount,
      skippedCount
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to import Grade data' });
  }
});

export default router;

