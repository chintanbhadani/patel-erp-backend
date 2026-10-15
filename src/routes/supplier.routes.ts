import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';
import multer from 'multer';
import * as xlsx from 'xlsx';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

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
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
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
        assignedTo: data.assignedTo || 'Administrator',
        tags: data.tags || null,
        imageUrl: data.imageUrl || null,
        attachments: data.attachments || [],
        kycDocs: data.kycDocs || data.kycDocuments || []
      }
    });

    await logActivity({
      entityType: 'Supplier',
      entityId: String(supplier.id),
      action: 'CREATE',
      description: `Created supplier ${supplier.name}`,
      userId: (req as any).user?.id
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
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
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
        kycDocs: data.kycDocs !== undefined ? data.kycDocs : (data.kycDocuments !== undefined ? data.kycDocuments : undefined)
      }
    });

    await logActivity({
      entityType: 'Supplier',
      entityId: String(supplier.id),
      action: 'UPDATE',
      description: `Updated supplier ${supplier.name}`,
      userId: (req as any).user?.id
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
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    await prisma.supplier.delete({
      where: { id }
    });

    await logActivity({
      entityType: 'Supplier',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted supplier`,
      userId: (req as any).user?.id
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete supplier' });
  }
});

// Helper to parse boolean
const parseBool = (val: any, def = false): boolean => {
  if (val === undefined || val === null || val === '') return def;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
};

// Helper to parse number
const parseNum = (val: any, def = 0): number => {
  if (val === undefined || val === null || val === '') return def;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? def : n;
};

// Bulk Process Suppliers Helper
export async function processBulkSuppliers(rows: any[], userId?: string): Promise<{
  successCount: number;
  createdCount: number;
  updatedCount: number;
  errors: string[];
}> {
  let successCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  // Verify that userId exists in User table
  let resolvedUserId: string | null = null;
  if (userId) {
    try {
      const userExists = await prisma.user.findUnique({ where: { id: userId } });
      if (userExists) {
        resolvedUserId = userExists.id;
      }
    } catch {
      resolvedUserId = null;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const name = String(
        row.name ||
        row['Supplier Name'] ||
        row.supplierName ||
        row['Company Name'] ||
        row.companyName ||
        row.supplier ||
        ''
      ).trim();

      if (!name) {
        errors.push(`Row ${rowNum}: Supplier Name is required`);
        continue;
      }

      const contact = row.contact || row['Phone / Contact'] || row.phone || row.Mobile 
        ? String(row.contact || row['Phone / Contact'] || row.phone || row.Mobile).trim() 
        : null;
      const email = row.email || row.Email || row['Email Address'] 
        ? String(row.email || row.Email || row['Email Address']).trim() 
        : null;
      const supplierGroup = row.supplierGroup || row['Supplier Group'] || 'All Supplier Groups';
      const country = row.country || row.Country || 'India';
      const supplierType = row.supplierType || row['Supplier Type'] || 'Company';
      const isTransporter = parseBool(row.isTransporter || row['Is Transporter'], false);
      const contactPersonName = row.contactPersonName || row['Contact Person'] || null;
      const billingCurrency = row.billingCurrency || row['Billing Currency'] || 'INR';
      const priceList = row.priceList || row['Price List'] || 'Standard Buying';
      const bankAccount = row.bankAccount || row['Bank Account'] || null;
      const trackExchangeDifferences = parseBool(row.trackExchangeDifferences, true);
      const taxId = row.taxId || row['Tax ID / GSTIN'] || row['Tax ID'] || row.GSTIN || row.GST 
        ? String(row.taxId || row['Tax ID / GSTIN'] || row['Tax ID'] || row.GSTIN || row.GST).trim() 
        : null;
      const vrnNo = row.vrnNo || row['VRN / PAN'] || row.PAN || row.VRN 
        ? String(row.vrnNo || row['VRN / PAN'] || row.PAN || row.VRN).trim() 
        : null;
      const address = row.address || row.Address || row.Street 
        ? String(row.address || row.Address || row.Street).trim() 
        : null;
      const city = row.city || row.City 
        ? String(row.city || row.City).trim() 
        : null;
      const state = row.state || row.State 
        ? String(row.state || row.State).trim() 
        : null;
      const postalCode = row.postalCode || row['Postal Code'] || row['Pin Code'] || row.pincode 
        ? String(row.postalCode || row['Postal Code'] || row['Pin Code'] || row.pincode).trim() 
        : null;
      const website = row.website || row.Website || null;
      const payableAccount = row.payableAccount || row['Default Payable Account'] || 'Creditors - PS';
      const paymentTerms = row.paymentTerms || row['Payment Terms'] || 'Net 30';
      const creditLimit = parseNum(row.creditLimit || row['Credit Limit'], 0);
      const disabled = parseBool(row.disabled || row.Disabled, false);
      const assignedTo = row.assignedTo || row['Assigned To'] || 'Administrator';
      const tags = row.tags || row.Tags || null;

      // Check if supplier already exists (match by taxId if present, or by name)
      let existingSupplier = null;
      if (taxId) {
        existingSupplier = await prisma.supplier.findFirst({
          where: { taxId: { equals: taxId, mode: 'insensitive' } }
        });
      }
      if (!existingSupplier) {
        existingSupplier = await prisma.supplier.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } }
        });
      }

      if (existingSupplier) {
        await prisma.supplier.update({
          where: { id: existingSupplier.id },
          data: {
            name,
            contact: contact || existingSupplier.contact,
            email: email || existingSupplier.email,
            supplierGroup: supplierGroup || existingSupplier.supplierGroup,
            country: country || existingSupplier.country,
            supplierType: supplierType || existingSupplier.supplierType,
            isTransporter,
            contactPersonName: contactPersonName || existingSupplier.contactPersonName,
            billingCurrency: billingCurrency || existingSupplier.billingCurrency,
            priceList: priceList || existingSupplier.priceList,
            bankAccount: bankAccount || existingSupplier.bankAccount,
            trackExchangeDifferences,
            taxId: taxId || existingSupplier.taxId,
            vrnNo: vrnNo || existingSupplier.vrnNo,
            address: address || existingSupplier.address,
            city: city || existingSupplier.city,
            state: state || existingSupplier.state,
            postalCode: postalCode || existingSupplier.postalCode,
            website: website || existingSupplier.website,
            payableAccount: payableAccount || existingSupplier.payableAccount,
            paymentTerms: paymentTerms || existingSupplier.paymentTerms,
            creditLimit: creditLimit !== 0 ? creditLimit : existingSupplier.creditLimit,
            disabled,
            assignedTo: assignedTo || existingSupplier.assignedTo,
            tags: tags || existingSupplier.tags
          }
        });
        updatedCount++;
      } else {
        await prisma.supplier.create({
          data: {
            name,
            contact,
            email,
            supplierGroup,
            country,
            supplierType,
            isTransporter,
            contactPersonName,
            billingCurrency,
            priceList,
            bankAccount,
            trackExchangeDifferences,
            taxId,
            vrnNo,
            address,
            city,
            state,
            postalCode,
            website,
            payableAccount,
            paymentTerms,
            creditLimit,
            disabled,
            assignedTo,
            tags
          }
        });
        createdCount++;
      }

      successCount++;
    } catch (err: any) {
      errors.push(`Row ${rowNum}: ${err.message || 'Failed to process row'}`);
    }
  }

  if (successCount > 0) {
    try {
      await logActivity({
        entityType: 'Supplier',
        entityId: 'BULK',
        action: 'BULK_IMPORT',
        description: `Bulk imported ${successCount} suppliers (${createdCount} created, ${updatedCount} updated)`,
        userId: resolvedUserId || undefined
      });
    } catch (logErr) {
      console.warn('Failed to log bulk supplier import activity', logErr);
    }
  }

  return { successCount, createdCount, updatedCount, errors };
}

// POST bulk import (JSON array)
router.post('/bulk-import', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const items = req.body.items || req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No supplier records provided for import' });
    }

    const currentUserId = (req as any).user?.id;
    const result = await processBulkSuppliers(items, currentUserId);

    res.json({
      message: `Successfully processed ${result.successCount} suppliers (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk import suppliers error:', error);
    res.status(500).json({ error: 'Failed to process bulk import', message: error?.message });
  }
});

// POST bulk upload (multipart Excel file)
router.post('/bulk-upload', authorizeRole('PLANT_ADMIN'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any>(sheet);

    const currentUserId = (req as any).user?.id;
    const result = await processBulkSuppliers(rows, currentUserId);

    res.json({
      message: `Successfully processed ${result.successCount} suppliers (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk upload suppliers error:', error);
    res.status(500).json({ error: 'Failed to process bulk upload', message: error?.message });
  }
});

export default router;
