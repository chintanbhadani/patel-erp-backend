import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_MACHINES = [
  { code: 'EXT-01', name: 'Machine 1 (High-Speed Extrusion Line)', outputKgPerHour: 300, status: 'Running', maxCapacityTonsPerMonth: 30, remarks: 'Primary PET Extrusion Line' },
  { code: 'EXT-02', name: 'Machine 2 (Heavy Duty Strap Line)', outputKgPerHour: 210, status: 'Running', maxCapacityTonsPerMonth: 22, remarks: 'Heavy Duty Strap Manufacturing' },
  { code: 'EXT-03', name: 'Machine 3 (Medium Strap Line)', outputKgPerHour: 132, status: 'Running', maxCapacityTonsPerMonth: 15, remarks: 'Medium Strap Line' },
  { code: 'EXT-04', name: 'Machine 4 (Custom & Light Strap Line)', outputKgPerHour: 90, status: 'Idle', maxCapacityTonsPerMonth: 10, remarks: 'Light gauge strap production' }
];

const normalizeForComparison = (str: string) => {
  return str.trim().toLowerCase().replace(/[\s\-_]+/g, '');
};

// GET all machines (with auto-seeder if empty)
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    let count = await prisma.machineMaster.count();
    
    // Seed defaults if empty
    if (count === 0) {
      for (const def of DEFAULT_MACHINES) {
        await prisma.machineMaster.create({
          data: def
        });
      }
    }

    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' as const } },
        { code: { contains: search.trim(), mode: 'insensitive' as const } }
      ];
    }

    const machines = await prisma.machineMaster.findMany({
      where,
      orderBy: { code: 'asc' }
    });
    res.json(machines);
  } catch (error) {
    console.error('Error fetching machines:', error);
    res.status(500).json({ error: 'Failed to fetch machines' });
  }
});

// GET machine by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const machine = await prisma.machineMaster.findUnique({
      where: { id }
    });
    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }
    res.json(machine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch machine details' });
  }
});

// POST new machine with duplicate name and code validation
router.post('/', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { code, name, outputKgPerHour, status, maxCapacityTonsPerMonth, remarks, disabled } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Machine name is required' });
    }

    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Machine code is required' });
    }

    const trimmedName = name.trim();
    const trimmedCode = code.trim();
    const normalizedName = normalizeForComparison(trimmedName);
    const normalizedCode = normalizeForComparison(trimmedCode);

    // Fetch existing machines to check duplicates
    const allExisting = await prisma.machineMaster.findMany();

    // Check duplicate machine name (case-insensitive & whitespace/symbol normalized)
    const duplicateName = allExisting.find(m => {
      return (
        m.name.trim().toLowerCase() === trimmedName.toLowerCase() ||
        normalizeForComparison(m.name) === normalizedName
      );
    });

    if (duplicateName) {
      return res.status(409).json({
        error: `Machine name "${trimmedName}" already exists (${duplicateName.name}). Duplicate machine names are not allowed.`
      });
    }

    // Check duplicate machine code (case-insensitive & whitespace/symbol normalized)
    const duplicateCode = allExisting.find(m => {
      return (
        m.code.trim().toLowerCase() === trimmedCode.toLowerCase() ||
        normalizeForComparison(m.code) === normalizedCode
      );
    });

    if (duplicateCode) {
      return res.status(409).json({
        error: `Machine code "${trimmedCode}" already exists (${duplicateCode.code}). Duplicate machine codes are not allowed.`
      });
    }

    const machine = await prisma.machineMaster.create({
      data: {
        code: trimmedCode,
        name: trimmedName,
        outputKgPerHour: parseFloat(outputKgPerHour) || 300,
        status: status || 'Running',
        maxCapacityTonsPerMonth: parseFloat(maxCapacityTonsPerMonth) || 20,
        remarks: remarks ? remarks.trim() : null,
        disabled: disabled !== undefined ? Boolean(disabled) : false
      }
    });

    await logActivity({
      entityType: 'MachineMaster',
      entityId: String(machine.id),
      action: 'CREATE',
      description: `Created machine ${machine.name} (${machine.code})`,
      userId: (req as any).user?.id
    });

    res.status(201).json(machine);
  } catch (error: any) {
    console.error('Error creating machine:', error);
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[]) || [];
      return res.status(409).json({
        error: `A machine with this ${target.join(', ') || 'name/code'} already exists.`
      });
    }
    res.status(500).json({ error: error.message || 'Failed to create machine' });
  }
});

// PUT update machine with duplicate name and code validation
router.put('/:id', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const { code, name, outputKgPerHour, status, maxCapacityTonsPerMonth, remarks, disabled } = req.body;

    const existing = await prisma.machineMaster.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    const trimmedName = name !== undefined ? name.trim() : existing.name;
    const trimmedCode = code !== undefined ? code.trim() : existing.code;

    if (!trimmedName) {
      return res.status(400).json({ error: 'Machine name cannot be empty' });
    }
    if (!trimmedCode) {
      return res.status(400).json({ error: 'Machine code cannot be empty' });
    }

    const normalizedName = normalizeForComparison(trimmedName);
    const normalizedCode = normalizeForComparison(trimmedCode);

    // Fetch other machines to check duplicates (excluding self)
    const otherMachines = await prisma.machineMaster.findMany({
      where: {
        id: { not: id }
      }
    });

    // Check duplicate machine name
    const duplicateName = otherMachines.find(m => {
      return (
        m.name.trim().toLowerCase() === trimmedName.toLowerCase() ||
        normalizeForComparison(m.name) === normalizedName
      );
    });

    if (duplicateName) {
      return res.status(409).json({
        error: `Machine name "${trimmedName}" already exists (${duplicateName.name}). Duplicate machine names are not allowed.`
      });
    }

    // Check duplicate machine code
    const duplicateCode = otherMachines.find(m => {
      return (
        m.code.trim().toLowerCase() === trimmedCode.toLowerCase() ||
        normalizeForComparison(m.code) === normalizedCode
      );
    });

    if (duplicateCode) {
      return res.status(409).json({
        error: `Machine code "${trimmedCode}" already exists (${duplicateCode.code}). Duplicate machine codes are not allowed.`
      });
    }

    const updated = await prisma.machineMaster.update({
      where: { id },
      data: {
        code: trimmedCode,
        name: trimmedName,
        outputKgPerHour: outputKgPerHour !== undefined ? parseFloat(outputKgPerHour) : existing.outputKgPerHour,
        status: status !== undefined ? status : existing.status,
        maxCapacityTonsPerMonth: maxCapacityTonsPerMonth !== undefined ? parseFloat(maxCapacityTonsPerMonth) : existing.maxCapacityTonsPerMonth,
        remarks: remarks !== undefined ? (remarks ? remarks.trim() : null) : existing.remarks,
        disabled: disabled !== undefined ? Boolean(disabled) : existing.disabled
      }
    });

    await logActivity({
      entityType: 'MachineMaster',
      entityId: String(updated.id),
      action: 'UPDATE',
      description: `Updated machine ${updated.name} (${updated.code})`,
      userId: (req as any).user?.id
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating machine:', error);
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[]) || [];
      return res.status(409).json({
        error: `A machine with this ${target.join(', ') || 'name/code'} already exists.`
      });
    }
    res.status(500).json({ error: error.message || 'Failed to update machine' });
  }
});

// DELETE machine
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = await prisma.machineMaster.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    await prisma.machineMaster.delete({
      where: { id }
    });

    await logActivity({
      entityType: 'MachineMaster',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted machine ${existing.name} (${existing.code})`,
      userId: (req as any).user?.id
    });

    res.json({ message: 'Machine deleted successfully' });
  } catch (error) {
    console.error('Error deleting machine:', error);
    res.status(500).json({ error: 'Failed to delete machine' });
  }
});

// Process bulk machines helper
export async function processBulkMachines(rows: any[], currentUserId?: string): Promise<{ successCount: number; errors: string[]; createdCount: number; updatedCount: number }> {
  let successCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const code = String(
        row.code ||
        row['Machine Code'] ||
        row.machineCode ||
        row.machine_code ||
        row.Code ||
        ''
      ).trim();

      const name = String(
        row.name ||
        row['Machine Name'] ||
        row.machineName ||
        row.machine_name ||
        row.Name ||
        ''
      ).trim();

      if (!code && !name) {
        errors.push(`Row ${rowNum}: Machine Code or Name is required`);
        continue;
      }

      const finalCode = code || `M-${String(i + 1).padStart(2, '0')}`;
      const finalName = name || finalCode;

      const outputKgPerHour = parseFloat(
        row.outputKgPerHour ||
        row['Output (KG/Hr)'] ||
        row['Capacity (KG/Hr)'] ||
        row.output ||
        row['outputKgPerHour'] ||
        row['Output Kg Per Hour'] ||
        300
      ) || 300;

      const maxCapacityTonsPerMonth = parseFloat(
        row.maxCapacityTonsPerMonth ||
        row['Monthly Capacity (Tons)'] ||
        row['Max Capacity (Tons)'] ||
        row.maxCapacity ||
        row['maxCapacityTonsPerMonth'] ||
        20
      ) || 20;

      const statusRaw = String(row.status || row['Status'] || 'Running').trim();
      let status = 'Running';
      if (/idle/i.test(statusRaw)) status = 'Idle';
      else if (/maintenance/i.test(statusRaw)) status = 'Maintenance';
      else if (/disabled|inactive/i.test(statusRaw)) status = 'Disabled';
      else status = 'Running';

      const remarks = String(row.remarks || row['Remarks'] || row.notes || row['Notes'] || '').trim() || null;

      const parseBool = (val: any, def = false): boolean => {
        if (val === undefined || val === null || val === '') return def;
        if (typeof val === 'boolean') return val;
        const s = String(val).toLowerCase().trim();
        return s === 'true' || s === 'yes' || s === '1' || s === 'y';
      };

      const disabled = parseBool(row.disabled || row['Disabled'], status === 'Disabled');

      const existing = await prisma.machineMaster.findFirst({
        where: {
          OR: [
            { code: { equals: finalCode, mode: 'insensitive' } },
            { name: { equals: finalName, mode: 'insensitive' } }
          ]
        }
      });

      if (existing) {
        await prisma.machineMaster.update({
          where: { id: existing.id },
          data: {
            code: finalCode,
            name: finalName,
            outputKgPerHour,
            maxCapacityTonsPerMonth,
            status,
            remarks: remarks || existing.remarks,
            disabled
          }
        });
        updatedCount++;
      } else {
        await prisma.machineMaster.create({
          data: {
            code: finalCode,
            name: finalName,
            outputKgPerHour,
            maxCapacityTonsPerMonth,
            status,
            remarks,
            disabled
          }
        });
        createdCount++;
      }

      successCount++;
    } catch (err: any) {
      errors.push(`Row ${rowNum}: ${err.message || 'Failed to process machine row'}`);
    }
  }

  if (successCount > 0) {
    try {
      await logActivity({
        entityType: 'MachineMaster',
        entityId: 'BULK',
        action: 'BULK_IMPORT',
        description: `Bulk imported ${successCount} machines (${createdCount} created, ${updatedCount} updated)`,
        userId: currentUserId
      });
    } catch (logErr) {
      console.warn('Failed to log bulk machine import activity', logErr);
    }
  }

  return { successCount, createdCount, updatedCount, errors };
}

// POST bulk import (JSON array)
router.post('/bulk-import', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const items = req.body.items || req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No machine records provided for import' });
    }

    const currentUserId = (req as any).user?.id;
    const result = await processBulkMachines(items, currentUserId);

    res.json({
      message: `Successfully processed ${result.successCount} machines (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk import machines error:', error);
    res.status(500).json({ error: 'Failed to process bulk import', message: error?.message });
  }
});

// POST bulk upload (multipart Excel file)
router.post('/bulk-upload', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any>(sheet);

    const currentUserId = (req as any).user?.id;
    const result = await processBulkMachines(rows, currentUserId);

    res.json({
      message: `Successfully processed ${result.successCount} machines (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk upload machines error:', error);
    res.status(500).json({ error: 'Failed to process bulk upload', message: error?.message });
  }
});

export default router;
