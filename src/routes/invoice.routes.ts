import { Router, Request, Response } from 'express';
import { PrismaClient, InvoiceType } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Utility to generate invoice number
const generateInvoiceNumber = async (type: InvoiceType) => {
  const year = new Date().getFullYear();
  const typeChar = type === 'PURCHASE' ? 'P' : 'S';
  const prefix = `INV-${year}-${typeChar}`;

  const lastInvoice = await prisma.invoice.findFirst({
    where: {
      invoiceNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      invoiceNumber: 'desc',
    },
  });

  if (!lastInvoice) {
    return `${prefix}0001`;
  }

  // Extract the number part
  const lastNumberStr = lastInvoice.invoiceNumber.replace(prefix, '');
  const nextNumber = parseInt(lastNumberStr, 10) + 1;
  const paddedNumber = nextNumber.toString().padStart(4, '0');

  return `${prefix}${paddedNumber}`;
};

// GET all invoices
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, type, party, invoiceNumber, paymentType } = req.query;

    const whereConditions: any[] = [];

    if (search) {
      const q = (search as string).trim();
      whereConditions.push({
        OR: [
          { invoiceNumber: { contains: q, mode: 'insensitive' } },
          { client: { companyName: { contains: q, mode: 'insensitive' } } },
          { supplier: { name: { contains: q, mode: 'insensitive' } } },
        ]
      });
    }

    if (type && type !== 'ALL') {
      whereConditions.push({ type: type as any });
    }

    if (invoiceNumber) {
      whereConditions.push({
        invoiceNumber: { contains: (invoiceNumber as string).trim(), mode: 'insensitive' }
      });
    }

    if (party) {
      const p = (party as string).trim();
      whereConditions.push({
        OR: [
          { client: { companyName: { contains: p, mode: 'insensitive' } } },
          { supplier: { name: { contains: p, mode: 'insensitive' } } },
        ]
      });
    }

    if (paymentType && paymentType !== 'ALL') {
      whereConditions.push({ paymentType: paymentType as any });
    }

    const invoices = await prisma.invoice.findMany({
      where: whereConditions.length > 0 ? { AND: whereConditions } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        client: true,
        supplier: true,
        grns: true,
        items: {
          include: {
            product: true,
          }
        }
      },
    });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// GET single invoice by id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// POST create new invoice
router.post('/', async (req: Request, res: Response) => {
  try {
    const { type, date, clientId, supplierId, items, paymentType, cashAmount, bankAmount, creditAmount } = req.body;
    
    // 1. Validation
    if (!type || !items || items.length === 0) {
      return res.status(400).json({ error: 'Invalid invoice data' });
    }
    if (type === 'SALES' && !clientId) {
      return res.status(400).json({ error: 'Client ID is required for SALES invoices' });
    }

    if (type === 'PURCHASE' && !supplierId) {
      return res.status(400).json({ error: 'Supplier is required for purchase invoice' });
    }

    // 1b. Resolve productIds — frontend may send a SkuMaster.id if no Product existed yet.
    //     Validate each productId against the Product table; if not found, check SkuMaster
    //     and auto-create the corresponding Product.
    const resolvedItems: any[] = [];
    for (const item of items) {
      let productId = item.productId;

      const existingProduct = await prisma.product.findUnique({ where: { id: productId } });

      if (!existingProduct) {
        // productId might be a SkuMaster.id — try to look it up
        const skuMaster = await prisma.skuMaster.findUnique({ where: { id: productId } });

        if (skuMaster) {
          // Check if a Product with this sku already exists (created by a concurrent request)
          const existingBySku = await prisma.product.findUnique({ where: { sku: skuMaster.sku } });
          if (existingBySku) {
            productId = existingBySku.id;
          } else {
            // Auto-create a minimal Product from SkuMaster data
            const newProduct = await prisma.product.create({
              data: {
                sku: skuMaster.sku,
                name: skuMaster.name,
                categoryId: skuMaster.categoryId || null,
                supplierId: type === 'PURCHASE' ? supplierId : null,
                quantity: 0,
                cost_price: 0,
                selling_price: 0,
                min_stock: 0,
                location: '',
                status: 'Active',
              },
            });
            productId = newProduct.id;
          }
        } else {
          return res.status(400).json({
            error: `Product with ID "${productId}" not found. Please re-select the product.`
          });
        }
      }

      resolvedItems.push({ ...item, productId });
    }

    const totalAmount = resolvedItems.reduce(
      (sum: number, item: any) => sum + Number(item.quantity) * Number(item.unitPrice),
      0
    );

    const invoiceNumber = await generateInvoiceNumber(type as InvoiceType);

    const invoiceDate = new Date(date || Date.now());

    // Use a transaction to ensure all operations succeed or fail together
    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify chronological stock (The "Future-Dip" check)
      for (const item of resolvedItems) {
        const quantityChange = type === 'PURCHASE' ? Number(item.quantity) : -Number(item.quantity);
        
        if (type === 'SALES') {
          // Check stock point-in-time and future
          const minBalanceResult: any = await tx.$queryRaw`
            WITH proposed_ledger AS (
                SELECT date, "quantityChange"
                FROM "StockLedger"
                WHERE "productId" = ${item.productId}
                
                UNION ALL
                
                SELECT ${invoiceDate}::TIMESTAMP, ${quantityChange}::INTEGER
            ),
            cumulative_calculation AS (
                SELECT 
                    date,
                    SUM("quantityChange") OVER (ORDER BY date ASC) AS cumulative_balance
                FROM proposed_ledger
            )
            SELECT MIN(cumulative_balance) AS min_future_balance
            FROM cumulative_calculation
            WHERE date >= ${invoiceDate}::TIMESTAMP;
          `;
          
          const minFutureBalance = minBalanceResult[0]?.min_future_balance ? Number(minBalanceResult[0].min_future_balance) : quantityChange;
          
          if (minFutureBalance < 0) {
            throw new Error(`Insufficient stock for product. Backdating this sale causes inventory to drop below zero (Dip: ${minFutureBalance}) on or after ${invoiceDate.toISOString()}.`);
          }
        }
      }

      const finalCashAmount = cashAmount !== undefined ? Number(cashAmount) : (paymentType === 'CASH' ? totalAmount : 0);
      const finalBankAmount = bankAmount !== undefined ? Number(bankAmount) : (paymentType === 'BANK' ? totalAmount : 0);
      const finalCreditAmount = creditAmount !== undefined ? Number(creditAmount) : (paymentType === 'CREDIT' ? totalAmount : 0);

      // 2. Create Invoice and Items
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          type,
          date: invoiceDate,
          totalAmount,
          clientId: type === 'SALES' ? clientId : null,
          supplierId: type === 'PURCHASE' ? supplierId : null,
          paymentType: paymentType || 'CASH',
          cashAmount: finalCashAmount,
          bankAmount: finalBankAmount,
          creditAmount: finalCreditAmount,
          grnStatus: type === 'PURCHASE' ? 'PENDING_GRN' : 'COMPLETED',
          items: {
            create: resolvedItems.map((item: any) => ({
              productId: item.productId,
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              totalPrice: Number(item.quantity) * Number(item.unitPrice),
            })),
          },
        },
        include: {
          items: true,
        },
      });

      // 3. Update Inventory and Ledger for SALES invoices (PURCHASE stock is added via GRN acceptance)
      if (type === 'SALES') {
        for (const item of resolvedItems) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });

          if (!product) {
            throw new Error(`Product with ID ${item.productId} not found`);
          }

          const quantityChange = -Number(item.quantity);
          
          // Calculate running balance
          const currentBalanceResult: any = await tx.$queryRaw`
            SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
            FROM "StockLedger"
            WHERE "productId" = ${item.productId}
              AND date < ${invoiceDate}::TIMESTAMP
          `;
          
          const balanceBefore = currentBalanceResult[0]?.balance_before ? Number(currentBalanceResult[0].balance_before) : 0;
          const newRunningBalance = balanceBefore + quantityChange;

          // Insert into ledger
          await tx.stockLedger.create({
            data: {
              productId: item.productId,
              date: invoiceDate,
              type: type,
              quantityChange: quantityChange,
              runningBalance: newRunningBalance,
              invoiceId: invoice.id,
            }
          });

          // Forward Recalculation
          await tx.$queryRaw`
              UPDATE "StockLedger"
              SET "runningBalance" = "runningBalance" + ${quantityChange}
              WHERE "productId" = ${item.productId}
                AND date > ${invoiceDate}::TIMESTAMP
          `;

          // Update product quantity
          const newProductQuantity = product.quantity + quantityChange;
          await tx.product.update({
            where: { id: item.productId },
            data: { quantity: newProductQuantity },
          });
        }
      }



      return invoice;
    });

    res.status(201).json(result);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to create invoice' });
  }
});

export default router;
