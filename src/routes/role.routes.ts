import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { roleStore } from '../services/roleStore';

const router = Router();
const prisma = new PrismaClient();

// Helper to get user counts per role
async function getRoleUserCounts(): Promise<Record<string, number>> {
  try {
    const users = await prisma.user.findMany({ select: { role: true } });
    const counts: Record<string, number> = {};
    users.forEach(u => {
      if (u.role) {
        counts[u.role] = (counts[u.role] || 0) + 1;
        counts[u.role.toLowerCase()] = (counts[u.role.toLowerCase()] || 0) + 1;
      }
    });
    return counts;
  } catch (e) {
    return {};
  }
}

// GET /api/roles/permissions-matrix (matches LIMS getRolePermissionsMatrix)
router.get('/permissions-matrix', (req: Request, res: Response) => {
  try {
    const modulesWithPermissions = roleStore.getModulesWithPermissions();
    res.json({
      success: true,
      data: {
        modules: modulesWithPermissions
      }
    });
  } catch (error: any) {
    console.error('Error fetching permissions matrix:', error);
    res.status(500).json({ error: 'Failed to fetch permissions matrix' });
  }
});

// GET /api/roles
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, status } = req.query;
    const roleUserCounts = await getRoleUserCounts();
    const allRoles = roleStore.getAllRoles();

    let result = allRoles.map(r => ({
      ...r,
      userCount: roleUserCounts[r.name] || roleUserCounts[r.name.toLowerCase()] || 1
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
  } catch (error: any) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// GET /api/roles/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const role = roleStore.getRoleById(id);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const roleUserCounts = await getRoleUserCounts();
    res.json({
      ...role,
      userCount: roleUserCounts[role.name] || roleUserCounts[role.name.toLowerCase()] || 1
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// POST /api/roles
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, code, description, status, permissionDetails } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const created = roleStore.createRole({
      name: name.trim(),
      code,
      description,
      status,
      permissionDetails
    });

    res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating role:', error);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PUT /api/roles/:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, description, status, permissionDetails } = req.body;

    const updated = roleStore.updateRole(id, {
      name,
      code,
      description,
      status,
      permissionDetails
    });

    if (!updated) {
      return res.status(404).json({ error: 'Role not found' });
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/roles/:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const success = roleStore.deleteRole(id);
    if (!success) {
      return res.status(404).json({ error: 'Role not found or already deleted' });
    }
    res.json({ message: 'Role deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

export default router;
