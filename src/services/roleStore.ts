import fs from 'fs';
import path from 'path';
import { 
  roles as SEED_ROLES, 
  modules as SEED_MODULES, 
  permissions as SEED_PERMISSIONS,
  ModuleMaster,
  PermissionMaster
} from '../db/seederMasters';

export interface ModulePermissionSelection {
  module: number;
  permissions: number[];
}

export interface StoredRole {
  id: string;
  name: string;
  code: string;
  description: string;
  status: 'Active' | 'Inactive';
  userCount?: number;
  permissionDetails: ModulePermissionSelection[];
  createdAt: string;
  updatedAt: string;
}

export interface ModuleWithPermissions extends ModuleMaster {
  moduleDetail: { id: number; name: string }[];
}

const DATA_FILE = path.resolve(__dirname, '../../roles_store.json');

let rolesList: StoredRole[] = [];

// Helper to construct full permissions for admin
function getFullAdminPermissions(): ModulePermissionSelection[] {
  return SEED_MODULES.map(m => ({
    module: m.id,
    permissions: SEED_PERMISSIONS.filter(p => p.modelId === m.id).map(p => p.id)
  }));
}

// Initial default roles
function buildInitialRoles(): StoredRole[] {
  const fullPermissions = getFullAdminPermissions();

  return SEED_ROLES.map((r) => {
    const isSuperAdmin = r.name.toLowerCase() === 'admin' || r.code === 'ADMIN';

    // If Admin, grant all permissions. Otherwise grant relevant module permissions
    let rolePerms: ModulePermissionSelection[] = [];
    if (isSuperAdmin) {
      rolePerms = JSON.parse(JSON.stringify(fullPermissions));
    } else {
      // Give standard view / list permissions by default
      rolePerms = SEED_MODULES.map(m => ({
        module: m.id,
        permissions: SEED_PERMISSIONS.filter(p => p.modelId === m.id && ['List', 'View Dashboard', 'View History'].includes(p.name)).map(p => p.id)
      })).filter(m => m.permissions.length > 0);
    }

    return {
      id: String(r.id),
      name: r.name,
      code: r.code,
      description: r.description,
      status: r.status,
      permissionDetails: rolePerms,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
}

function loadFromFile() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        rolesList = parsed;
        return;
      }
    }
  } catch (err) {
    console.warn('Could not read roles_store.json, creating initial defaults:', err);
  }

  rolesList = buildInitialRoles();
  saveToFile();
}

function saveToFile() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(rolesList, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write roles_store.json:', err);
  }
}

// Initialize on boot
loadFromFile();

export const roleStore = {
  reload() {
    loadFromFile();
  },

  getModulesWithPermissions(): ModuleWithPermissions[] {
    return SEED_MODULES.map(m => ({
      ...m,
      moduleDetail: SEED_PERMISSIONS.filter(p => p.modelId === m.id).map(p => ({
        id: p.id,
        name: p.name
      }))
    }));
  },

  getAllRoles(): StoredRole[] {
    return rolesList;
  },

  getRoleById(id: string): StoredRole | undefined {
    return rolesList.find(r => r.id === id || r.code.toLowerCase() === id.toLowerCase() || r.name.toLowerCase() === id.toLowerCase());
  },

  createRole(data: {
    name: string;
    code?: string;
    description?: string;
    status?: 'Active' | 'Inactive';
    permissionDetails?: ModulePermissionSelection[];
  }): StoredRole {
    const newId = `role-${Date.now()}`;
    const autoCode = (data.code || data.name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

    const newRole: StoredRole = {
      id: newId,
      name: data.name,
      code: autoCode,
      description: data.description || '',
      status: data.status || 'Active',
      permissionDetails: Array.isArray(data.permissionDetails) ? data.permissionDetails : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    rolesList.unshift(newRole);
    saveToFile();
    return newRole;
  },

  updateRole(id: string, data: {
    name?: string;
    code?: string;
    description?: string;
    status?: 'Active' | 'Inactive';
    permissionDetails?: ModulePermissionSelection[];
  }): StoredRole | null {
    const idx = rolesList.findIndex(r => r.id === id);
    if (idx === -1) return null;

    rolesList[idx] = {
      ...rolesList[idx],
      ...(data.name !== undefined && { name: data.name }),
      ...(data.code !== undefined && { code: data.code }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.permissionDetails !== undefined && { permissionDetails: data.permissionDetails }),
      updatedAt: new Date().toISOString()
    };

    saveToFile();
    return rolesList[idx];
  },

  deleteRole(id: string): boolean {
    const prevLen = rolesList.length;
    rolesList = rolesList.filter(r => r.id !== id);
    if (rolesList.length !== prevLen) {
      saveToFile();
      return true;
    }
    return false;
  }
};
