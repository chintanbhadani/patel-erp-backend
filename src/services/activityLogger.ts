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
};

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

      if (key === 'unitId') {
        oldVal = oldObj.unit?.name || oldObj.unit?.symbol || oldVal;
        newVal = newObj.unit?.name || newObj.unit?.symbol || newVal;
      } else if (key === 'categoryId') {
        oldVal = oldObj.category?.name || oldVal;
        newVal = newObj.category?.name || newVal;
      } else if (key === 'supplierId') {
        oldVal = oldObj.supplier?.name || oldVal;
        newVal = newObj.supplier?.name || newVal;
      }

      if (oldVal === null || oldVal === undefined) oldVal = 'null';
      if (newVal === null || newVal === undefined) newVal = 'null';

      const oldStr = String(oldVal).trim();
      const newStr = String(newVal).trim();

      if (oldStr !== newStr) {
        const fieldLabel = labelMap[key] || key;
        const formattedOld = oldStr === '' ? '""' : oldStr;
        const formattedNew = newStr === '' ? '""' : newStr;
        changes.push(`${fieldLabel} from ${formattedOld} to ${formattedNew}`);
      }
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
