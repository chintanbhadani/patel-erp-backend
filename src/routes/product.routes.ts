import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { logActivity, createFieldDiffDescription } from '../services/activityLogger';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();
const prisma = new PrismaClient();

// Helper to calculate WAC and FIFO for a product
async function calculateValuationsForProduct(product: any, ledgers: any[]) {
  const productLedgers = ledgers.filter(l => l.productId === product.id);
  
  let wacQty = 0;
  let wacPrice = 0;
  
  let fifoQueue: {qty: number, price: number}[] = [];

  for (const l of productLedgers) {
    if (l.type === 'PURCHASE' && l.invoice) {
      const item = l.invoice.items.find((i: any) => i.productId === product.id);
      if (item) {
        const qty = Number(item.quantity);
        const price = Number(item.unitPrice);
        
        // WAC
        const newTotalValue = (wacQty * wacPrice) + (qty * price);
        wacQty += qty;
        wacPrice = wacQty > 0 ? newTotalValue / wacQty : 0;
        
        // FIFO
        fifoQueue.push({ qty, price });
      }
    } else if (l.type === 'SALES' || l.quantityChange < 0) {
      const qtyToDeduct = Math.abs(l.quantityChange);
      
      // WAC
      wacQty = Math.max(0, wacQty - qtyToDeduct);
      
      // FIFO
      let remainingToDeduct = qtyToDeduct;
      while (remainingToDeduct > 0 && fifoQueue.length > 0) {
        if (fifoQueue[0].qty <= remainingToDeduct) {
          remainingToDeduct -= fifoQueue[0].qty;
          fifoQueue.shift();
        } else {
          fifoQueue[0].qty -= remainingToDeduct;
          remainingToDeduct = 0;
        }
      }
    }
  }
  
  const fifoValue = fifoQueue.reduce((sum, batch) => sum + (batch.qty * batch.price), 0);
  const fifoPrice = fifoQueue.length > 0 ? fifoQueue[0].price : 0;
  
  return {
    ...product,
    wacPrice,
    wacValue: wacQty * wacPrice,
    fifoPrice,
    fifoValue
  };
}

const INITIAL_ITEMS: any[] = [];

async function ensureSeedProducts() {
  try {
    let toolsCategory = await prisma.category.findFirst({ where: { name: 'TOOLS' } });
    if (!toolsCategory) {
      toolsCategory = await prisma.category.create({ data: { name: 'TOOLS' } });
    }
    for (const item of INITIAL_ITEMS) {
      const existing = await prisma.product.findUnique({ where: { sku: item.sku } });
      if (!existing) {
        await prisma.product.create({
          data: {
            sku: item.sku,
            name: item.name,
            quantity: 10,
            cost_price: 100,
            selling_price: 150,
            min_stock: 2,
            partOf: item.partOf,
            location: item.location,
            company: item.company,
            assignedTo: item.assignedTo,
            tags: item.tags,
            disabled: item.disabled,
            categoryId: toolsCategory.id
          }
        });
      }
    }
  } catch (err) {
    console.error('Error seeding initial products in backend:', err);
  }
}

// GET all items (with database query filtering and sorting)
router.get('/', async (req: Request, res: Response) => {
  try {
    await ensureSeedProducts();

    const {
      search,
      stockFilter,
      id,
      sku,
      name,
      itemName,
      group,
      category,
      partOf,
      company,
      location,
      binLocation,
      status,
      assignedTo,
      tag,
      rules,
      sortBy,
      sortOrder
    } = req.query;

    const AND: any[] = [];

    if (search) {
      const q = String(search).trim();
      AND.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { partOf: { contains: q, mode: 'insensitive' } },
          { company: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
          { assignedTo: { contains: q, mode: 'insensitive' } },
          { tags: { contains: q, mode: 'insensitive' } },
          { category: { name: { contains: q, mode: 'insensitive' } } },
        ]
      });
    }

    const skuQuery = String(id || sku || '').trim();
    if (skuQuery) {
      AND.push({ sku: { contains: skuQuery, mode: 'insensitive' } });
    }

    const nameQuery = String(name || itemName || '').trim();
    if (nameQuery) {
      AND.push({ name: { contains: nameQuery, mode: 'insensitive' } });
    }

    const groupQuery = String(group || category || '').trim();
    if (groupQuery) {
      AND.push({ category: { name: { contains: groupQuery, mode: 'insensitive' } } });
    }

    const partOfQuery = String(partOf || '').trim();
    if (partOfQuery) {
      AND.push({ partOf: { contains: partOfQuery, mode: 'insensitive' } });
    }

    const companyQuery = String(company || '').trim();
    if (companyQuery) {
      AND.push({ company: { contains: companyQuery, mode: 'insensitive' } });
    }

    const locationQuery = String(location || binLocation || '').trim();
    if (locationQuery) {
      AND.push({ location: { contains: locationQuery, mode: 'insensitive' } });
    }

    const statusQuery = String(status || '').trim();
    if (statusQuery) {
      if (statusQuery.toLowerCase() === 'enabled') {
        AND.push({ disabled: false });
      } else if (statusQuery.toLowerCase() === 'disabled') {
        AND.push({ disabled: true });
      } else {
        AND.push({ status: statusQuery as any });
      }
    }

    const assignedToQuery = String(assignedTo || '').trim();
    if (assignedToQuery) {
      AND.push({ assignedTo: { contains: assignedToQuery, mode: 'insensitive' } });
    }

    const tagQuery = String(tag || '').trim();
    if (tagQuery) {
      AND.push({ tags: { contains: tagQuery, mode: 'insensitive' } });
    }

    if (rules) {
      let parsedRules: any[] = [];
      try {
        parsedRules = typeof rules === 'string' ? JSON.parse(rules) : rules;
      } catch (e) {}

      if (Array.isArray(parsedRules)) {
        for (const rule of parsedRules) {
          if (!rule || !rule.value || !String(rule.value).trim()) continue;
          const val = String(rule.value).trim();
          const op = rule.operator || 'Like';
          const field = rule.field;

          let targetKey = '';
          if (field === 'ID' || field === 'Item Code') targetKey = 'sku';
          else if (field === 'Item Name') targetKey = 'name';
          else if (field === 'Item Group') targetKey = 'category';
          else if (field === 'Part Of') targetKey = 'partOf';
          else if (field === 'Bin Location') targetKey = 'location';
          else if (field === 'Company') targetKey = 'company';
          else if (field === 'Status') targetKey = 'disabled';

          if (targetKey === 'category') {
            if (op === 'Equals') {
              AND.push({ category: { name: { equals: val, mode: 'insensitive' } } });
            } else if (op === 'Not Equals') {
              AND.push({ NOT: { category: { name: { equals: val, mode: 'insensitive' } } } });
            } else {
              AND.push({ category: { name: { contains: val, mode: 'insensitive' } } });
            }
          } else if (targetKey === 'disabled') {
            const isDisabled = val.toLowerCase() === 'disabled';
            if (op === 'Equals') {
              AND.push({ disabled: isDisabled });
            } else if (op === 'Not Equals') {
              AND.push({ disabled: !isDisabled });
            }
          } else if (targetKey) {
            if (op === 'Equals') {
              AND.push({ [targetKey]: { equals: val, mode: 'insensitive' } });
            } else if (op === 'Not Equals') {
              AND.push({ NOT: { [targetKey]: { equals: val, mode: 'insensitive' } } });
            } else {
              AND.push({ [targetKey]: { contains: val, mode: 'insensitive' } });
            }
          }
        }
      }
    }

    let orderBy: any = { createdAt: 'desc' };
    if (sortBy) {
      const fieldStr = String(sortBy).trim();
      const order = (String(sortOrder).toLowerCase() === 'asc') ? 'asc' : 'desc';

      if (fieldStr === 'Item Name' || fieldStr === 'name') {
        orderBy = { name: order };
      } else if (fieldStr === 'ID' || fieldStr === 'Item Code' || fieldStr === 'sku') {
        orderBy = { sku: order };
      } else if (fieldStr === 'Item Group' || fieldStr === 'category') {
        orderBy = { category: { name: order } };
      } else if (fieldStr === 'Part Of' || fieldStr === 'partOf') {
        orderBy = { partOf: order };
      } else if (fieldStr === 'Bin Location' || fieldStr === 'location') {
        orderBy = { location: order };
      } else if (fieldStr === 'Company' || fieldStr === 'company') {
        orderBy = { company: order };
      } else if (fieldStr === 'Last Updated On' || fieldStr === 'updatedAt') {
        orderBy = { updatedAt: order };
      }
    }

    const whereClause = AND.length > 0 ? { AND } : undefined;

    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        category: true,
        supplier: true,
        unit: true
      },
      orderBy
    });

    // Fetch all relevant ledgers once to avoid N+1 queries
    const ledgers = await prisma.stockLedger.findMany({
      orderBy: { date: 'asc' },
      include: {
        invoice: {
          include: { items: true }
        }
      }
    });

    let productsWithValuation = await Promise.all(
      products.map(p => calculateValuationsForProduct(p, ledgers))
    );
    
    if (stockFilter === 'low_stock') {
      productsWithValuation = productsWithValuation.filter(p => p.quantity <= p.min_stock);
    } else if (stockFilter === 'healthy') {
      productsWithValuation = productsWithValuation.filter(p => p.quantity > p.min_stock);
    }
    
    res.json(productsWithValuation);
  } catch (error) {
    console.error('Failed to fetch inventory:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Sample Bin Report dataset matching ERPNext Bin Report format
const SAMPLE_BIN_REPORT: Array<{
  id: string;
  itemCode: string;
  itemName: string;
  itemGroup: string;
  partOf: string;
  subPartOf: string;
  uom: string;
  actualQuantity: number;
  warehouse: string;
  assignedTo?: string;
  tags?: string;
}> = [];

// GET Bin Report (Stock Balance per item per warehouse)
router.get('/bin-report', async (req: Request, res: Response) => {
  try {
    const { search, warehouse, itemGroup, partOf } = req.query;

    const dbProducts = await prisma.product.findMany({
      include: {
        category: true,
        unit: true
      }
    });

    const dbBinItems = dbProducts.map(p => ({
      id: p.id,
      itemCode: p.sku,
      itemName: p.name,
      itemGroup: p.category?.name || 'GENERAL',
      partOf: p.partOf || 'GENERAL',
      subPartOf: p.subPartOf || 'GENERAL',
      uom: p.unit?.name || 'Pcs',
      actualQuantity: Number(p.quantity || 0),
      warehouse: p.location || 'Main Store - NCL',
      assignedTo: p.assignedTo || 'Administrator',
      tags: p.tags || ''
    }));

    // Merge database items with sample items (avoiding duplicate SKUs)
    const existingSkus = new Set(dbBinItems.map(b => `${b.itemCode}_${b.warehouse}`));
    const extraSamples = SAMPLE_BIN_REPORT.filter(s => !existingSkus.has(`${s.itemCode}_${s.warehouse}`));
    let list = [...dbBinItems, ...extraSamples];

    // Apply filtering
    if (search) {
      const q = String(search).toLowerCase().trim();
      list = list.filter(item =>
        item.itemCode.toLowerCase().includes(q) ||
        item.itemName.toLowerCase().includes(q) ||
        item.itemGroup.toLowerCase().includes(q) ||
        item.partOf.toLowerCase().includes(q) ||
        item.subPartOf.toLowerCase().includes(q) ||
        item.warehouse.toLowerCase().includes(q)
      );
    }

    if (warehouse) {
      const w = String(warehouse).toLowerCase().trim();
      list = list.filter(item => item.warehouse.toLowerCase().includes(w));
    }

    if (itemGroup) {
      const g = String(itemGroup).toLowerCase().trim();
      list = list.filter(item => item.itemGroup.toLowerCase().includes(g));
    }

    if (partOf) {
      const p = String(partOf).toLowerCase().trim();
      list = list.filter(item => item.partOf.toLowerCase().includes(p));
    }

    res.json(list);
  } catch (error) {
    console.error('Failed to fetch Bin Report:', error);
    res.status(500).json({ error: 'Failed to fetch Bin Report' });
  }
});

// GET single item by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        supplier: true,
        unit: true
      },
    });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const ledgers = await prisma.stockLedger.findMany({
      where: { productId: id },
      orderBy: { date: 'asc' },
      include: {
        invoice: {
          include: { items: true }
        }
      }
    });

    const productWithValuation = await calculateValuationsForProduct(product, ledgers);
    res.json(productWithValuation);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

async function generateNextItemCodeBackend(companyName?: string, categoryId?: number | null, requestedSku?: string): Promise<string> {
  let compPrefix = 'PS';
  const compUpper = (companyName || '').toUpperCase();
  if (compUpper.includes('TANSA')) compPrefix = 'TAN';
  else if (compUpper.includes('NEELKANTH')) compPrefix = 'NG';

  let groupCode = 'TL';
  if (categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: Number(categoryId) } });
    if (cat && cat.name) {
      const g = cat.name.toUpperCase();
      if (g.includes('TOOL')) groupCode = 'TL';
      else if (g.includes('HARDWARE')) groupCode = 'HW';
      else if (g.includes('CONSUMABLE')) groupCode = 'CM';
      else if (g.includes('ELECTRICAL')) groupCode = 'EL';
      else if (g.includes('STEEL')) groupCode = 'ST';
      else if (g.includes('RAW')) groupCode = 'RM';
      else if (g.includes('MACHINE') || g.includes('SPARE')) groupCode = 'HL';
      else if (g.length >= 2) groupCode = g.substring(0, 2);
    }
  }

  const prefix = `${compPrefix}${groupCode}`;

  if (requestedSku && requestedSku.trim()) {
    const existing = await prisma.product.findUnique({ where: { sku: requestedSku.trim() } });
    if (!existing) {
      return requestedSku.trim();
    }
  }

  const allProducts = await prisma.product.findMany({
    select: { sku: true }
  });

  let maxSeq = 0;
  allProducts.forEach(p => {
    const s = p.sku.toUpperCase();
    if (s.startsWith(prefix)) {
      const numPart = s.substring(prefix.length);
      const num = parseInt(numPart, 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  });

  let candidateSeq = maxSeq + 1;
  let candidateSku = `${prefix}${String(candidateSeq).padStart(candidateSeq >= 1000 ? 4 : 3, '0')}`;

  while (await prisma.product.findUnique({ where: { sku: candidateSku } })) {
    candidateSeq++;
    candidateSku = `${prefix}${String(candidateSeq).padStart(candidateSeq >= 1000 ? 4 : 3, '0')}`;
  }

  return candidateSku;
}

// POST new item
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.name) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }

    const finalSku = await generateNextItemCodeBackend(data.company, data.categoryId, data.sku);

    const product = await prisma.product.create({
      data: {
        sku: finalSku,
        name: data.name,
        quantity: 0,
        cost_price: parseFloat(data.cost_price) || 0,
        selling_price: parseFloat(data.selling_price) || 0,
        min_stock: parseInt(data.min_stock) || 0,
        categoryId: data.categoryId || null,
        supplierId: data.supplierId || null,
        unitId: data.unitId || null,
        location: data.location || '',
        status: data.disabled ? 'Inactive' : (data.status || 'Active'),

        company: data.company || null,
        partOf: data.partOf || null,
        subPartOf: data.subPartOf || null,
        tansadNo: data.tansadNo || null,
        withholdingTaxPurchase: data.withholdingTaxPurchase !== undefined ? parseFloat(data.withholdingTaxPurchase) : 0,
        withholdingTaxSales: data.withholdingTaxSales !== undefined ? parseFloat(data.withholdingTaxSales) : 0,
        activityType: data.activityType || null,
        disabled: Boolean(data.disabled),
        allowAlternativeItem: Boolean(data.allowAlternativeItem),
        maintainStock: data.maintainStock !== undefined ? Boolean(data.maintainStock) : true,
        excisableItem: Boolean(data.excisableItem),
        hasVariants: Boolean(data.hasVariants),
        includeInManufacturing: data.includeInManufacturing !== undefined ? Boolean(data.includeInManufacturing) : true,
        isFixedAsset: Boolean(data.isFixedAsset),
        valuationRate: data.valuationRate !== undefined ? parseFloat(data.valuationRate) : 0,
        overDeliveryAllowance: data.overDeliveryAllowance !== undefined ? parseFloat(data.overDeliveryAllowance) : 0,
        overBillingAllowance: data.overBillingAllowance !== undefined ? parseFloat(data.overBillingAllowance) : 0,
        assignedTo: data.assignedTo || null,
        tags: data.tags || null,
        imageUrl: data.imageUrl || null,
        attachments: data.attachments || null,
        incomeAccount: data.incomeAccount || null,
        expenseAccount: data.expenseAccount || null,
        hsnCode: data.hsnCode || null,
        taxRate: data.taxRate !== undefined ? parseFloat(data.taxRate) : 18,
        rollLength: data.rollLength !== undefined ? parseFloat(data.rollLength) : 0,
        rollWidth: data.rollWidth !== undefined ? parseFloat(data.rollWidth) : 0,
        rollCoreLength: data.rollCoreLength !== undefined ? parseFloat(data.rollCoreLength) : 0,
        rollCoreDiameter: data.rollCoreDiameter !== undefined ? parseFloat(data.rollCoreDiameter) : 0,
        rollSurface: data.rollSurface || 'Roll Emboss',
        rollWeight: data.rollWeight !== undefined ? parseFloat(data.rollWeight) : 0,
        rollJoint: data.rollJoint || 'No Joint',
      },
      include: {
        category: true,
        supplier: true,
        unit: true
      }
    });

    // Automatically sync into SkuMaster table if not exists
    try {
      await prisma.skuMaster.upsert({
        where: { sku: product.sku },
        update: { name: product.name, categoryId: product.categoryId },
        create: { sku: product.sku, name: product.name, categoryId: product.categoryId }
      });
    } catch (e) {
      console.error('Failed to sync SkuMaster on product create:', e);
    }

    // Log Activity in DB
    await logActivity({
      entityType: 'Item',
      entityId: product.id,
      action: 'CREATE',
      description: `Created new item ${product.name}`,
      userId: (req as any).user?.id || (data as any).userId,
      metadata: { sku: product.sku, name: product.name }
    });

    res.status(201).json({ message: 'Item created successfully', ...product });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'SKU must be unique', message: 'SKU must be unique' });
    }
    console.error('Failed to create product:', error);
    res.status(500).json({ error: 'Failed to create product', message: 'Failed to create product' });
  }
});

// PUT update item
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const oldProduct = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        supplier: true,
        unit: true
      }
    });

    const product = await prisma.product.update({
      where: { id },
      data: {
        sku: data.sku,
        name: data.name,
        quantity: data.quantity !== undefined ? parseInt(data.quantity) : undefined,
        cost_price: data.cost_price !== undefined ? parseFloat(data.cost_price) : undefined,
        selling_price: data.selling_price !== undefined ? parseFloat(data.selling_price) : undefined,
        min_stock: data.min_stock !== undefined ? parseInt(data.min_stock) : undefined,
        categoryId: data.categoryId,
        supplierId: data.supplierId,
        unitId: data.unitId || null,
        invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : undefined,
        location: data.location,
        status: data.disabled !== undefined ? (data.disabled ? 'Inactive' : 'Active') : data.status,

        company: data.company,
        partOf: data.partOf,
        subPartOf: data.subPartOf,
        tansadNo: data.tansadNo,
        withholdingTaxPurchase: data.withholdingTaxPurchase !== undefined ? parseFloat(data.withholdingTaxPurchase) : undefined,
        withholdingTaxSales: data.withholdingTaxSales !== undefined ? parseFloat(data.withholdingTaxSales) : undefined,
        activityType: data.activityType,
        disabled: data.disabled !== undefined ? Boolean(data.disabled) : undefined,
        allowAlternativeItem: data.allowAlternativeItem !== undefined ? Boolean(data.allowAlternativeItem) : undefined,
        maintainStock: data.maintainStock !== undefined ? Boolean(data.maintainStock) : undefined,
        excisableItem: data.excisableItem !== undefined ? Boolean(data.excisableItem) : undefined,
        hasVariants: data.hasVariants !== undefined ? Boolean(data.hasVariants) : undefined,
        includeInManufacturing: data.includeInManufacturing !== undefined ? Boolean(data.includeInManufacturing) : undefined,
        isFixedAsset: data.isFixedAsset !== undefined ? Boolean(data.isFixedAsset) : undefined,
        valuationRate: data.valuationRate !== undefined ? parseFloat(data.valuationRate) : undefined,
        overDeliveryAllowance: data.overDeliveryAllowance !== undefined ? parseFloat(data.overDeliveryAllowance) : undefined,
        overBillingAllowance: data.overBillingAllowance !== undefined ? parseFloat(data.overBillingAllowance) : undefined,
        assignedTo: data.assignedTo,
        tags: data.tags,
        imageUrl: data.imageUrl,
        attachments: data.attachments !== undefined ? data.attachments : undefined,
        incomeAccount: data.incomeAccount,
        expenseAccount: data.expenseAccount,
        hsnCode: data.hsnCode,
        taxRate: data.taxRate !== undefined ? parseFloat(data.taxRate) : undefined,
        rollLength: data.rollLength !== undefined ? parseFloat(data.rollLength) : undefined,
        rollWidth: data.rollWidth !== undefined ? parseFloat(data.rollWidth) : undefined,
        rollCoreLength: data.rollCoreLength !== undefined ? parseFloat(data.rollCoreLength) : undefined,
        rollCoreDiameter: data.rollCoreDiameter !== undefined ? parseFloat(data.rollCoreDiameter) : undefined,
        rollSurface: data.rollSurface,
        rollWeight: data.rollWeight !== undefined ? parseFloat(data.rollWeight) : undefined,
        rollJoint: data.rollJoint,
      },
      include: {
        category: true,
        supplier: true,
        unit: true
      }
    });

    // Also sync SkuMaster if SKU or name changed
    try {
      await prisma.skuMaster.upsert({
        where: { sku: product.sku },
        update: { name: product.name, categoryId: product.categoryId },
        create: { sku: product.sku, name: product.name, categoryId: product.categoryId }
      });
    } catch (e) {
      console.error('Failed to sync SkuMaster on product update:', e);
    }

    const diffDescription = oldProduct
      ? createFieldDiffDescription(oldProduct, product)
      : `updated item ${product.name}`;

    // Log Activity in DB
    await logActivity({
      entityType: 'Item',
      entityId: product.id,
      action: 'UPDATE',
      description: diffDescription,
      userId: (req as any).user?.id || (data as any).userId,
      metadata: { sku: product.sku, name: product.name }
    });

    res.status(200).json({ message: 'Item updated successfully', ...product });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'SKU must be unique', message: 'SKU must be unique' });
    }
    console.error('Failed to update product:', error);
    res.status(500).json({ error: 'Failed to update product', message: 'Failed to update product' });
  }
});

// DELETE item
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.product.delete({
      where: { id },
    });

    // Log Activity in DB
    await logActivity({
      entityType: 'Item',
      entityId: id,
      action: 'DELETE',
      description: `Deleted item`,
      userId: (req as any).user?.id
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// POST bulk upload
router.post('/bulk-upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    console.log(" call bulk-upload :: ");
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any>(sheet);

    let successCount = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Validation
        if (!row.sku || !row.name || row.quantity === undefined || !row.cost_price || !row.selling_price || !row.categoryName || !row.supplierName) {
          errors.push(`Row ${i + 2}: Missing required fields`);
          continue;
        }

        // Find or create Category
        let category = await prisma.category.findFirst({ where: { name: row.categoryName } });
        if (!category) {
          category = await prisma.category.create({ data: { name: row.categoryName } });
        }

        // Find or create Supplier
        let supplier = await prisma.supplier.findFirst({ where: { name: row.supplierName } });
        if (!supplier) {
          supplier = await prisma.supplier.create({ data: { name: row.supplierName } });
        }

        // Find or create Unit
        let unit = null;
        if (row.unitName) {
          unit = await prisma.unit.findFirst({ where: { name: row.unitName } });
          if (!unit) {
            unit = await prisma.unit.create({ data: { name: row.unitName } });
          }
        }

        // Upsert Product
        await prisma.product.upsert({
          where: { sku: row.sku.toString() },
          update: {
            name: row.name,
            quantity: parseInt(row.quantity),
            cost_price: parseFloat(row.cost_price),
            selling_price: parseFloat(row.selling_price),
            min_stock: parseInt(row.min_stock) || 0,
            categoryId: category.id,
            supplierId: supplier.id,
            unitId: unit?.id || null,
            location: row.location || '',
            status: row.status || 'Active',
          },
          create: {
            sku: row.sku.toString(),
            name: row.name,
            quantity: parseInt(row.quantity),
            cost_price: parseFloat(row.cost_price),
            selling_price: parseFloat(row.selling_price),
            min_stock: parseInt(row.min_stock) || 0,
            categoryId: category.id,
            supplierId: supplier.id,
            unitId: unit?.id || null,
            location: row.location || '',
            status: row.status || 'Active',
          },
        });
        successCount++;
      } catch (err: any) {
        errors.push(`Row ${i + 2}: ${err.message}`);
      }
    }

    res.json({ message: `Successfully processed ${successCount} rows.`, errors });
  } catch (error) {
    console.error('Bulk upload error', { error });
    res.status(500).json({ error: 'Failed to process bulk upload' });
  }
});

export default router;
