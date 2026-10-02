import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface LogActivityOptions {
  entityType: string;
  entityId: string | number;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'COMMENT' | string;
  description: string;
  userId?: string | null;
  metadata?: any;
}

export const DEFAULT_FIELD_LABEL_MAP: Record<string, string> = {
  name: 'Item Name',
  sku: 'Item Code (SKU)',
  categoryId: 'Item Group',
  supplierId: 'Supplier',
  unitId: 'Default Unit of Measure',
  location: 'Bin Location',
  cost_price: 'Cost Price',
  selling_price: 'Selling Price',
  min_stock: 'Min Stock',
  company: 'Company',
  partOf: 'Part Of',
  subPartOf: 'Sub Part Of',
  tansadNo: 'TANSAD No.',
  withholdingTaxPurchase: 'Withholding Tax Rate on Purchase',
  withholdingTaxSales: 'Withholding Tax Rate on Sales',
  activityType: 'Activity Type',
  disabled: 'Disabled',
  allowAlternativeItem: 'Allow Alternative Item',
  maintainStock: 'Maintain Stock',
  excisableItem: 'Excisable Item',
  hasVariants: 'Has Variants',
  includeInManufacturing: 'Include Item In Manufacturing',
  isFixedAsset: 'Is Fixed Asset',
  valuationRate: 'Valuation Rate',
  overDeliveryAllowance: 'Over Delivery Allowance',
  overBillingAllowance: 'Over Billing Allowance',
  incomeAccount: 'Income Account',
  expenseAccount: 'Expense Account',
  hsnCode: 'HSN/SAC Code',
  taxRate: 'Tax Rate',
  assignedTo: 'Assigned To',
  tags: 'Tags',
  // Material Request & Purchase Order Fields
  purpose: 'Purpose',
  transactionDate: 'Transaction Date',
  requiredByDate: 'Required By Date',
  department: 'Department',
  requiredFor: 'Required For',
  priceList: 'Price List',
  attendBy: 'Attend By',
  purchaseType: 'Purchase Type',
  paymentTerms: 'Payment Terms',
  supplier: 'Supplier',
  gstin: 'GSTIN',
  tin: 'TIN',
  vrn: 'VRN',
  pfiNo: 'PFI No',
  currency: 'Currency',
  applyTaxWithholding: 'Apply Tax Withholding Amount',
  isSubcontracted: 'Is Subcontracted',
  setWarehouse: 'Target Warehouse',
  status: 'Status',
  approvalStatus: 'Approval Status',
};

// Helper to resolve foreign key values to human-readable names from DB or relation objects
export async function resolveForeignKeyDisplayValue(key: string, rawVal: any, recordObj?: any): Promise<string> {
  if (rawVal === null || rawVal === undefined || rawVal === '') return '';

  // If already an object with name/title properties
  if (typeof rawVal === 'object' && rawVal !== null) {
    return rawVal.name || rawVal.companyName || rawVal.fullName || rawVal.title || rawVal.symbol || rawVal.sku || String(rawVal);
  }

  // Check attached relation on parent object first
  if (recordObj && typeof recordObj === 'object') {
    if ((key === 'unitId' || key === 'unit') && recordObj.unit) {
      return recordObj.unit.name || recordObj.unit.symbol || String(rawVal);
    }
    if ((key === 'categoryId' || key === 'category') && recordObj.category) {
      return recordObj.category.name || String(rawVal);
    }
    if ((key === 'supplierId' || key === 'supplier') && recordObj.supplier) {
      return recordObj.supplier.name || String(rawVal);
    }
    if ((key === 'clientId' || key === 'customerId' || key === 'client') && recordObj.client) {
      return recordObj.client.companyName || recordObj.client.name || String(rawVal);
    }
  }

  const strVal = String(rawVal).trim();
  const numVal = Number(rawVal);

  try {
    if (key === 'unitId' || key === 'unit') {
      if (!isNaN(numVal)) {
        const u = await prisma.unit.findUnique({ where: { id: numVal } });
        if (u && u.name) return u.name;
      }
    } else if (key === 'categoryId' || key === 'category') {
      if (!isNaN(numVal)) {
        const c = await prisma.category.findUnique({ where: { id: numVal } });
        if (c && c.name) return c.name;
      }
    } else if (key === 'supplierId' || key === 'supplier') {
      if (!isNaN(numVal)) {
        const s = await prisma.supplier.findUnique({ where: { id: numVal } });
        if (s && s.name) return s.name;
      }
    } else if (key === 'clientId' || key === 'customerId' || key === 'client') {
      if (!isNaN(numVal)) {
        const cl = await prisma.client.findUnique({ where: { id: numVal } });
        if (cl && cl.companyName) return cl.companyName;
      }
    } else if (key === 'productId' || key === 'product') {
      const p = await prisma.product.findUnique({ where: { id: strVal } });
      if (p) return p.name || p.sku;
    }
  } catch (err) {
    // Return original value if query fails or table not available
  }

  return strVal;
}

export async function createFieldDiffDescriptionAsync(
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  labelMap: Record<string, string> = DEFAULT_FIELD_LABEL_MAP
): Promise<string> {
  if (!oldObj || !newObj) return 'updated record';

  const changes: string[] = [];

  for (const key of Object.keys(labelMap)) {
    if (newObj[key] !== undefined && oldObj[key] !== undefined) {
      let rawOld = oldObj[key];
      let rawNew = newObj[key];

      let oldStr = await resolveForeignKeyDisplayValue(key, rawOld, oldObj);
      let newStr = await resolveForeignKeyDisplayValue(key, rawNew, newObj);

      if (oldStr === null || oldStr === undefined) oldStr = '';
      if (newStr === null || newStr === undefined) newStr = '';

      oldStr = String(oldStr).trim();
      newStr = String(newStr).trim();

      if (oldStr !== newStr && (oldStr !== '' || newStr !== '')) {
        const fieldLabel = labelMap[key] || key;
        changes.push(`${fieldLabel} from ${oldStr || 'empty'} to ${newStr || 'empty'}`);
      }
    }
  }

  // Diffing Items table array (if present)
  if (Array.isArray(oldObj.items) && Array.isArray(newObj.items)) {
    if (oldObj.items.length !== newObj.items.length) {
      changes.push(`Number of Items from ${oldObj.items.length} to ${newObj.items.length}`);
    } else {
      newObj.items.forEach((item: any, idx: number) => {
        const oldItem = oldObj.items[idx];
        if (oldItem) {
          if (item.quantity !== undefined && oldItem.quantity !== undefined && Number(item.quantity) !== Number(oldItem.quantity)) {
            const itemCode = (item.itemCode || item.name || `Line ${idx + 1}`).split(':')[0];
            changes.push(`Quantity for ${itemCode} from ${oldItem.quantity} to ${item.quantity}`);
          }
        }
      });
    }
  }

  if (changes.length > 0) {
    return `changed the value of ${changes.join(', ')}`;
  }

  return 'updated record';
}

export function createFieldDiffDescription(
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  labelMap: Record<string, string> = DEFAULT_FIELD_LABEL_MAP
): string {
  if (!oldObj || !newObj) return 'updated record';

  const changes: string[] = [];

  for (const key of Object.keys(labelMap)) {
    if (newObj[key] !== undefined && oldObj[key] !== undefined) {
      let oldVal = oldObj[key];
      let newVal = newObj[key];

      // Generic Foreign Key / Object resolution synchronously
      if (key === 'unitId' || key === 'unit') {
        oldVal = oldObj.unit?.name || oldObj.unit?.symbol || oldVal;
        newVal = newObj.unit?.name || newObj.unit?.symbol || newVal;
      } else if (key === 'categoryId' || key === 'category') {
        oldVal = oldObj.category?.name || oldVal;
        newVal = newObj.category?.name || newVal;
      } else if (key === 'supplierId' || key === 'supplier') {
        oldVal = oldObj.supplier?.name || oldVal;
        newVal = newObj.supplier?.name || newVal;
      } else if (key === 'customerId' || key === 'customer') {
        oldVal = oldObj.customer?.name || oldVal;
        newVal = newObj.customer?.name || newVal;
      } else if (key === 'warehouseId' || key === 'setWarehouse') {
        oldVal = oldObj.warehouse?.name || oldVal;
        newVal = newObj.warehouse?.name || newVal;
      }

      if (oldVal === null || oldVal === undefined) oldVal = '';
      if (newVal === null || newVal === undefined) newVal = '';

      const oldStr = String(oldVal).trim();
      const newStr = String(newVal).trim();

      if (oldStr !== newStr && oldStr !== '' && newStr !== '') {
        const fieldLabel = labelMap[key] || key;
        changes.push(`${fieldLabel} from ${oldStr} to ${newStr}`);
      }
    }
  }

  // Diffing Items table array (if present)
  if (Array.isArray(oldObj.items) && Array.isArray(newObj.items)) {
    if (oldObj.items.length !== newObj.items.length) {
      changes.push(`Number of Items from ${oldObj.items.length} to ${newObj.items.length}`);
    } else {
      newObj.items.forEach((item: any, idx: number) => {
        const oldItem = oldObj.items[idx];
        if (oldItem) {
          if (item.quantity !== undefined && oldItem.quantity !== undefined && Number(item.quantity) !== Number(oldItem.quantity)) {
            const itemCode = (item.itemCode || item.name || `Line ${idx + 1}`).split(':')[0];
            changes.push(`Quantity for ${itemCode} from ${oldItem.quantity} to ${item.quantity}`);
          }
        }
      });
    }
  }

  if (changes.length > 0) {
    return `changed the value of ${changes.join(', ')}`;
  }

  return 'updated record';
}

export async function logActivity({
  entityType,
  entityId,
  action,
  description,
  userId,
  metadata
}: LogActivityOptions) {
  try {
    let finalUserId = userId && userId !== 'dev-user' ? userId : null;
    if (!finalUserId) {
      const defaultUser = await prisma.user.findFirst();
      if (defaultUser) {
        finalUserId = defaultUser.id;
      }
    }

    return await prisma.activityLog.create({
      data: {
        entityType: String(entityType),
        entityId: String(entityId),
        action,
        description: description.trim(),
        userId: finalUserId,
        metadata: metadata || null
      }
    });
  } catch (err) {
    console.error('Failed to log activity in DB:', err);
  }
}
