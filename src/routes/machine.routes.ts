import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';

const router = Router();
const prisma = new PrismaClient();

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

export default router;
