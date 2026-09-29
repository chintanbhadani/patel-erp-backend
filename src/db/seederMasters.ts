/**
 * Central Seeder Master Configuration for Patel Strap ERP
 * 
 * Each item has an explicit numeric ID (1, 2, 3, ...) for easy readability and manual entry.
 * The seeders will check if an entry already exists before inserting.
 */

export interface RoleMaster {
  id: number;
  name: string;
  code: string;
  description: string;
  status: 'Active' | 'Inactive';
}

export interface UserRoleMaster {
  id: number;
  employeeId: string;
  username: string;
  fullName: string;
  role: string;
  contactNumber: string;
  email: string;
  status: 'Active' | 'Inactive';
  isBlock: boolean;
}

export interface CategoryMaster {
  id: number;
  name: string;
}

export const roles: RoleMaster[] = [
  {
    id: 1,
    name: 'Admin',
    code: 'ADMIN',
    description: 'Full access to all system modules, configurations, user management, and settings.',
    status: 'Active'
  },
  {
    id: 2,
    name: 'Store Manager',
    code: 'STORE_MANAGER',
    description: 'Manages overall inventory, stock entries, GRN verification, and warehouse operations.',
    status: 'Active'
  },
  {
    id: 3,
    name: 'Store Executive',
    code: 'STORE_EXEC',
    description: 'Handles day-to-day stock receipts, material movements, and inventory logs.',
    status: 'Active'
  },
  {
    id: 4,
    name: 'Purchase Manager',
    code: 'PURCHASE_MANAGER',
    description: 'Oversees procurement operations, vendor relations, and approves purchase orders.',
    status: 'Active'
  },
  {
    id: 5,
    name: 'Purchase Executive',
    code: 'PURCHASE_EXEC',
    description: 'Creates material requisitions, purchase orders, and supplier communication.',
    status: 'Active'
  },
  {
    id: 6,
    name: 'Sales Manager',
    code: 'SALES_MANAGER',
    description: 'Manages sales targets, CRM leads, customer accounts, and sales approvals.',
    status: 'Active'
  },
  {
    id: 7,
    name: 'Sales Executive',
    code: 'SALES_EXEC',
    description: 'Creates client inquiries, quotations, proforma invoices, and customer follow-ups.',
    status: 'Active'
  },
  {
    id: 8,
    name: 'QC Manager',
    code: 'QC_MANAGER',
    description: 'Defines quality standards, approves incoming inspection reports, and manages QC workflows.',
    status: 'Active'
  },
  {
    id: 9,
    name: 'QC Inspector',
    code: 'QC_INSPECTOR',
    description: 'Conducts physical inspections, quality tests, roll testing, and records QC logs.',
    status: 'Active'
  },
  {
    id: 10,
    name: 'Production Manager',
    code: 'PRODUCTION_MANAGER',
    description: 'Schedules manufacturing shifts, machine assignments, and monitors daily production outputs.',
    status: 'Active'
  }
];

export const userRoles: UserRoleMaster[] = [
  {
    id: 1,
    employeeId: 'ADM001',
    username: 'admin',
    fullName: 'System Admin',
    role: 'Admin',
    contactNumber: '9876543201',
    email: 'admin@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 2,
    employeeId: 'STM001',
    username: 'storemanager',
    fullName: 'Suresh Patel',
    role: 'Store Manager',
    contactNumber: '9876543202',
    email: 'store.manager@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 3,
    employeeId: 'STE001',
    username: 'storeexec',
    fullName: 'Ramesh Kumar',
    role: 'Store Executive',
    contactNumber: '9876543203',
    email: 'store.exec@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 4,
    employeeId: 'PURM001',
    username: 'purchasemanager',
    fullName: 'Vikram Shah',
    role: 'Purchase Manager',
    contactNumber: '9876543204',
    email: 'purchase.manager@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 5,
    employeeId: 'PURE001',
    username: 'purchaseexec',
    fullName: 'Amit Sharma',
    role: 'Purchase Executive',
    contactNumber: '9876543205',
    email: 'purchase.exec@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 6,
    employeeId: 'SLSM001',
    username: 'salesmanager',
    fullName: 'Rahul Mehta',
    role: 'Sales Manager',
    contactNumber: '9876543206',
    email: 'sales.manager@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 7,
    employeeId: 'SLSE001',
    username: 'salesexec',
    fullName: 'Priya Verma',
    role: 'Sales Executive',
    contactNumber: '9876543207',
    email: 'sales.exec@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 8,
    employeeId: 'QCM001',
    username: 'qcmanager',
    fullName: 'Hardik Dave',
    role: 'QC Manager',
    contactNumber: '9876543208',
    email: 'qc.manager@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 9,
    employeeId: 'QCI001',
    username: 'qcinspector',
    fullName: 'Harmindar Singh',
    role: 'QC Inspector',
    contactNumber: '9876543209',
    email: 'qc.inspector@patelstrap.com',
    status: 'Active',
    isBlock: false
  },
  {
    id: 10,
    employeeId: 'PRDM001',
    username: 'productionmanager',
    fullName: 'Manish Joshi',
    role: 'Production Manager',
    contactNumber: '9876543210',
    email: 'production.manager@patelstrap.com',
    status: 'Active',
    isBlock: false
  }
];

export const categories: CategoryMaster[] = [
  { id: 1, name: 'TOOLS' },
  { id: 2, name: 'RAW MATERIAL' },
  { id: 3, name: 'HARDWARE' },
  { id: 4, name: 'CONSUMABLE' },
  { id: 5, name: 'DRILLING MACHINE' },
  { id: 6, name: 'WORKSHOP' }
];
