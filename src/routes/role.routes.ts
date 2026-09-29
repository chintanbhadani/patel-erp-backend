import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { roles as MASTER_ROLES } from '../db/seederMasters';

const router = Router();
const prisma = new PrismaClient();

export interface RoleData {
  id: string;
  name: string;
  code: string;
  description: string;
  status: 'Active' | 'Inactive';
  userCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

const INITIAL_ROLES: RoleData[] = MASTER_ROLES.map(r => ({
  ...r,
  id: String(r.id)
}));

let memoryRoles: RoleData[] = [...INITIAL_ROLES];

// GET /api/roles
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, status } = req.query;

    let users: any[] = [];
    try {
      users = await prisma.user.findMany({ select: { role: true } });
    } catch (e) {
      users = [];
    }

    const roleUserCounts: Record<string, number> = {};
    users.forEach(u => {
      if (u.role) {
        roleUserCounts[u.role] = (roleUserCounts[u.role] || 0) + 1;
      }
    });

    let result = memoryRoles.map(r => ({
      ...r,
      userCount: roleUserCounts[r.name] || 1
    }));

    if (search) {
      const q = String(search).toLowerCase();
      result = result.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      );
    }

    if (status) {
      result = result.filter(r => r.status === status);
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// GET /api/roles/:id
router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const role = memoryRoles.find(r => r.id === id || r.code === id || r.name.toLowerCase() === id.toLowerCase());
  if (!role) return res.status(404).json({ error: 'Role not found' });
  res.json(role);
});

// POST /api/roles
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, code, description, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const newRole: RoleData = {
      id: `role-${Date.now()}`,
      name,
      code: code || name.toUpperCase().replace(/\s+/g, '_'),
      description: description || '',
      status: status || 'Active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    memoryRoles.unshift(newRole);
    res.status(201).json(newRole);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PUT /api/roles/:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, description, status } = req.body;

    const idx = memoryRoles.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Role not found' });

    memoryRoles[idx] = {
      ...memoryRoles[idx],
      ...(name && { name }),
      ...(code && { code }),
      ...(description !== undefined && { description }),
      ...(status && { status }),
      updatedAt: new Date().toISOString()
    };

    res.json(memoryRoles[idx]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/roles/:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    memoryRoles = memoryRoles.filter(r => r.id !== id);
    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

export default router;
