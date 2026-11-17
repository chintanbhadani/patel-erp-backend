import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import * as xlsx from 'xlsx';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();
const prisma = new PrismaClient();

// GET all stock entries / ledger records
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, type, productId } = req.query;

    const whereConditions: any[] = [];

    if (type && type !== 'ALL') {
      whereConditions.push({ type: type as string });
    }

    if (productId) {
      whereConditions.push({ productId: productId as string });
    }

    if (search) {
      const q = (search as string).trim();
      whereConditions.push({
        OR: [
          { type: { contains: q, mode: 'insensitive' } },
          { product: { name: { contains: q, mode: 'insensitive' } } },
          { product: { sku: { contains: q, mode: 'insensitive' } } },
          { grn: { grnNumber: { contains: q, mode: 'insensitive' } } },
          { invoice: { invoiceNumber: { contains: q, mode: 'insensitive' } } },
          { invoice: { client: { companyName: { contains: q, mode: 'insensitive' } } } },
          { invoice: { supplier: { name: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }

    const stockEntries = await prisma.stockLedger.findMany({
      where: whereConditions.length > 0 ? { AND: whereConditions } : {},
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        product: true,
        grn: {
          include: {
            supplier: true
          }
        },
        invoice: {
          include: {
            client: true,
            supplier: true,
          },
        },
      },
    });

    res.json(stockEntries);
  } catch (error) {
    console.error('Failed to fetch stock entries:', error);
    res.status(500).json({ error: 'Failed to fetch stock entries' });
  }
});

// GET stock entry by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const entry = await prisma.stockLedger.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            category: true,
            unit: true,
          },
        },
        grn: {
          include: {
            supplier: true,
          },
        },
        invoice: {
          include: {
            client: true,
            supplier: true,
          },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({ error: 'Stock entry not found' });
    }

    res.json(entry);
  } catch (error) {
    console.error('Failed to fetch stock entry by id:', error);
    res.status(500).json({ error: 'Failed to fetch stock entry' });
  }
});

// Process bulk stock entry rows
export async function processBulkStockEntries(rows: any[]) {
  let successCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    try {
      // Extract possible column variations
      const sku = String(
        row['Item Code'] ||
        row['SKU'] ||
        row['Item SKU'] ||
        row['Item Code / SKU'] ||
        row['sku'] ||
        row['itemCode'] ||
        row['code'] ||
        ''
      ).trim();

      const name = String(
        row['Item Name'] ||
        row['Name'] ||
        row['Product Name'] ||
        row['name'] ||
        row['itemName'] ||
        ''
      ).trim();

      const rawQty = row['Quantity'] ?? row['Qty'] ?? row['quantity'] ?? row['quantityChange'] ?? row['qty'];
      if (rawQty === undefined || rawQty === null || String(rawQty).trim() === '') {
        errors.push(`Row ${rowNum}: Quantity is required.`);
        continue;
      }

      const qtyNum = Math.round(Number(rawQty));
      if (isNaN(qtyNum)) {
        errors.push(`Row ${rowNum}: Invalid quantity "${rawQty}". Must be a valid number.`);
        continue;
      }

      if (!sku && !name) {
        errors.push(`Row ${rowNum}: Item Code / SKU or Item Name is required.`);
        continue;
      }

      const rawType = String(
        row['Entry Type'] ||
        row['Type'] ||
        row['type'] ||
        row['entryType'] ||
        row['Transaction Type'] ||
        'STOCK_RECEIPT'
      ).trim().toUpperCase();

      let entryType = 'STOCK_RECEIPT';
      if (rawType.includes('OPENING')) entryType = 'OPENING_STOCK';
      else if (rawType.includes('ISSUE')) entryType = 'MATERIAL_ISSUE';
      else if (rawType.includes('ADJUST')) entryType = 'ADJUSTMENT';
      else if (rawType.includes('RECEIPT')) entryType = 'STOCK_RECEIPT';
      else if (rawType) entryType = rawType;

      const rawDate = row['Date'] || row['Entry Date'] || row['date'] || row['entryDate'];
      const entryDate = rawDate ? new Date(rawDate) : new Date();

      const warehouse = String(
        row['Warehouse'] ||
        row['Location'] ||
        row['warehouse'] ||
        row['location'] ||
        ''
      ).trim();

      const rawRate = row['Rate'] ?? row['Unit Rate'] ?? row['Unit Price'] ?? row['rate'] ?? row['cost_price'] ?? row['unitPrice'] ?? row['valuationRate'];
      const rateNum = rawRate !== undefined && rawRate !== null && String(rawRate).trim() !== '' ? Number(rawRate) : null;

      // Determine sign of quantity change
      const isNegative = entryType === 'MATERIAL_ISSUE' || qtyNum < 0;
      const qtyChange = isNegative ? -Math.abs(qtyNum) : Math.abs(qtyNum);

      await prisma.$transaction(async (tx) => {
        // Find product by SKU or Name
        let product = null;
        if (sku) {
          product = await tx.product.findFirst({
            where: { sku: { equals: sku, mode: 'insensitive' } }
          });
        }
        if (!product && name) {
          product = await tx.product.findFirst({
            where: { name: { equals: name, mode: 'insensitive' } }
          });
        }

        // If product doesn't exist, create it as a new product
        if (!product) {
          const defaultCategory = await tx.category.findFirst();
          const defaultUnit = await tx.unit.findFirst();
          const generatedSku = sku || `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const productName = name || generatedSku;

          product = await tx.product.create({
            data: {
              sku: generatedSku,
              name: productName,
              quantity: 0,
              cost_price: rateNum || 0,
              selling_price: rateNum || 0,
              valuationRate: rateNum || 0,
              location: warehouse || 'Main Store - PSL',
              categoryId: defaultCategory?.id || null,
              unitId: defaultUnit?.id || null,
              status: 'Active'
            }
          });
          createdCount++;
        } else {
          updatedCount++;
        }

        // Calculate running balance for this product
        const currentBalanceResult: any = await tx.$queryRaw`
          SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
          FROM "StockLedger"
          WHERE "productId" = ${product.id}
            AND date <= ${entryDate}::TIMESTAMP
        `;
        const balanceBefore = currentBalanceResult[0]?.balance_before
          ? Number(currentBalanceResult[0].balance_before)
          : 0;
        const newRunningBalance = balanceBefore + qtyChange;

        // Prevent negative stock balance
        if (newRunningBalance < 0) {
          throw new Error(`Stock entry causes negative stock balance (${newRunningBalance}) for item ${product.name}`);
        }

        // Create StockLedger entry
        await tx.stockLedger.create({
          data: {
            productId: product.id,
            date: entryDate,
            type: entryType,
            quantityChange: qtyChange,
            runningBalance: newRunningBalance,
          }
        });

        // Update Product quantity, location, and optional valuation rate
        await tx.product.update({
          where: { id: product.id },
          data: {
            quantity: { increment: qtyChange },
            ...(warehouse ? { location: warehouse } : {}),
            ...(rateNum !== null && !isNaN(rateNum) ? { valuationRate: rateNum, cost_price: rateNum } : {})
          }
        });
      });

      successCount++;
    } catch (err: any) {
      errors.push(`Row ${rowNum}: ${err.message || 'Failed to process row'}`);
    }
  }

  return { successCount, createdCount, updatedCount, errors };
}

// POST bulk import stock entries (JSON array)
router.post('/bulk-import', async (req: Request, res: Response) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const result = await processBulkStockEntries(items);
    res.json({
      message: `Successfully processed ${result.successCount} stock entries (${result.createdCount} new items created, ${result.updatedCount} existing items updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk import stock entries error:', error);
    res.status(500).json({ error: error.message || 'Failed to process bulk import' });
  }
});

// POST bulk upload stock entries (multipart Excel/CSV file)
router.post('/bulk-upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any>(sheet);

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'Uploaded sheet has no rows' });
    }

    const result = await processBulkStockEntries(rows);
    res.json({
      message: `Successfully processed ${result.successCount} stock entries from file.`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk upload stock entries error:', error);
    res.status(500).json({ error: error.message || 'Failed to process file upload' });
  }
});

// POST create manual stock entry / adjustment / issue / receipt
router.post('/', async (req: Request, res: Response) => {
  try {
    // Check if multi-item voucher payload is provided
    if (req.body.items && Array.isArray(req.body.items) && req.body.items.length > 0) {
      const {
        type = 'STOCK_RECEIPT',
        date,
        postingDate,
        postingTime,
        location,
        defaultWarehouse,
        purpose,
        remarks,
        items
      } = req.body;

      const rawEntryDate = date || postingDate;
      let entryDate = rawEntryDate ? new Date(rawEntryDate) : new Date();
      if (postingTime && typeof postingTime === 'string' && postingTime.includes(':')) {
        const [hours, minutes] = postingTime.split(':');
        entryDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      }

      const defaultLoc = location || defaultWarehouse || 'Main Store - PSL';

      const results = await prisma.$transaction(async (tx) => {
        const createdEntries: any[] = [];

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const itemLocation = it.location || it.targetWarehouse || defaultLoc;
          const rawQty = it.quantity ?? it.quantityChange ?? it.acceptedQuantity;
          if (rawQty === undefined || rawQty === null || isNaN(Number(rawQty))) {
            continue;
          }

          const qtyNum = Math.abs(Math.round(Number(rawQty)));
          if (qtyNum === 0) continue;

          // Find product
          let product: any = null;
          if (it.productId) {
            product = await tx.product.findUnique({ where: { id: it.productId } });
          }
          if (!product && it.sku) {
            product = await tx.product.findFirst({
              where: { sku: { equals: String(it.sku).trim(), mode: 'insensitive' } }
            });
          }
          if (!product && it.itemCode) {
            product = await tx.product.findFirst({
              where: {
                OR: [
                  { sku: { equals: String(it.itemCode).trim(), mode: 'insensitive' } },
                  { name: { equals: String(it.itemCode).trim(), mode: 'insensitive' } }
                ]
              }
            });
          }
          if (!product && it.name) {
            product = await tx.product.findFirst({
              where: { name: { equals: String(it.name).trim(), mode: 'insensitive' } }
            });
          }

          if (!product) {
            throw new Error(`Product "${it.sku || it.itemCode || it.name || it.productId || 'Row ' + (i + 1)}" not found.`);
          }

          const lineType = it.type || type || 'STOCK_RECEIPT';
          const isNegative = lineType === 'MATERIAL_ISSUE' || Number(rawQty) < 0;
          const qtyChangeNum = isNegative ? -qtyNum : qtyNum;

          // Calculate running balance for this product
          const currentBalanceResult: any = await tx.$queryRaw`
            SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
            FROM "StockLedger"
            WHERE "productId" = ${product.id}
              AND date <= ${entryDate}::TIMESTAMP
          `;
          const balanceBefore = currentBalanceResult[0]?.balance_before
            ? Number(currentBalanceResult[0].balance_before)
            : 0;
          const newRunningBalance = balanceBefore + qtyChangeNum;

          if (newRunningBalance < 0) {
            throw new Error(`Stock entry causes negative stock balance (${newRunningBalance}) for product ${product.name}`);
          }

          // Create StockLedger entry
          const ledger = await tx.stockLedger.create({
            data: {
              productId: product.id,
              date: entryDate,
              type: lineType,
              quantityChange: qtyChangeNum,
              runningBalance: newRunningBalance,
            },
            include: {
              product: true,
            },
          });

          // Update product
          const rateVal = it.unitRate ?? it.rate ?? it.valuationRate;
          const rateNum = rateVal !== undefined && rateVal !== null && !isNaN(Number(rateVal)) && Number(rateVal) > 0 ? Number(rateVal) : null;

          await tx.product.update({
            where: { id: product.id },
            data: {
              quantity: { increment: qtyChangeNum },
              ...(itemLocation ? { location: String(itemLocation).trim() } : {}),
              ...(rateNum !== null ? { valuationRate: rateNum, cost_price: rateNum } : {})
            }
          });

          createdEntries.push(ledger);
        }

        return createdEntries;
      });

      return res.status(201).json({
        message: `Stock entry voucher created successfully with ${results.length} items`,
        entries: results,
        id: results[0]?.id
      });
    }

    // Single item payload (legacy/simple)
    const { productId, type, quantityChange, date, notes, location, valuationRate } = req.body;

    if (!productId || quantityChange === undefined || quantityChange === null) {
      return res.status(400).json({ error: 'productId and quantityChange are required' });
    }

    const qtyChangeNum = Math.round(Number(quantityChange));
    if (isNaN(qtyChangeNum)) {
      return res.status(400).json({ error: 'quantityChange must be a valid number' });
    }

    const entryType = type || (qtyChangeNum >= 0 ? 'STOCK_RECEIPT' : 'MATERIAL_ISSUE');
    const entryDate = date ? new Date(date) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new Error(`Product with ID ${productId} not found`);
      }

      // Calculate running balance for this product
      const currentBalanceResult: any = await tx.$queryRaw`
        SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
        FROM "StockLedger"
        WHERE "productId" = ${productId}
          AND date <= ${entryDate}::TIMESTAMP
      `;
      const balanceBefore = currentBalanceResult[0]?.balance_before
        ? Number(currentBalanceResult[0].balance_before)
        : 0;
      const newRunningBalance = balanceBefore + qtyChangeNum;

      // Prevent negative stock balance
      if (newRunningBalance < 0) {
        throw new Error(`Stock entry causes negative stock balance (${newRunningBalance}) for product ${product.name}`);
      }

      // Create StockLedger entry
      const ledger = await tx.stockLedger.create({
        data: {
          productId,
          date: entryDate,
          type: entryType,
          quantityChange: qtyChangeNum,
          runningBalance: newRunningBalance,
        },
        include: {
          product: true,
        },
      });

      // Update cached Product quantity and optionally location / valuationRate
      const rateNum = valuationRate ? Number(valuationRate) : null;
      await tx.product.update({
        where: { id: productId },
        data: { 
          quantity: { increment: qtyChangeNum },
          ...(location ? { location: String(location).trim() } : {}),
          ...(rateNum !== null && !isNaN(rateNum) ? { valuationRate: rateNum, cost_price: rateNum } : {})
        },
      });

      return ledger;
    });

    res.status(201).json(result);
  } catch (error: any) {
    console.error('Failed to create stock entry:', error);
    res.status(500).json({ error: error.message || 'Failed to create stock entry' });
  }
});

// PUT update manual stock entry
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { quantityChange, type, date } = req.body;

    const existingEntry = await prisma.stockLedger.findUnique({ where: { id } });
    if (!existingEntry) {
      return res.status(404).json({ error: 'Stock entry not found' });
    }

    const oldQty = existingEntry.quantityChange;
    const newQty = quantityChange !== undefined ? Number(quantityChange) : oldQty;
    const qtyDifference = newQty - oldQty;
    const entryType = type || existingEntry.type;
    const entryDate = date ? new Date(date) : existingEntry.date;

    const result = await prisma.$transaction(async (tx) => {
      const updatedLedger = await tx.stockLedger.update({
        where: { id },
        data: {
          quantityChange: newQty,
          type: entryType,
          date: entryDate,
          runningBalance: existingEntry.runningBalance + qtyDifference,
        },
        include: {
          product: true,
        },
      });

      if (qtyDifference !== 0) {
        await tx.product.update({
          where: { id: existingEntry.productId },
          data: { quantity: { increment: qtyDifference } },
        });
      }

      return updatedLedger;
    });

    res.json(result);
  } catch (error: any) {
    console.error('Failed to update stock entry:', error);
    res.status(500).json({ error: error.message || 'Failed to update stock entry' });
  }
});

// DELETE manual stock entry
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingEntry = await prisma.stockLedger.findUnique({ where: { id } });
    if (!existingEntry) {
      return res.status(404).json({ error: 'Stock entry not found' });
    }

    await prisma.$transaction(async (tx) => {
      // Revert quantity on product
      await tx.product.update({
        where: { id: existingEntry.productId },
        data: { quantity: { decrement: existingEntry.quantityChange } },
      });

      // Delete ledger entry
      await tx.stockLedger.delete({ where: { id } });
    });

    res.json({ message: 'Stock entry deleted successfully' });
  } catch (error: any) {
    console.error('Failed to delete stock entry:', error);
    res.status(500).json({ error: error.message || 'Failed to delete stock entry' });
  }
});

export default router;
