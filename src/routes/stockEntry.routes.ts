import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

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

// POST create manual stock entry / adjustment / issue / receipt
router.post('/', async (req: Request, res: Response) => {
  try {
    const { productId, type, quantityChange, date, notes } = req.body;

    if (!productId || quantityChange === undefined || quantityChange === null) {
      return res.status(400).json({ error: 'productId and quantityChange are required' });
    }

    const qtyChangeNum = Number(quantityChange);
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

      // Update cached Product quantity
      await tx.product.update({
        where: { id: productId },
        data: { quantity: { increment: qtyChangeNum } },
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
