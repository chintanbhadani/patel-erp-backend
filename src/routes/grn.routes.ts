import { Router, Request, Response } from 'express';
import { PrismaClient, GrnStatus } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Utility to generate GRN number
const generateGrnNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `GRN-${year}-`;

  const lastGrn = await prisma.grn.findFirst({
    where: {
      grnNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      grnNumber: 'desc',
    },
  });

  if (!lastGrn) {
    return `${prefix}0001`;
  }

  const lastNumberStr = lastGrn.grnNumber.replace(prefix, '');
  const nextNumber = parseInt(lastNumberStr, 10) + 1;
  const paddedNumber = nextNumber.toString().padStart(4, '0');

  return `${prefix}${paddedNumber}`;
};

// GET all GRNs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, status, invoiceId, supplierId } = req.query;

    const whereConditions: any[] = [];

    if (status && status !== 'ALL') {
      whereConditions.push({ status: status as GrnStatus });
    }

    if (invoiceId) {
      whereConditions.push({ invoiceId: invoiceId as string });
    }

    if (supplierId) {
      whereConditions.push({ supplierId: supplierId as string });
    }

    if (search) {
      const q = (search as string).trim();
      whereConditions.push({
        OR: [
          { grnNumber: { contains: q, mode: 'insensitive' } },
          { invoice: { invoiceNumber: { contains: q, mode: 'insensitive' } } },
          { supplier: { name: { contains: q, mode: 'insensitive' } } },
          { items: { some: { product: { name: { contains: q, mode: 'insensitive' } } } } },
          { items: { some: { product: { sku: { contains: q, mode: 'insensitive' } } } } },
        ],
      });
    }

    const grns = await prisma.grn.findMany({
      where: whereConditions.length > 0 ? { AND: whereConditions } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: true,
        invoice: {
          include: {
            supplier: true,
            client: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    res.json(grns);
  } catch (error) {
    console.error('Failed to fetch GRNs:', error);
    res.status(500).json({ error: 'Failed to fetch GRNs' });
  }
});

// GET single GRN by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const grn = await prisma.grn.findUnique({
      where: { id },
      include: {
        supplier: true,
        invoice: {
          include: {
            supplier: true,
            items: {
              include: { product: true },
            },
          },
        },
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!grn) return res.status(404).json({ error: 'GRN not found' });
    res.json(grn);
  } catch (error) {
    console.error('Failed to fetch GRN:', error);
    res.status(500).json({ error: 'Failed to fetch GRN' });
  }
});

// POST create GRN for a Purchase Invoice
router.post('/', async (req: Request, res: Response) => {
  try {
    const { invoiceId, supplierId, notes, items, autoAccept } = req.body;

    if (!invoiceId) {
      return res.status(400).json({ error: 'invoiceId is required' });
    }

    // Check if GRN already exists for this purchase invoice
    const existingGrn = await prisma.grn.findFirst({
      where: { invoiceId },
      include: {
        supplier: true,
        invoice: true,
        items: { include: { product: true } },
      },
    });

    if (existingGrn) {
      return res.json(existingGrn);
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: { include: { product: true } }, supplier: true },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Purchase invoice not found' });
    }

    const grnNumber = await generateGrnNumber();
    const finalSupplierId = supplierId || invoice.supplierId || null;

    // Build GRN items
    const grnItemsData = (items || invoice.items).map((item: any) => {
      const orderedQuantity = Number(item.quantity || item.orderedQuantity || 0);
      const receivedQuantity = Number(item.receivedQuantity ?? orderedQuantity);
      const acceptedQuantity = Number(item.acceptedQuantity ?? receivedQuantity);
      const rejectedQuantity = Number(item.rejectedQuantity ?? (receivedQuantity - acceptedQuantity));

      return {
        productId: item.productId,
        orderedQuantity,
        receivedQuantity,
        acceptedQuantity,
        rejectedQuantity: Math.max(0, rejectedQuantity),
        unitPrice: Number(item.unitPrice || 0),
        remarks: item.remarks || '',
      };
    });

    const initialStatus: GrnStatus = autoAccept ? 'ACCEPTED' : 'PENDING_INSPECTION';

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create GRN
      const grn = await tx.grn.create({
        data: {
          grnNumber,
          invoiceId,
          supplierId: finalSupplierId,
          status: initialStatus,
          notes: notes || '',
          items: {
            create: grnItemsData,
          },
        },
        include: {
          supplier: true,
          invoice: true,
          items: {
            include: { product: true },
          },
        },
      });

      // 2. If autoAccept, process stock ingestion immediately
      if (autoAccept) {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { grnStatus: 'RECEIVED' },
        });

        for (const grnItem of grn.items) {
          const acceptedQty = Number(grnItem.acceptedQuantity);
          if (acceptedQty > 0) {
            // Calculate running balance
            const currentBalanceResult: any = await tx.$queryRaw`
              SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
              FROM "StockLedger"
              WHERE "productId" = ${grnItem.productId}
            `;
            const balanceBefore = currentBalanceResult[0]?.balance_before
              ? Number(currentBalanceResult[0].balance_before)
              : 0;
            const newRunningBalance = balanceBefore + acceptedQty;

            // Log in StockLedger
            await tx.stockLedger.create({
              data: {
                productId: grnItem.productId,
                date: new Date(),
                type: 'GRN_RECEIPT',
                quantityChange: acceptedQty,
                runningBalance: newRunningBalance,
                invoiceId: invoiceId,
              },
            });

            // Increment Product stock
            await tx.product.update({
              where: { id: grnItem.productId },
              data: { quantity: { increment: acceptedQty } },
            });
          }
        }
      }

      return grn;
    });

    res.status(201).json(result);
  } catch (error: any) {
    console.error('Failed to create GRN:', error);
    res.status(500).json({ error: error.message || 'Failed to create GRN' });
  }
});

// POST accept GRN -> Add accepted quantity to physical stock
router.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const grn = await prisma.grn.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        invoice: true,
      },
    });

    if (!grn) {
      return res.status(404).json({ error: 'GRN not found' });
    }

    if (grn.status === 'ACCEPTED') {
      return res.status(400).json({ error: 'GRN has already been accepted and processed' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update GRN status
      const updatedGrn = await tx.grn.update({
        where: { id },
        data: { status: 'ACCEPTED' },
        include: {
          supplier: true,
          invoice: true,
          items: { include: { product: true } },
        },
      });

      // 2. Update Invoice status
      await tx.invoice.update({
        where: { id: grn.invoiceId },
        data: { grnStatus: 'RECEIVED' },
      });

      // 3. Increment physical inventory for each accepted item
      for (const item of grn.items) {
        const acceptedQty = Number(item.acceptedQuantity);
        if (acceptedQty > 0) {
          // Calculate running balance
          const currentBalanceResult: any = await tx.$queryRaw`
            SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
            FROM "StockLedger"
            WHERE "productId" = ${item.productId}
          `;
          const balanceBefore = currentBalanceResult[0]?.balance_before
            ? Number(currentBalanceResult[0].balance_before)
            : 0;
          const newRunningBalance = balanceBefore + acceptedQty;

          // Create StockLedger entry
          await tx.stockLedger.create({
            data: {
              productId: item.productId,
              date: new Date(),
              type: 'GRN_RECEIPT',
              quantityChange: acceptedQty,
              runningBalance: newRunningBalance,
              invoiceId: grn.invoiceId,
            },
          });

          // Add to physical inventory
          await tx.product.update({
            where: { id: item.productId },
            data: { quantity: { increment: acceptedQty } },
          });
        }
      }

      return updatedGrn;
    });

    res.json({ message: 'GRN accepted successfully and physical stock added to inventory', grn: result });
  } catch (error: any) {
    console.error('Failed to accept GRN:', error);
    res.status(500).json({ error: error.message || 'Failed to accept GRN' });
  }
});

// POST reject GRN
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const grn = await prisma.grn.findUnique({ where: { id } });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });

    if (grn.status === 'ACCEPTED') {
      return res.status(400).json({ error: 'Cannot reject an already accepted GRN' });
    }

    const updated = await prisma.grn.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    res.json({ message: 'GRN marked as rejected', grn: updated });
  } catch (error: any) {
    console.error('Failed to reject GRN:', error);
    res.status(500).json({ error: error.message || 'Failed to reject GRN' });
  }
});

export default router;
