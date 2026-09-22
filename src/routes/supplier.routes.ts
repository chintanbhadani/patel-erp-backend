import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// GET all suppliers
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { contact: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { supplierGroup: { contains: q, mode: 'insensitive' } },
        { country: { contains: q, mode: 'insensitive' } }
      ];
    }
    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

// GET supplier by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supplier = await prisma.supplier.findUnique({
      where: { id }
    });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    res.json(supplier);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch supplier details' });
  }
});

// POST new supplier
router.post('/', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.name) return res.status(400).json({ error: 'Supplier Name is required' });

    const supplier = await prisma.supplier.create({
      data: {
        name: data.name.trim(),
        contact: data.contact || null,
        email: data.email || null,
        supplierGroup: data.supplierGroup || 'All Supplier Groups',
        country: data.country || 'India',
        supplierType: data.supplierType || 'Company',
        isTransporter: Boolean(data.isTransporter),
        contactPersonName: data.contactPersonName || null,
        billingCurrency: data.billingCurrency || 'INR',
        priceList: data.priceList || 'Standard Buying',
        bankAccount: data.bankAccount || null,
        trackExchangeDifferences: data.trackExchangeDifferences !== undefined ? Boolean(data.trackExchangeDifferences) : true,
        taxId: data.taxId || null,
        vrnNo: data.vrnNo || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        postalCode: data.postalCode || null,
        website: data.website || null,
        payableAccount: data.payableAccount || 'Creditors - PS',
        paymentTerms: data.paymentTerms || null,
        creditLimit: data.creditLimit !== undefined ? parseFloat(data.creditLimit) : 0,
        disabled: Boolean(data.disabled),
        assignedTo: data.assignedTo || 'Julius Daffa',
        tags: data.tags || null,
        imageUrl: data.imageUrl || null,
        attachments: data.attachments || [],
        kycDocs: data.kycDocs || []
      }
    });
    res.status(201).json({ message: 'Supplier created successfully', ...supplier });
  } catch (error: any) {
    console.error('Failed to create supplier:', error);
    res.status(500).json({ error: 'Failed to create supplier', message: 'Failed to create supplier' });
  }
});

// PUT update supplier
router.put('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    if (!data.name) return res.status(400).json({ error: 'Supplier Name is required' });

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: data.name.trim(),
        contact: data.contact !== undefined ? data.contact : undefined,
        email: data.email !== undefined ? data.email : undefined,
        supplierGroup: data.supplierGroup,
        country: data.country,
        supplierType: data.supplierType,
        isTransporter: data.isTransporter !== undefined ? Boolean(data.isTransporter) : undefined,
        contactPersonName: data.contactPersonName,
        billingCurrency: data.billingCurrency,
        priceList: data.priceList,
        bankAccount: data.bankAccount,
        trackExchangeDifferences: data.trackExchangeDifferences !== undefined ? Boolean(data.trackExchangeDifferences) : undefined,
        taxId: data.taxId,
        vrnNo: data.vrnNo,
        address: data.address,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        website: data.website,
        payableAccount: data.payableAccount,
        paymentTerms: data.paymentTerms,
        creditLimit: data.creditLimit !== undefined ? parseFloat(data.creditLimit) : undefined,
        disabled: data.disabled !== undefined ? Boolean(data.disabled) : undefined,
        assignedTo: data.assignedTo,
        tags: data.tags,
        imageUrl: data.imageUrl !== undefined ? data.imageUrl : undefined,
        attachments: data.attachments !== undefined ? data.attachments : undefined,
        kycDocs: data.kycDocs !== undefined ? data.kycDocs : undefined
      }
    });
    res.status(200).json({ message: 'Supplier updated successfully', ...supplier });
  } catch (error: any) {
    console.error('Failed to update supplier:', error);
    res.status(500).json({ error: 'Failed to update supplier', message: 'Failed to update supplier' });
  }
});

// DELETE supplier
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.supplier.delete({
      where: { id }
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete supplier' });
  }
});

export default router;
