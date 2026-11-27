import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Helper to generate next Order Number
// Helper to calculate Indian Financial Year suffix (e.g. 26-27 for FY 2026-2027)
function getFinancialYearSuffix(dateInput?: Date | string): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const month = validDate.getMonth() + 1;
  const year = validDate.getFullYear();

  let startYear = year;
  if (month < 4) {
    startYear = year - 1;
  }
  const endYear = startYear + 1;

  const startYY = String(startYear).slice(-2);
  const endYY = String(endYear).slice(-2);

  return `${startYY}-${endYY}`;
}

// Normalize machine code (maps legacy M-01 -> EXT-01)
export function normalizeMachineCode(code?: string | null): string {
  if (!code) return 'EXT-01';
  const c = String(code).trim().toUpperCase();
  if (c === 'M-01' || c === 'M-1' || c === '1') return 'EXT-01';
  if (c === 'M-02' || c === 'M-2' || c === '2') return 'EXT-02';
  if (c === 'M-03' || c === 'M-3' || c === '3') return 'EXT-03';
  if (c === 'M-04' || c === 'M-4' || c === '4') return 'EXT-04';
  return c;
}

// Helper to compute live Production Status of an order
export function computeOrderProductionStatus(order: any): {
  productionStatus: 'Completed' | 'In Production' | 'In Queue' | 'On Hold' | 'Draft';
  productionProgress: number;
  assignedMachine: string;
} {
  const items = order.items || [];
  if (order.status === 'Draft' || order.status === 'Cancelled') {
    return { productionStatus: (order.status === 'Cancelled' ? 'Cancelled' : 'Draft') as any, productionProgress: 0, assignedMachine: '' };
  }

  const rawMachine = order.assignedMachine || items[0]?.assignedMachine || 'EXT-01';
  const assignedMachine = normalizeMachineCode(rawMachine) || 'EXT-01';

  if (items.length === 0) {
    if (order.status === 'Completed') return { productionStatus: 'Completed', productionProgress: 100, assignedMachine };
    if (order.status === 'In Production') return { productionStatus: 'In Production', productionProgress: 50, assignedMachine };
    return { productionStatus: order.status === 'Submitted' ? 'In Queue' : 'Draft', productionProgress: 0, assignedMachine };
  }

  const completedCount = items.filter((i: any) => i.status === 'Completed' || (i.completionPercentage || 0) >= 100).length;
  const inProdCount = items.filter((i: any) => i.status === 'In Production' || ((i.completionPercentage || 0) > 0 && (i.completionPercentage || 0) < 100)).length;
  const onHoldCount = items.filter((i: any) => i.status === 'On Hold').length;

  const totalProgress = items.reduce((sum: number, it: any) => sum + (it.completionPercentage || 0), 0);
  const avgProgress = Math.round(totalProgress / items.length);

  // If order has line items, line items dictate whether production is truly Completed
  if (items.length > 0 && completedCount === items.length) {
    return { productionStatus: 'Completed', productionProgress: 100, assignedMachine };
  }

  if (inProdCount > 0 || completedCount > 0 || avgProgress > 0) {
    return { productionStatus: 'In Production', productionProgress: avgProgress || 10, assignedMachine };
  }

  if (onHoldCount > 0) {
    return { productionStatus: 'On Hold', productionProgress: avgProgress, assignedMachine };
  }

  return { productionStatus: 'In Queue', productionProgress: 0, assignedMachine };
}

// Helper to generate next Order Number: PO/CHE-OIIP/xxxx/26-27
async function generateNextOrderNumber(dateStr?: string): Promise<string> {
  const fy = getFinancialYearSuffix(dateStr);
  const prefix = `PO/CHE-OIIP/`;

  const existing = await prisma.productionOrder.findMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { orderNumber: { startsWith: prefix } }
      ]
    },
    select: { id: true, orderNumber: true }
  });

  let maxSeq = 0;
  existing.forEach(po => {
    const code = po.orderNumber || po.id || '';
    if (code.startsWith(prefix)) {
      const parts = code.split('/');
      if (parts.length >= 3) {
        const seqNum = parseInt(parts[2], 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }
  });

  if (maxSeq === 0) {
    const count = await prisma.productionOrder.count();
    maxSeq = count;
  }

  const nextSeq = (maxSeq + 1).toString().padStart(4, '0');
  return `PO/CHE-OIIP/${nextSeq}/${fy}`;
}

// GET Next Production Order ID
router.get('/next-id', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const orderNumber = await generateNextOrderNumber(date ? String(date) : undefined);
    res.json({ id: orderNumber, nextId: orderNumber, series: 'PO/CHE-OIIP/xxxx/26-27' });
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

    const formatted = orders.map(o => {
      const prod = computeOrderProductionStatus(o);

      let effectiveStatus = o.status;
      if (o.items && o.items.length > 0) {
        const completedCount = o.items.filter((i: any) => i.status === 'Completed' || (i.completionPercentage || 0) >= 100).length;
        if (completedCount === o.items.length) {
          effectiveStatus = 'Completed';
          if (o.status !== 'Completed') {
            prisma.productionOrder.update({ where: { id: o.id }, data: { status: 'Completed' } }).catch(() => {});
          }
        } else if (o.status === 'Completed') {
          effectiveStatus = prod.productionStatus === 'In Production' ? 'In Production' : 'Submitted';
          prisma.productionOrder.update({ where: { id: o.id }, data: { status: effectiveStatus } }).catch(() => {});
        }
      }

      return {
        ...o,
        status: effectiveStatus,
        orderNumber: o.orderNumber || o.id,
        productionStatus: prod.productionStatus,
        productionProgress: prod.productionProgress,
        assignedMachine: effectiveStatus === 'Draft' ? '' : prod.assignedMachine,
        orderSheetDate: o.orderSheetDate ? o.orderSheetDate.toISOString().split('T')[0] : '',
        poDate: o.poDate ? o.poDate.toISOString().split('T')[0] : '',
        dispatchDate: o.dispatchDate ? o.dispatchDate.toISOString().split('T')[0] : '',
        lrDate: o.lrDate ? o.lrDate.toISOString().split('T')[0] : '',
        buyerBillingAddress: o.billingAddress || '',
        consigneeDeliveryAddress: o.consigneeAddress || '',
        items: (o.items || []).map((it: any) => ({
          ...it,
          strapSizeLength: it.sizeLength || it.strapSizeLength || '',
          color: it.colour || it.color || 'Green',
          netWtOfArticles: it.netWtArticles ?? it.netWtOfArticles ?? 0,
          qty: it.quantity ?? it.qty ?? 0,
          palletQty: it.palletQuantity || it.palletQty || ''
        }))
      };
    });

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

    const prod = computeOrderProductionStatus(order);

    let effectiveStatus = order.status;
    if (order.items && order.items.length > 0) {
      const completedCount = order.items.filter((i: any) => i.status === 'Completed' || (i.completionPercentage || 0) >= 100).length;
      if (completedCount === order.items.length) {
        effectiveStatus = 'Completed';
        if (order.status !== 'Completed') {
          prisma.productionOrder.update({ where: { id: order.id }, data: { status: 'Completed' } }).catch(() => {});
        }
      } else if (order.status === 'Completed') {
        effectiveStatus = prod.productionStatus === 'In Production' ? 'In Production' : 'Submitted';
        prisma.productionOrder.update({ where: { id: order.id }, data: { status: effectiveStatus } }).catch(() => {});
      }
    }

    res.json({
      ...order,
      status: effectiveStatus,
      orderNumber: order.orderNumber || order.id,
      productionStatus: prod.productionStatus,
      productionProgress: prod.productionProgress,
      assignedMachine: effectiveStatus === 'Draft' ? '' : prod.assignedMachine,
      orderSheetDate: order.orderSheetDate ? order.orderSheetDate.toISOString().split('T')[0] : '',
      poDate: order.poDate ? order.poDate.toISOString().split('T')[0] : '',
      dispatchDate: order.dispatchDate ? order.dispatchDate.toISOString().split('T')[0] : '',
      lrDate: order.lrDate ? order.lrDate.toISOString().split('T')[0] : '',
      remarksSpecialInstructions: order.remarks || '',
      buyerBillingAddress: order.billingAddress || '',
      consigneeDeliveryAddress: order.consigneeAddress || '',
      marketingApproval: order.marketing || '',
      productionApproval: order.production || '',
      logisticApproval: order.logistic || '',
      accountApproval: order.account || '',
      mdApproval: order.managingDirector || '',
      items: (order.items || []).map((it: any) => ({
        ...it,
        strapSizeLength: it.sizeLength || it.strapSizeLength || '',
        color: it.colour || it.color || 'Green',
        netWtOfArticles: it.netWtArticles ?? it.netWtOfArticles ?? 0,
        qty: it.quantity ?? it.qty ?? 0,
        palletQty: it.palletQuantity || it.palletQty || ''
      }))
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
        billingAddress: data.billingAddress || data.buyerBillingAddress || '',
        email: data.email || '',
        contactNo: data.contactNo || '',
        contactPerson: data.contactPerson || '',
        consigneeAddress: data.consigneeAddress || data.consigneeDeliveryAddress || '',
        deliveryTerms: data.deliveryTerms || '',
        poNumber: data.poNumber || '',
        poDate: data.poDate ? new Date(data.poDate) : undefined,
        customerGstin: data.customerGstin || '',
        packingDetails: data.packingDetails || '',
        stackingDetails: data.stackingDetails || '',
        remarks: data.remarks || data.remarksSpecialInstructions || '',
        marketing: data.marketing || data.marketingApproval || '',
        ndAmount: data.ndAmount !== undefined ? parseFloat(data.ndAmount) : undefined,
        odAmount: data.odAmount !== undefined ? parseFloat(data.odAmount) : undefined,
        odDays: data.odDays !== undefined ? parseInt(data.odDays, 10) : undefined,
        paymentStatus: data.paymentStatus || 'Pending',
        production: data.production || data.productionApproval || '',
        logistic: data.logistic || data.logisticApproval || '',
        account: data.account || data.accountApproval || '',
        managingDirector: data.managingDirector || data.mdApproval || '',
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
        assignedMachine: (data.status === 'Draft' || !data.status) ? null : (normalizeMachineCode(data.assignedMachine) || 'EXT-01'),
        tags: data.tags || '',
        attachments: data.attachments || [],
        createdBy: data.createdBy || 'Admin',
        items: {
          create: (data.items || []).map((it: any, index: number) => ({
            srNo: it.srNo || index + 1,
            sizeLength: it.strapSizeLength || it.sizeLength || '',
            colour: it.color || it.colour || 'Green',
            coreSize: it.coreSize || '',
            surface: it.surface || '',
            width: it.width !== undefined && it.width !== null && it.width !== '' ? parseFloat(it.width) : (it.rollWidth ? parseFloat(it.rollWidth) : null),
            thickness: it.thickness !== undefined && it.thickness !== null && it.thickness !== '' ? parseFloat(it.thickness) : null,
            grade: it.grade || '',
            jointStatus: it.jointStatus || it.rollJoint || 'No Joint',
            dieSelection: it.dieSelection || it.die || '',
            assignedMachine: (data.status === 'Draft' || !data.status) ? null : (normalizeMachineCode(it.assignedMachine || data.assignedMachine) || 'EXT-01'),
            priority: it.priority || 'Normal',
            status: (data.status === 'Draft' || !data.status) ? 'Draft' : (it.status || 'Queued'),
            completionPercentage: it.completionPercentage !== undefined ? parseFloat(it.completionPercentage) : 0,
            sequenceOrder: it.sequenceOrder ? parseInt(it.sequenceOrder, 10) : index + 1,
            noOfArticles: it.noOfArticles ? parseInt(it.noOfArticles, 10) : 0,
            netWtArticles: it.netWtOfArticles !== undefined ? parseFloat(it.netWtOfArticles) : (it.netWtArticles ? parseFloat(it.netWtArticles) : 0),
            mtrsPerArticles: it.mtrsPerArticles ? parseFloat(it.mtrsPerArticles) : 0,
            totalWt: it.totalWt ? parseFloat(it.totalWt) : 0,
            quantity: it.qty !== undefined ? parseFloat(it.qty) : (it.quantity ? parseFloat(it.quantity) : 0),
            unit: it.unit || 'NOS',
            ratePerUnit: it.ratePerUnit ? parseFloat(it.ratePerUnit) : 0,
            breakingLoad: it.breakingLoad || '',
            palletQuantity: it.palletQty || it.palletQuantity || '',
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

    if (existing.status === 'Completed' && data.assignedMachine !== undefined && !data.allowRestart) {
      const newMach = normalizeMachineCode(data.assignedMachine);
      const currMach = normalizeMachineCode((existing as any).assignedMachine || 'EXT-01');
      if (newMach !== currMach) {
        return res.status(400).json({
          error: `Production for order ${existing.orderNumber || existing.id} is already completed. Machine cannot be changed.`,
          isCompleted: true
        });
      }
    }

    // Replace items only if items array is explicitly provided in the request
    if (data.items && Array.isArray(data.items)) {
      await prisma.productionOrderItem.deleteMany({
        where: { productionOrderId: existing.id }
      });
    }

    const targetStatus = data.status || existing.status;
    const isDraft = targetStatus === 'Draft';
    const isCancelled = targetStatus === 'Cancelled';
    const isBecomingSubmitted = existing.status === 'Draft' && targetStatus !== 'Draft' && !isCancelled;

    let resolvedMachine: string | null = null;
    if (isDraft || isCancelled) {
      resolvedMachine = null;
    } else if (isBecomingSubmitted) {
      resolvedMachine = normalizeMachineCode(data.assignedMachine || (existing as any).assignedMachine) || 'EXT-01';
    } else if (data.assignedMachine !== undefined) {
      resolvedMachine = normalizeMachineCode(data.assignedMachine) || 'EXT-01';
    } else {
      resolvedMachine = (existing as any).assignedMachine ? (normalizeMachineCode((existing as any).assignedMachine) || 'EXT-01') : 'EXT-01';
    }

    const updatePayload: any = {
      customerStatus: data.customerStatus !== undefined ? data.customerStatus : existing.customerStatus,
      state: data.state !== undefined ? data.state : existing.state,
      city: data.city !== undefined ? data.city : existing.city,
      customerType: data.customerType !== undefined ? data.customerType : existing.customerType,
      apxDispatchDays: data.apxDispatchDays !== undefined ? data.apxDispatchDays : existing.apxDispatchDays,
      creditDays: data.creditDays !== undefined ? data.creditDays : existing.creditDays,
      piNo: data.piNo !== undefined ? data.piNo : existing.piNo,
      customerName: data.customerName || existing.customerName,
      clientId: data.clientId ? Number(data.clientId) : existing.clientId,
      billingAddress: data.billingAddress !== undefined 
        ? data.billingAddress 
        : (data.buyerBillingAddress !== undefined ? data.buyerBillingAddress : existing.billingAddress),
      email: data.email !== undefined ? data.email : existing.email,
      contactNo: data.contactNo !== undefined ? data.contactNo : existing.contactNo,
      contactPerson: data.contactPerson !== undefined ? data.contactPerson : existing.contactPerson,
      consigneeAddress: data.consigneeAddress !== undefined 
        ? data.consigneeAddress 
        : (data.consigneeDeliveryAddress !== undefined ? data.consigneeDeliveryAddress : existing.consigneeAddress),
      deliveryTerms: data.deliveryTerms !== undefined ? data.deliveryTerms : existing.deliveryTerms,
      poNumber: data.poNumber !== undefined ? data.poNumber : existing.poNumber,
      poDate: data.poDate ? new Date(data.poDate) : existing.poDate,
      customerGstin: data.customerGstin !== undefined ? data.customerGstin : existing.customerGstin,
      packingDetails: data.packingDetails !== undefined ? data.packingDetails : existing.packingDetails,
      stackingDetails: data.stackingDetails !== undefined ? data.stackingDetails : existing.stackingDetails,
      remarks: data.remarks !== undefined ? data.remarks : (data.remarksSpecialInstructions !== undefined ? data.remarksSpecialInstructions : existing.remarks),
      marketing: data.marketing !== undefined ? data.marketing : (data.marketingApproval !== undefined ? data.marketingApproval : existing.marketing),
      ndAmount: data.ndAmount !== undefined ? parseFloat(data.ndAmount) : existing.ndAmount,
      odAmount: data.odAmount !== undefined ? parseFloat(data.odAmount) : existing.odAmount,
      odDays: data.odDays !== undefined ? parseInt(data.odDays, 10) : existing.odDays,
      paymentStatus: data.paymentStatus !== undefined ? data.paymentStatus : existing.paymentStatus,
      production: data.production !== undefined ? data.production : (data.productionApproval !== undefined ? data.productionApproval : existing.production),
      logistic: data.logistic !== undefined ? data.logistic : (data.logisticApproval !== undefined ? data.logisticApproval : existing.logistic),
      account: data.account !== undefined ? data.account : (data.accountApproval !== undefined ? data.accountApproval : existing.account),
      managingDirector: data.managingDirector !== undefined ? data.managingDirector : (data.mdApproval !== undefined ? data.mdApproval : existing.managingDirector),
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
      status: targetStatus,
      assignedTo: data.assignedTo || existing.assignedTo,
      assignedMachine: resolvedMachine,
      tags: data.tags !== undefined ? data.tags : existing.tags,
      attachments: data.attachments || existing.attachments
    };

    if (data.items && Array.isArray(data.items)) {
      updatePayload.items = {
        create: data.items.map((it: any, index: number) => ({
          srNo: it.srNo || index + 1,
          sizeLength: it.strapSizeLength || it.sizeLength || '',
          colour: it.color || it.colour || 'Green',
          coreSize: it.coreSize || '',
          surface: it.surface || '',
          width: it.width !== undefined && it.width !== null && it.width !== '' ? parseFloat(it.width) : (it.rollWidth ? parseFloat(it.rollWidth) : null),
          thickness: it.thickness !== undefined && it.thickness !== null && it.thickness !== '' ? parseFloat(it.thickness) : null,
          grade: it.grade || '',
          jointStatus: it.jointStatus || it.rollJoint || 'No Joint',
          dieSelection: it.dieSelection || it.die || '',
          assignedMachine: isDraft ? null : (normalizeMachineCode(it.assignedMachine || resolvedMachine) || 'EXT-01'),
          priority: it.priority || 'Normal',
          status: isDraft ? 'Draft' : (it.status || 'Queued'),
          completionPercentage: it.completionPercentage !== undefined ? parseFloat(it.completionPercentage) : 0,
          sequenceOrder: it.sequenceOrder ? parseInt(it.sequenceOrder, 10) : index + 1,
          noOfArticles: it.noOfArticles ? parseInt(it.noOfArticles, 10) : 0,
          netWtArticles: it.netWtOfArticles !== undefined ? parseFloat(it.netWtOfArticles) : (it.netWtArticles ? parseFloat(it.netWtArticles) : 0),
          mtrsPerArticles: it.mtrsPerArticles ? parseFloat(it.mtrsPerArticles) : 0,
          totalWt: it.totalWt ? parseFloat(it.totalWt) : 0,
          quantity: it.qty !== undefined ? parseFloat(it.qty) : (it.quantity ? parseFloat(it.quantity) : 0),
          unit: it.unit || 'NOS',
          ratePerUnit: it.ratePerUnit ? parseFloat(it.ratePerUnit) : 0,
          breakingLoad: it.breakingLoad || '',
          palletQuantity: it.palletQty || it.palletQuantity || '',
          gstPercent: it.gstPercent !== undefined ? parseFloat(it.gstPercent) : 18.0,
          freightTerms: it.freightTerms || 'PAID',
          totalAmount: it.totalAmount ? parseFloat(it.totalAmount) : 0
        }))
      };
    }

    const updated = await prisma.productionOrder.update({
      where: { id: existing.id },
      data: updatePayload,
      include: {
        items: true,
        client: true
      }
    });

    // Synchronize item machines if machine/status was updated on the order without sending full items
    if (isBecomingSubmitted && (!data.items || !Array.isArray(data.items))) {
      await prisma.productionOrderItem.updateMany({
        where: { productionOrderId: existing.id },
        data: {
          assignedMachine: resolvedMachine || 'EXT-01',
          status: 'Queued'
        }
      }).catch(err => console.warn('Could not sync item machines on submit:', err.message));
    } else if (isDraft && (!data.items || !Array.isArray(data.items))) {
      await prisma.productionOrderItem.updateMany({
        where: { productionOrderId: existing.id },
        data: {
          assignedMachine: null,
          status: 'Draft'
        }
      }).catch(err => console.warn('Could not reset item machines to draft:', err.message));
    } else if (isCancelled && (!data.items || !Array.isArray(data.items))) {
      await prisma.productionOrderItem.updateMany({
        where: { productionOrderId: existing.id },
        data: {
          assignedMachine: null,
          status: 'Cancelled'
        }
      }).catch(err => console.warn('Could not reset item machines to cancelled:', err.message));
    } else if (data.assignedMachine !== undefined && (!data.items || !Array.isArray(data.items))) {
      await prisma.productionOrderItem.updateMany({
        where: { productionOrderId: existing.id },
        data: {
          assignedMachine: resolvedMachine
        }
      }).catch(err => console.warn('Could not sync item machines in PUT:', err.message));
    }

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

// PATCH Update single production order item planning (machine, status, priority, sequence)
router.patch('/items/:itemId', async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const { assignedMachine, status, priority, sequenceOrder, completionPercentage } = req.body;

    const dataToUpdate: any = {};
    if (assignedMachine !== undefined) dataToUpdate.assignedMachine = normalizeMachineCode(String(assignedMachine));
    if (status !== undefined) dataToUpdate.status = status;
    if (priority !== undefined) dataToUpdate.priority = priority;
    if (sequenceOrder !== undefined) dataToUpdate.sequenceOrder = Number(sequenceOrder);
    if (completionPercentage !== undefined) dataToUpdate.completionPercentage = Number(completionPercentage);

    // Try finding by productionOrderItem id
    const existingItem = await prisma.productionOrderItem.findUnique({
      where: { id: itemId }
    });

    let updatedItem: any = null;

    if (existingItem) {
      // Prevent restarting completed item production unless explicitly authorized via allowRestart
      if (existingItem.status === 'Completed' && status && status !== 'Completed' && !req.body.allowRestart) {
        return res.status(400).json({ 
          error: `Production for this item is already completed. Once complete, production cannot be restarted.`,
          isCompleted: true
        });
      }

      updatedItem = await prisma.productionOrderItem.update({
        where: { id: itemId },
        data: dataToUpdate
      });

      // Synchronize parent productionOrder status and machine
      if (existingItem.productionOrderId) {
        const orderItems = await prisma.productionOrderItem.findMany({
          where: { productionOrderId: existingItem.productionOrderId }
        });

        const allDone = orderItems.length > 0 && orderItems.every(i => i.status === 'Completed' || (i.completionPercentage || 0) >= 100);
        const anyRunning = orderItems.some(i => i.status === 'In Production' || ((i.completionPercentage || 0) > 0 && (i.completionPercentage || 0) < 100));
        const anyQueued = orderItems.some(i => i.status === 'Queued' || (!i.status && i.assignedMachine));

        let parentStatus: string = 'In Queue';
        if (allDone) parentStatus = 'Completed';
        else if (anyRunning) parentStatus = 'In Production';
        else if (anyQueued) parentStatus = 'In Queue';

        const parentUpdate: any = { status: parentStatus };
        if (assignedMachine) parentUpdate.assignedMachine = String(assignedMachine);

        await prisma.productionOrder.update({
          where: { id: existingItem.productionOrderId },
          data: parentUpdate
        }).catch(err => console.warn('Could not sync parent order status:', err.message));
      }
    } else {
      // Check if itemId is actually an order ID (e.g. "po-uuid" or "uuid")
      const rawOrderId = itemId.replace(/^po-/, '');
      const existingOrder = await prisma.productionOrder.findFirst({
        where: {
          OR: [{ id: rawOrderId }, { orderNumber: rawOrderId }, { id: itemId }]
        },
        include: { items: true }
      });

      if (existingOrder) {
        if (existingOrder.status === 'Draft' && assignedMachine !== undefined) {
          return res.status(400).json({
            error: `Order ${existingOrder.orderNumber || existingOrder.id} is in Draft. Submit the order before assigning a machine line.`,
            isDraft: true
          });
        }

        if (existingOrder.status === 'Completed' && !req.body.allowRestart) {
          if (status && status !== 'Completed') {
            return res.status(400).json({
              error: `Production for order ${existingOrder.orderNumber || existingOrder.id} is already completed and cannot be restarted.`,
              isCompleted: true
            });
          }
          if (assignedMachine !== undefined && normalizeMachineCode(String(assignedMachine)) !== normalizeMachineCode((existingOrder as any).assignedMachine || 'EXT-01')) {
            return res.status(400).json({
              error: `Production for order ${existingOrder.orderNumber || existingOrder.id} is already completed. Machine cannot be changed.`,
              isCompleted: true
            });
          }
        }

        const orderUpdate: any = {};
        if (assignedMachine !== undefined) orderUpdate.assignedMachine = normalizeMachineCode(String(assignedMachine));
        if (status !== undefined) orderUpdate.status = status;

        await prisma.productionOrder.update({
          where: { id: existingOrder.id },
          data: orderUpdate
        });

        // Also update its items if any
        if (existingOrder.items && existingOrder.items.length > 0) {
          await prisma.productionOrderItem.updateMany({
            where: { productionOrderId: existingOrder.id },
            data: dataToUpdate
          });
        }
        updatedItem = { id: itemId, ...dataToUpdate };
      } else {
        return res.status(404).json({ error: `Item or order not found for ID ${itemId}` });
      }
    }

    res.json({ success: true, item: updatedItem });
  } catch (error: any) {
    console.error('Error updating production order item planning:', error);
    res.status(500).json({ error: error.message || 'Failed to update item' });
  }
});

// POST Transfer Finished Production Item to Stock (Bin Report & Stock Ledger)
router.post('/items/:itemId/post-to-stock', async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const { 
      actualQty, 
      actualWeightKg, 
      targetBin = 'D-31', 
      notes, 
      forceReprompt = false 
    } = req.body;

    // 1. Locate Item
    let item = await prisma.productionOrderItem.findUnique({
      where: { id: itemId },
      include: {
        productionOrder: {
          include: { items: true, client: true }
        }
      }
    });

    if (!item) {
      // Check if itemId is formatted like po-orderId-srNo
      const parts = itemId.split('-');
      if (itemId.startsWith('po-') && parts.length >= 3) {
        const srNo = parseInt(parts[parts.length - 1], 10);
        const orderId = parts.slice(1, parts.length - 1).join('-');
        item = await prisma.productionOrderItem.findFirst({
          where: {
            productionOrderId: orderId,
            srNo: !isNaN(srNo) ? srNo : undefined
          },
          include: {
            productionOrder: {
              include: { items: true, client: true }
            }
          }
        });
      }
    }

    if (!item) {
      return res.status(404).json({ error: `Production item not found for ID ${itemId}` });
    }

    if (item.isStockPosted && !forceReprompt) {
      return res.status(400).json({ 
        error: `Stock has already been posted for this item on ${item.stockPostedAt?.toLocaleString() || 'earlier date'}.`,
        alreadyPosted: true,
        item
      });
    }

    const qtyToPost = Math.round(Number(actualQty) || Number(item.quantity) || Number(item.noOfArticles) || 1);
    if (qtyToPost <= 0) {
      return res.status(400).json({ error: 'Quantity to post must be greater than zero.' });
    }

    // 2. Resolve Product in Product table
    let product: any = null;
    const descText = `${item.sizeLength || ''} ${item.dieSelection || ''}`;
    const skuMatch = descText.match(/\[([A-Za-z0-9_-]+)\]/);
    const candidateSku = skuMatch ? skuMatch[1].trim() : null;

    if (candidateSku) {
      product = await prisma.product.findFirst({
        where: {
          OR: [
            { sku: { equals: candidateSku, mode: 'insensitive' } },
            { sku: { equals: candidateSku.replace(/O/g, '0'), mode: 'insensitive' } },
            { sku: { equals: candidateSku.replace(/0/g, 'O'), mode: 'insensitive' } }
          ]
        }
      });
    }

    // Match by exact or partial name
    if (!product && item.sizeLength) {
      const cleanName = item.sizeLength.replace(/\[.*?\]\s*\|\s*/, '').trim();
      product = await prisma.product.findFirst({
        where: {
          OR: [
            { name: { equals: cleanName, mode: 'insensitive' } },
            { name: { contains: cleanName, mode: 'insensitive' } },
            { sku: { equals: cleanName, mode: 'insensitive' } }
          ]
        }
      });
    }

    // Match by dimensions
    if (!product && (item.width || item.thickness)) {
      product = await prisma.product.findFirst({
        where: {
          partOf: 'FINISHED GOODS',
          ...(item.width ? { rollWidth: item.width } : {}),
          ...(item.thickness ? { thickness: item.thickness } : {})
        }
      });
    }

    // Auto-create Product if not yet in Product Master
    if (!product) {
      const autoSku = candidateSku || `PSR${String(Math.floor(1000 + Math.random() * 9000))}`;
      const petCategory = await prisma.category.findFirst({
        where: { name: { contains: 'STRAP', mode: 'insensitive' } }
      });
      const pcsUnit = await prisma.unit.findFirst({
        where: { name: { in: ['Roll', 'Rolls', 'Nos', 'NOS', 'Pcs'] } }
      });

      product = await prisma.product.create({
        data: {
          sku: autoSku,
          name: item.sizeLength ? item.sizeLength.replace(/\[.*?\]\s*\|\s*/, '').trim() : `${item.width || 15} X ${item.thickness || 0.5} PET Strap Roll`,
          partOf: 'FINISHED GOODS',
          subPartOf: 'WORKSHOP',
          quantity: 0,
          cost_price: 120,
          selling_price: 150,
          min_stock: 20,
          location: targetBin || 'D-31',
          categoryId: petCategory?.id || null,
          unitId: pcsUnit?.id || null,
          activityType: 'Manufacturing',
          maintainStock: true,
          status: 'Active',
          rollWidth: item.width || 15,
          thickness: item.thickness || 0.5,
          rollSurface: item.surface || 'Roll Emboss',
          color: item.colour || 'Green',
          rollWeight: item.netWtArticles || 10
        }
      });
    }

    // 3. Post to StockLedger & update Product Quantity within transaction
    const finalLocation = targetBin || product.location || 'D-31';
    const poRef = item.productionOrder?.orderNumber || item.productionOrder?.id || `PO-${item.id.slice(0, 8)}`;
    const customer = item.productionOrder?.customerName || item.productionOrder?.client?.companyName || 'Customer';

    const result = await prisma.$transaction(async (tx) => {
      // Calculate current running balance
      const balanceAgg: any = await tx.$queryRaw`
        SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
        FROM "StockLedger"
        WHERE "productId" = ${product.id}
      `;
      const balanceBefore = balanceAgg[0]?.balance_before
        ? Number(balanceAgg[0].balance_before)
        : Number(product.quantity || 0);

      const newRunningBalance = balanceBefore + qtyToPost;

      // Create StockLedger entry
      const stockEntry = await tx.stockLedger.create({
        data: {
          productId: product.id,
          date: new Date(),
          type: 'MANUFACTURE',
          quantityChange: qtyToPost,
          runningBalance: newRunningBalance,
          productionOrderId: item.productionOrderId,
          reference: poRef,
          notes: notes || `Production completed on ${item.assignedMachine || 'Machine 1'} for ${customer}`
        }
      });

      // Update Product Stock & Location
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: {
          quantity: { increment: qtyToPost },
          location: finalLocation
        }
      });

      // Update ProductionOrderItem
      const updatedItem = await tx.productionOrderItem.update({
        where: { id: item.id },
        data: {
          status: 'Completed',
          completionPercentage: 100,
          isStockPosted: true,
          stockPostedAt: new Date(),
          stockEntryId: stockEntry.id,
          actualProducedQty: qtyToPost,
          destinationBin: finalLocation
        }
      });

      // Check if all items in the order are completed
      if (item.productionOrder?.items) {
        const otherItems = item.productionOrder.items.filter(it => it.id !== item.id);
        const allCompleted = otherItems.every(it => it.status === 'Completed');
        if (allCompleted) {
          await tx.productionOrder.update({
            where: { id: item.productionOrderId },
            data: { status: 'Completed' }
          });
        }
      }

      return { stockEntry, updatedProduct, updatedItem };
    });

    // Record activity log
    try {
      await prisma.activityLog.create({
        data: {
          entityType: 'ProductionOrderItem',
          entityId: item.id,
          action: 'Transferred finished goods to stock',
          description: `Transferred ${qtyToPost} units of ${product.sku} to Bin ${finalLocation} (Stock Ledger ID: ${result.stockEntry.id})`
        }
      });
    } catch (e) {
      console.warn('Could not record activity log:', e);
    }

    res.json({
      success: true,
      message: `Successfully transferred ${qtyToPost} units to Bin ${finalLocation} and recorded in Stock Ledger!`,
      item: result.updatedItem,
      product: result.updatedProduct,
      stockEntry: result.stockEntry
    });
  } catch (error: any) {
    console.error('Error posting production item to stock:', error);
    res.status(500).json({ error: error.message || 'Failed to post production item to stock' });
  }
});

// POST Revert Finished Production Item Stock Transfer
router.post('/items/:itemId/revert-stock', async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const item = await prisma.productionOrderItem.findUnique({
      where: { id: itemId },
      include: { productionOrder: true }
    });

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (!item.isStockPosted) {
      return res.json({ success: true, message: 'Item had no posted stock' });
    }

    const qtyToRevert = Math.round(Number(item.actualProducedQty) || Number(item.quantity) || 1);

    let ledgerEntry = item.stockEntryId ? await prisma.stockLedger.findUnique({ where: { id: item.stockEntryId } }) : null;
    let productId = ledgerEntry?.productId;

    if (!productId) {
      const latest = await prisma.stockLedger.findFirst({
        where: {
          productionOrderId: item.productionOrderId,
          type: 'MANUFACTURE'
        },
        orderBy: { createdAt: 'desc' }
      });
      productId = latest?.productId;
    }

    if (productId) {
      await prisma.$transaction(async (tx) => {
        const balanceAgg: any = await tx.$queryRaw`
          SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
          FROM "StockLedger"
          WHERE "productId" = ${productId}
        `;
        const balanceBefore = balanceAgg[0]?.balance_before ? Number(balanceAgg[0].balance_before) : 0;
        const newRunningBalance = Math.max(0, balanceBefore - qtyToRevert);

        await tx.stockLedger.create({
          data: {
            productId,
            date: new Date(),
            type: 'ADJUSTMENT',
            quantityChange: -qtyToRevert,
            runningBalance: newRunningBalance,
            productionOrderId: item.productionOrderId,
            reference: `REV-${item.productionOrder?.orderNumber || item.productionOrderId}`,
            notes: `Reversal of production stock transfer for item reopened into In Production`
          }
        });

        await tx.product.update({
          where: { id: productId },
          data: {
            quantity: { decrement: qtyToRevert }
          }
        });
      });
    }

    const updated = await prisma.productionOrderItem.update({
      where: { id: itemId },
      data: {
        isStockPosted: false,
        stockPostedAt: null,
        stockEntryId: null,
        status: 'In Production',
        completionPercentage: 80
      }
    });

    if (item.productionOrderId) {
      await prisma.productionOrder.update({
        where: { id: item.productionOrderId },
        data: { status: 'In Production' }
      }).catch(err => console.warn('Could not sync parent order status on stock revert:', err.message));
    }

    res.json({ success: true, message: 'Stock reversed and item reopened', item: updated });
  } catch (error: any) {
    console.error('Error reverting stock:', error);
    res.status(500).json({ error: error.message || 'Failed to revert stock' });
  }
});

// POST Confirm Truck Loading & Dispatch (Subtract Stock from Bin & record in Stock Ledger)
router.post('/:id/dispatch-truck', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      vehicleNo,
      containerNo,
      sealNo,
      destinationPort,
      transporterName,
      driverName,
      mobileNo,
      lrNo,
      orderType = 'Domestic',
      palletPhotos = [],
      containerDoorPhotoUrl,
      dispatchNotes
    } = req.body;

    if (!vehicleNo) {
      return res.status(400).json({ error: 'Vehicle / Truck number is required for dispatch.' });
    }

    // Locate order
    const order = await prisma.productionOrder.findUnique({
      where: { id },
      include: {
        items: true,
        client: true
      }
    });

    if (!order) {
      return res.status(404).json({ error: `Production Order not found for ID ${id}` });
    }

    if (order.status === 'Dispatched') {
      return res.status(400).json({ error: 'This order has already been dispatched and stock has already been subtracted.' });
    }

    // Execute transaction to subtract stock for all items in the order
    const updatedOrder = await prisma.$transaction(async (tx) => {
      const items = order.items || [];
      const poRef = order.orderNumber || order.id;

      for (const item of items) {
        const qtyToSubtract = Math.round(Number(item.actualProducedQty) || Number(item.quantity) || Number(item.noOfArticles) || 1);
        if (qtyToSubtract <= 0) continue;

        // Find linked product
        let product: any = null;
        const descText = `${item.sizeLength || ''} ${item.dieSelection || ''}`;
        const skuMatch = descText.match(/\[([A-Za-z0-9_-]+)\]/);
        const candidateSku = skuMatch ? skuMatch[1].trim() : null;

        if (candidateSku) {
          product = await tx.product.findFirst({
            where: {
              OR: [
                { sku: { equals: candidateSku, mode: 'insensitive' } },
                { sku: { equals: candidateSku.replace(/O/g, '0'), mode: 'insensitive' } },
                { sku: { equals: candidateSku.replace(/0/g, 'O'), mode: 'insensitive' } }
              ]
            }
          });
        }

        if (!product && item.sizeLength) {
          const cleanName = item.sizeLength.replace(/\[.*?\]\s*\|\s*/, '').trim();
          product = await tx.product.findFirst({
            where: {
              OR: [
                { name: { equals: cleanName, mode: 'insensitive' } },
                { name: { contains: cleanName, mode: 'insensitive' } },
                { sku: { equals: cleanName, mode: 'insensitive' } }
              ]
            }
          });
        }

        if (!product && (item.width || item.thickness)) {
          product = await tx.product.findFirst({
            where: {
              partOf: 'FINISHED GOODS',
              ...(item.width ? { rollWidth: item.width } : {}),
              ...(item.thickness ? { thickness: item.thickness } : {})
            }
          });
        }

        if (product) {
          // Calculate current balance
          const balanceAgg: any = await tx.$queryRaw`
            SELECT COALESCE(SUM("quantityChange"), 0) AS balance_before
            FROM "StockLedger"
            WHERE "productId" = ${product.id}
          `;
          const balanceBefore = balanceAgg[0]?.balance_before
            ? Number(balanceAgg[0].balance_before)
            : Number(product.quantity || 0);

          const newRunningBalance = balanceBefore - qtyToSubtract;

          // Record debit entry in StockLedger
          await tx.stockLedger.create({
            data: {
              productId: product.id,
              date: new Date(),
              type: orderType === 'International (Export)' ? 'EXPORT_DISPATCH' : 'DISPATCH',
              quantityChange: -qtyToSubtract,
              runningBalance: newRunningBalance,
              productionOrderId: order.id,
              reference: `${poRef}${containerNo ? ` / Cont: ${containerNo}` : ''} / Trk: ${vehicleNo}`,
              notes: dispatchNotes || `Dispatched on Truck ${vehicleNo}${containerNo ? ` (Container: ${containerNo}, Seal: ${sealNo || '-'})` : ''} to ${destinationPort || order.customerName} (${palletPhotos.length} pallets loaded)`
            }
          });

          // Decrement product stock in Bin Inventory
          await tx.product.update({
            where: { id: product.id },
            data: {
              quantity: { decrement: qtyToSubtract }
            }
          });
        }
      }

      // Merge attachments with dispatch details
      const existingAttachments = typeof order.attachments === 'object' && order.attachments !== null
        ? order.attachments
        : {};

      const dispatchReport = {
        orderType,
        dispatchedAt: new Date().toISOString(),
        vehicleNo,
        containerNo: containerNo || null,
        sealNo: sealNo || null,
        destinationPort: destinationPort || null,
        transporterName: transporterName || null,
        driverName: driverName || null,
        mobileNo: mobileNo || null,
        lrNo: lrNo || null,
        totalPallets: palletPhotos.length,
        palletPhotos: palletPhotos,
        containerDoorPhotoUrl: containerDoorPhotoUrl || null,
        notes: dispatchNotes || null
      };

      const finalAttachments = {
        ...existingAttachments,
        dispatchReport
      };

      // Update ProductionOrder
      return await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: 'Dispatched',
          vehicleNo,
          transporterName: transporterName || order.transporterName,
          driverName: driverName || order.driverName,
          mobileNo: mobileNo || order.mobileNo,
          lrNo: lrNo || order.lrNo,
          dispatchDate: new Date(),
          attachments: finalAttachments
        },
        include: {
          items: true,
          client: true
        }
      });
    });

    // Record Activity Log
    try {
      await prisma.activityLog.create({
        data: {
          entityType: 'ProductionOrder',
          entityId: order.id,
          action: 'Truck Loading & Dispatch Confirmed',
          description: `Dispatched order ${order.orderNumber} on Truck ${vehicleNo} (${palletPhotos.length} pallets, ${orderType}). Finished goods stock subtracted.`
        }
      });
    } catch (e) {
      console.warn('Could not record activity log on dispatch:', e);
    }

    res.json({
      success: true,
      message: `Truck dispatch confirmed! Inventory subtracted from Bin Report & recorded in Stock Ledger.`,
      order: updatedOrder
    });
  } catch (error: any) {
    console.error('Error confirming truck dispatch:', error);
    res.status(500).json({ error: error.message || 'Failed to dispatch truck' });
  }
});

export default router;
