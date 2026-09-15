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

// GET all items (with optional search)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, stockFilter } = req.query;
    
    const products = await prisma.product.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search as string, mode: 'insensitive' } },
              { sku: { contains: search as string, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: {
        category: true,
        supplier: true,
        unit: true
      },
      orderBy: { createdAt: 'desc' }
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
    // Only sku and name are truly required; categoryId and supplierId are optional
    if (!data.sku || !data.name) {
      return res.status(400).json({ error: 'Missing required fields: sku, name' });
    }

    const product = await prisma.product.create({
      data: {
        sku: data.sku,
        name: data.name,
        quantity: 0, // Force quantity to 0 on creation. Stock is managed via Purchase Invoices.
        cost_price: parseFloat(data.cost_price) || 0,
        selling_price: parseFloat(data.selling_price) || 0,
        min_stock: parseInt(data.min_stock) || 0,
        categoryId: data.categoryId || null,
        supplierId: data.supplierId || null,
        unitId: data.unitId || null,
        invoiceDate: null,
        location: data.location || '',
        status: data.status || 'Active',
      },
    });
    res.status(201).json(product);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'SKU must be unique' });
    }
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
        status: data.status,
      },
    });
    res.json(product);
  } catch (error) {
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
