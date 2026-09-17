import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import * as xlsx from 'xlsx';

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

const INITIAL_ITEMS = [
  { sku: 'TAN2141', name: 'PLIER SET', partOf: 'CONSUMABLE', location: 'D-31', company: 'TANSA', assignedTo: 'Administrator', tags: 'TOOLS,CONSUMABLE', disabled: false },
  { sku: 'TAN1989', name: 'BIT DIA. 115 MM DRILLIN', partOf: 'DRILLING MACHINE', location: 'Q-03', company: 'TANSA', assignedTo: 'Administrator', tags: 'TOOLS', disabled: false },
  { sku: 'TAN1550', name: 'HSS DRILL BIT 2- 8MM', partOf: 'CONSUMABLE', location: 'LOCKER-A', company: 'TANSA', assignedTo: 'John Doe', tags: 'TOOLS', disabled: false },
  { sku: 'NLHW592', name: 'BOX SPANNER 50MM X', partOf: 'HARDWARE', location: 'A1-28', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'HARDWARE', disabled: false },
  { sku: 'NLHW573', name: 'CIRCLIP PLIER INTERNA', partOf: 'HARDWARE', location: 'LOCKER-B', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'HARDWARE', disabled: false },
  { sku: 'NLHW571', name: 'STRAIGHT TIP LOCK RING', partOf: 'HARDWARE', location: 'E-11', company: 'NEELKANTH', assignedTo: 'System User', tags: 'HARDWARE', disabled: false },
  { sku: 'NLHW516', name: 'ADJUSTABLE SPANNER', partOf: 'HARDWARE', location: 'D-49', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'HARDWARE', disabled: false },
  { sku: 'NLHW435', name: 'DRILL BIT STEEL 22 MM', partOf: 'HARDWARE', location: 'D-26', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'TOOLS', disabled: false },
  { sku: 'NLHW434', name: 'DRILL BIT STEEL 20 MM', partOf: 'HARDWARE', location: 'D-26', company: 'NEELKANTH', assignedTo: 'John Doe', tags: 'TOOLS', disabled: false },
  { sku: 'NLHW432', name: 'ACCESSORIES FOR MIN', partOf: 'HARDWARE', location: 'I-36', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'HARDWARE', disabled: false },
  { sku: 'NLHW416', name: 'DRILL BIT HSS 13 MM', partOf: 'HARDWARE', location: 'D-32', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'TOOLS', disabled: false },
  { sku: 'NLHW402', name: 'COMBINATION SPANNER 24MM', partOf: 'HARDWARE', location: 'A1-25', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'TOOLS', disabled: false },
  { sku: 'NLHW337', name: 'COMBINATION SPANNER 22MM', partOf: 'HARDWARE', location: 'D-48', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'TOOLS', disabled: false },
  { sku: 'NLHW190', name: 'DRILL BIT MAGNETIC 22MM', partOf: 'HARDWARE', location: 'D-33', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'TOOLS', disabled: false },
  { sku: 'NLHW177', name: 'COMBINATION SPANNER 19MM', partOf: 'HARDWARE', location: 'D-31', company: 'NEELKANTH', assignedTo: 'Administrator', tags: 'TOOLS', disabled: false }
];

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

// POST new item
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.sku || !data.name) {
      return res.status(400).json({ error: 'Missing required fields: sku, name' });
    }

    const product = await prisma.product.create({
      data: {
        sku: data.sku,
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
        incomeAccount: data.incomeAccount || null,
        expenseAccount: data.expenseAccount || null,
        hsnCode: data.hsnCode || null,
        taxRate: data.taxRate !== undefined ? parseFloat(data.taxRate) : 18,
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

    res.status(201).json(product);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'SKU must be unique' });
    }
    console.error('Failed to create product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT update item
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

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
        incomeAccount: data.incomeAccount,
        expenseAccount: data.expenseAccount,
        hsnCode: data.hsnCode,
        taxRate: data.taxRate !== undefined ? parseFloat(data.taxRate) : undefined,
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

    res.json(product);
  } catch (error) {
    console.error('Failed to update product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE item
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.product.delete({
      where: { id },
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
