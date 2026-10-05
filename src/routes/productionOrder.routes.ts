import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Helper to generate next Order Number
async function generateNextOrderNumber(dateStr?: string): Promise<string> {
  const d = dateStr ? new Date(dateStr) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const prefix = `PSPL/PO-${year}-${month}-`;

  const lastOrder = await prisma.productionOrder.findFirst({
    where: {
      orderNumber: {
        startsWith: prefix
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  let nextSeq = 1;
  if (lastOrder && lastOrder.orderNumber) {
    const parts = lastOrder.orderNumber.split('-');
    const lastNumStr = parts[parts.length - 1];
    const parsed = parseInt(lastNumStr, 10);
    if (!isNaN(parsed)) {
      nextSeq = parsed + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}

// GET Next Production Order ID
router.get('/next-id', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const orderNumber = await generateNextOrderNumber(date ? String(date) : undefined);
    res.json({ id: orderNumber, series: 'PSPL/PO-.YYYY.-.MM.-' });
  } catch (error: any) {
    console.error('Error generating next Production Order ID:', error);
    res.status(500).json({ error: 'Failed to generate next Production Order ID' });
  }
});

// GET All Production Orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, status, clientId } = req.query;

    const where: any = {};
    if (status && status !== 'all') {
      where.status = String(status);
    }
    if (clientId) {
      where.clientId = Number(clientId);
    }
    if (search) {
      const q = String(search).trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { piNo: { contains: q, mode: 'insensitive' } },
        { poNumber: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { state: { contains: q, mode: 'insensitive' } }
      ];
    }

    const orders = await prisma.productionOrder.findMany({
      where,
      include: {
        client: true,
        items: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = orders.map(o => ({
      ...o,
      orderNumber: o.orderNumber || o.id,
      orderSheetDate: o.orderSheetDate ? o.orderSheetDate.toISOString().split('T')[0] : '',
      poDate: o.poDate ? o.poDate.toISOString().split('T')[0] : '',
      dispatchDate: o.dispatchDate ? o.dispatchDate.toISOString().split('T')[0] : ''
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error('Error fetching production orders:', error);
    res.status(500).json({ error: 'Failed to fetch production orders' });
  }
});

// GET Single Production Order
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const order = await prisma.productionOrder.findFirst({
      where: {
        OR: [
          { id },
          { orderNumber: id }
        ]
      },
      include: {
        client: true,
        items: true
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Production Order not found' });
    }

    res.json({
      ...order,
      orderNumber: order.orderNumber || order.id,
      orderSheetDate: order.orderSheetDate ? order.orderSheetDate.toISOString().split('T')[0] : '',
      poDate: order.poDate ? order.poDate.toISOString().split('T')[0] : '',
      dispatchDate: order.dispatchDate ? order.dispatchDate.toISOString().split('T')[0] : ''
    });
  } catch (error: any) {
    console.error('Error fetching production order:', error);
    res.status(500).json({ error: 'Failed to fetch production order' });
  }
});

// POST Create Production Order
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;

    const generatedNo = await generateNextOrderNumber(data.orderSheetDate);
    const orderNumber = data.orderNumber || generatedNo;

    const created = await prisma.productionOrder.create({
      data: {
        orderNumber,
        series: data.series || 'PSPL/PO-.YYYY.-.MM.-',
        orderSheetDate: data.orderSheetDate ? new Date(data.orderSheetDate) : new Date(),
        customerStatus: data.customerStatus || 'OLD',
        state: data.state || '',
        city: data.city || '',
        customerType: data.customerType || 'USER',
        apxDispatchDays: data.apxDispatchDays || '',
        creditDays: data.creditDays || '',
        piNo: data.piNo || '',
        customerName: data.customerName || 'Untitled Customer',
        clientId: data.clientId ? Number(data.clientId) : undefined,
        billingAddress: data.billingAddress || '',
        email: data.email || '',
        contactNo: data.contactNo || '',
        contactPerson: data.contactPerson || '',
        consigneeAddress: data.consigneeAddress || '',
        deliveryTerms: data.deliveryTerms || '',
        poNumber: data.poNumber || '',
        poDate: data.poDate ? new Date(data.poDate) : undefined,
        customerGstin: data.customerGstin || '',
        packingDetails: data.packingDetails || '',
        stackingDetails: data.stackingDetails || '',
        remarks: data.remarks || '',
        marketing: data.marketing || '',
        ndAmount: data.ndAmount !== undefined ? parseFloat(data.ndAmount) : undefined,
        odAmount: data.odAmount !== undefined ? parseFloat(data.odAmount) : undefined,
        odDays: data.odDays !== undefined ? parseInt(data.odDays, 10) : undefined,
        paymentStatus: data.paymentStatus || 'Pending',
        production: data.production || '',
        logistic: data.logistic || '',
        account: data.account || '',
        managingDirector: data.managingDirector || '',
        authorisedSign: data.authorisedSign || '',
        transporterName: data.transporterName || '',
        transportGstin: data.transportGstin || '',
        lrNo: data.lrNo || '',
        lrDate: data.lrDate ? new Date(data.lrDate) : undefined,
        vehicleNo: data.vehicleNo || '',
        driverName: data.driverName || '',
        mobileNo: data.mobileNo || '',
        insurance: data.insurance || 'YES',
        waybillPartB: data.waybillPartB || 'YES',
        dispatchDate: data.dispatchDate ? new Date(data.dispatchDate) : undefined,
        status: data.status || 'Draft',
        assignedTo: data.assignedTo || 'Administrator',
        tags: data.tags || '',
        attachments: data.attachments || [],
        createdBy: data.createdBy || 'Admin',
        items: {
          create: (data.items || []).map((it: any, index: number) => ({
            srNo: it.srNo || index + 1,
            sizeLength: it.sizeLength || '',
            colour: it.colour || '',
            coreSize: it.coreSize || '',
            surface: it.surface || '',
            noOfArticles: it.noOfArticles ? parseInt(it.noOfArticles, 10) : 0,
            netWtArticles: it.netWtArticles ? parseFloat(it.netWtArticles) : 0,
            mtrsPerArticles: it.mtrsPerArticles ? parseFloat(it.mtrsPerArticles) : 0,
            totalWt: it.totalWt ? parseFloat(it.totalWt) : 0,
            quantity: it.quantity ? parseFloat(it.quantity) : 0,
            unit: it.unit || 'NOS',
            ratePerUnit: it.ratePerUnit ? parseFloat(it.ratePerUnit) : 0,
            breakingLoad: it.breakingLoad || '',
            palletQuantity: it.palletQuantity || '',
            gstPercent: it.gstPercent !== undefined ? parseFloat(it.gstPercent) : 18.0,
            freightTerms: it.freightTerms || 'PAID',
            totalAmount: it.totalAmount ? parseFloat(it.totalAmount) : 0
          }))
        }
      },
      include: {
        items: true,
        client: true
      }
    });

    // Record Activity Log
    try {
      await prisma.activityLog.create({
        data: {
          entityType: 'ProductionOrder',
          entityId: created.id,
          action: 'created Production Order',
          description: `Created Production Order ${created.id} for ${created.customerName}`
        }
      });
    } catch (e) {
      console.warn('Could not record activity log:', e);
    }

    res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating production order:', error);
    res.status(500).json({ error: error.message || 'Failed to create production order' });
  }
});

// PUT Update Production Order
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existing = await prisma.productionOrder.findFirst({
      where: {
        OR: [{ id }, { orderNumber: id }]
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Production Order not found' });
    }

    // Replace items
    await prisma.productionOrderItem.deleteMany({
      where: { productionOrderId: existing.id }
    });

    const updated = await prisma.productionOrder.update({
      where: { id: existing.id },
      data: {
        customerStatus: data.customerStatus !== undefined ? data.customerStatus : existing.customerStatus,
        state: data.state !== undefined ? data.state : existing.state,
        city: data.city !== undefined ? data.city : existing.city,
        customerType: data.customerType !== undefined ? data.customerType : existing.customerType,
        apxDispatchDays: data.apxDispatchDays !== undefined ? data.apxDispatchDays : existing.apxDispatchDays,
        creditDays: data.creditDays !== undefined ? data.creditDays : existing.creditDays,
        piNo: data.piNo !== undefined ? data.piNo : existing.piNo,
        customerName: data.customerName || existing.customerName,
        clientId: data.clientId ? Number(data.clientId) : existing.clientId,
        billingAddress: data.billingAddress !== undefined ? data.billingAddress : existing.billingAddress,
        email: data.email !== undefined ? data.email : existing.email,
        contactNo: data.contactNo !== undefined ? data.contactNo : existing.contactNo,
        contactPerson: data.contactPerson !== undefined ? data.contactPerson : existing.contactPerson,
        consigneeAddress: data.consigneeAddress !== undefined ? data.consigneeAddress : existing.consigneeAddress,
        deliveryTerms: data.deliveryTerms !== undefined ? data.deliveryTerms : existing.deliveryTerms,
        poNumber: data.poNumber !== undefined ? data.poNumber : existing.poNumber,
        poDate: data.poDate ? new Date(data.poDate) : existing.poDate,
        customerGstin: data.customerGstin !== undefined ? data.customerGstin : existing.customerGstin,
        packingDetails: data.packingDetails !== undefined ? data.packingDetails : existing.packingDetails,
        stackingDetails: data.stackingDetails !== undefined ? data.stackingDetails : existing.stackingDetails,
        remarks: data.remarks !== undefined ? data.remarks : existing.remarks,
        marketing: data.marketing !== undefined ? data.marketing : existing.marketing,
        ndAmount: data.ndAmount !== undefined ? parseFloat(data.ndAmount) : existing.ndAmount,
        odAmount: data.odAmount !== undefined ? parseFloat(data.odAmount) : existing.odAmount,
        odDays: data.odDays !== undefined ? parseInt(data.odDays, 10) : existing.odDays,
        paymentStatus: data.paymentStatus !== undefined ? data.paymentStatus : existing.paymentStatus,
        production: data.production !== undefined ? data.production : existing.production,
        logistic: data.logistic !== undefined ? data.logistic : existing.logistic,
        account: data.account !== undefined ? data.account : existing.account,
        managingDirector: data.managingDirector !== undefined ? data.managingDirector : existing.managingDirector,
        authorisedSign: data.authorisedSign !== undefined ? data.authorisedSign : existing.authorisedSign,
        transporterName: data.transporterName !== undefined ? data.transporterName : existing.transporterName,
        transportGstin: data.transportGstin !== undefined ? data.transportGstin : existing.transportGstin,
        lrNo: data.lrNo !== undefined ? data.lrNo : existing.lrNo,
        lrDate: data.lrDate ? new Date(data.lrDate) : existing.lrDate,
        vehicleNo: data.vehicleNo !== undefined ? data.vehicleNo : existing.vehicleNo,
        driverName: data.driverName !== undefined ? data.driverName : existing.driverName,
        mobileNo: data.mobileNo !== undefined ? data.mobileNo : existing.mobileNo,
        insurance: data.insurance !== undefined ? data.insurance : existing.insurance,
        waybillPartB: data.waybillPartB !== undefined ? data.waybillPartB : existing.waybillPartB,
        dispatchDate: data.dispatchDate ? new Date(data.dispatchDate) : existing.dispatchDate,
        status: data.status || existing.status,
        assignedTo: data.assignedTo || existing.assignedTo,
        tags: data.tags !== undefined ? data.tags : existing.tags,
        attachments: data.attachments || existing.attachments,
        items: {
          create: (data.items || []).map((it: any, index: number) => ({
            srNo: it.srNo || index + 1,
            sizeLength: it.sizeLength || '',
            colour: it.colour || '',
            coreSize: it.coreSize || '',
            surface: it.surface || '',
            noOfArticles: it.noOfArticles ? parseInt(it.noOfArticles, 10) : 0,
            netWtArticles: it.netWtArticles ? parseFloat(it.netWtArticles) : 0,
            mtrsPerArticles: it.mtrsPerArticles ? parseFloat(it.mtrsPerArticles) : 0,
            totalWt: it.totalWt ? parseFloat(it.totalWt) : 0,
            quantity: it.quantity ? parseFloat(it.quantity) : 0,
            unit: it.unit || 'NOS',
            ratePerUnit: it.ratePerUnit ? parseFloat(it.ratePerUnit) : 0,
            breakingLoad: it.breakingLoad || '',
            palletQuantity: it.palletQuantity || '',
            gstPercent: it.gstPercent !== undefined ? parseFloat(it.gstPercent) : 18.0,
            freightTerms: it.freightTerms || 'PAID',
            totalAmount: it.totalAmount ? parseFloat(it.totalAmount) : 0
          }))
        }
      },
      include: {
        items: true,
        client: true
      }
    });

    // Activity Log
    try {
      await prisma.activityLog.create({
        data: {
          entityType: 'ProductionOrder',
          entityId: updated.id,
          action: 'updated Production Order',
          description: `Updated Production Order ${updated.id}`
        }
      });
    } catch (e) {
      console.warn('Could not record activity log:', e);
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating production order:', error);
    res.status(500).json({ error: error.message || 'Failed to update production order' });
  }
});

// DELETE Production Order
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.productionOrder.findFirst({
      where: {
        OR: [{ id }, { orderNumber: id }]
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Production Order not found' });
    }

    await prisma.productionOrder.delete({
      where: { id: existing.id }
    });

    res.json({ message: 'Production Order deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting production order:', error);
    res.status(500).json({ error: 'Failed to delete production order' });
  }
});

export default router;
