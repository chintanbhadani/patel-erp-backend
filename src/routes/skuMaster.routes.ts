import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { authorizeRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// GET all SKUs
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { category: { name: { contains: q, mode: 'insensitive' } } }
      ];
    }
    const skus = await prisma.skuMaster.findMany({
      where,
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

    const trimmedName = String(name).trim();
    const trimmedSku = String(sku).trim();

    // Check duplicate SKU Name (case-insensitive)
    const existingName = await prisma.skuMaster.findFirst({
      where: { name: { equals: trimmedName, mode: 'insensitive' } }
    });
    if (existingName) {
      return res.status(409).json({
        error: `SKU name "${trimmedName}" already exists (SKU: ${existingName.sku}). Duplicate SKU names are not allowed.`
      });
    }

    // Check duplicate SKU Code (case-insensitive)
    const existingSku = await prisma.skuMaster.findFirst({
      where: { sku: { equals: trimmedSku, mode: 'insensitive' } }
    });
    if (existingSku) {
      return res.status(409).json({
        error: `SKU code "${trimmedSku}" already exists (${existingSku.name}). Duplicate SKUs are not allowed.`
      });
    }

    const skuMaster = await prisma.skuMaster.create({
      data: { name: trimmedName, sku: trimmedSku, categoryId: categoryId || null },
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

    const trimmedName = name ? String(name).trim() : undefined;
    const trimmedSku = sku ? String(sku).trim() : undefined;

    // Check duplicate SKU Name excluding self
    if (trimmedName) {
      const existingName = await prisma.skuMaster.findFirst({
        where: {
          id: { not: id },
          name: { equals: trimmedName, mode: 'insensitive' }
        }
      });
      if (existingName) {
        return res.status(409).json({
          error: `SKU name "${trimmedName}" already exists (SKU: ${existingName.sku}). Duplicate SKU names are not allowed.`
        });
      }
    }

    // Check duplicate SKU Code excluding self
    if (trimmedSku) {
      const existingSku = await prisma.skuMaster.findFirst({
        where: {
          id: { not: id },
          sku: { equals: trimmedSku, mode: 'insensitive' }
        }
      });
      if (existingSku) {
        return res.status(409).json({
          error: `SKU code "${trimmedSku}" already exists (${existingSku.name}). Duplicate SKUs are not allowed.`
        });
      }
    }

    const skuMaster = await prisma.skuMaster.update({
      where: { id },
      data: {
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(trimmedSku ? { sku: trimmedSku } : {}),
        ...(categoryId !== undefined ? { categoryId: categoryId || null } : {})
      },
      include: { category: true }
    });
    res.json(skuMaster);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'SKU must be unique' });
    }
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

// Process bulk SKUs helper
export async function processBulkSkus(rows: any[]): Promise<{ successCount: number; errors: string[]; createdCount: number; updatedCount: number }> {
  let successCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const name = String(row.name || row['SKU Name'] || row.skuName || row.itemName || '').trim();
      const sku = String(row.sku || row['SKU Code'] || row.skuCode || '').trim();

      if (!name || !sku) {
        errors.push(`Row ${rowNum}: SKU Name and Code are required`);
        continue;
      }

      const categoryName = String(row.category || row.categoryName || row['Category'] || row['Item Group'] || '').trim();
      let categoryId: number | null = null;
      if (categoryName) {
        const cat = await prisma.category.findFirst({
          where: { name: { equals: categoryName, mode: 'insensitive' } }
        });
        if (cat) categoryId = cat.id;
      }

      const existing = await prisma.skuMaster.findFirst({
        where: {
          OR: [
            { sku: { equals: sku, mode: 'insensitive' } },
            { name: { equals: name, mode: 'insensitive' } }
          ]
        }
      });

      if (existing) {
        await prisma.skuMaster.update({
          where: { id: existing.id },
          data: {
            name,
            sku,
            ...(categoryId !== null ? { categoryId } : {})
          }
        });
        updatedCount++;
      } else {
        await prisma.skuMaster.create({
          data: {
            name,
            sku,
            categoryId
          }
        });
        createdCount++;
      }

      successCount++;
    } catch (err: any) {
      errors.push(`Row ${rowNum}: ${err.message || 'Failed to process SKU'}`);
    }
  }

  return { successCount, createdCount, updatedCount, errors };
}

// POST bulk import SKUs (JSON array)
router.post('/bulk-import', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const items = req.body.items || req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No SKU records provided for import' });
    }

    const result = await processBulkSkus(items);

    res.json({
      message: `Successfully processed ${result.successCount} SKUs (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk import SKUs error:', error);
    res.status(500).json({ error: 'Failed to process bulk import', message: error?.message });
  }
});

// POST bulk upload SKUs (multipart Excel file)
router.post('/bulk-upload', authorizeRole('PLANT_ADMIN'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any>(sheet);

    const result = await processBulkSkus(rows);

    res.json({
      message: `Successfully processed ${result.successCount} SKUs (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk upload SKUs error:', error);
    res.status(500).json({ error: 'Failed to process bulk upload', message: error?.message });
  }
});

export default router;
