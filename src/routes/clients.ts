import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';
import multer from 'multer';
import * as xlsx from 'xlsx';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// Get all clients
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const { search } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { companyName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } }
      ];
    }
    const clients = await prisma.client.findMany({
      where,
      include: {
        assignedRep: { select: { id: true, username: true, role: true } },
        inquiries: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// GET client by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        assignedRep: { select: { id: true, username: true, role: true } },
        inquiries: true
      }
    });
    if (!client) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(client);
  } catch (error) {
    console.error('Error fetching client by ID:', error);
    res.status(500).json({ error: 'Failed to fetch customer details' });
  }
});

// Check client conflict before creating an inquiry
router.post('/check-conflict', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const { email, phone, gstNumber } = req.body;
    const currentUserId = (req as any).user.id;

    if (!email && !phone && !gstNumber) {
      return res.status(400).json({ error: 'Must provide email, phone, or GST number to check' });
    }

    const conditions: any[] = [];
    if (email) conditions.push({ email });
    if (phone) conditions.push({ phone });
    if (gstNumber) conditions.push({ gstNumber });

    const existingClient = await prisma.client.findFirst({
      where: {
        OR: conditions
      },
      include: {
        assignedRep: { select: { username: true, id: true } }
      }
    });

    if (existingClient && existingClient.assignedRepId !== currentUserId) {
      // It's assigned to someone else
      return res.json({
        conflict: true,
        message: `Warning: This client is already communicating with ${existingClient.assignedRep?.username || 'another representative'}.`,
        client: existingClient
      });
    }

    res.json({ conflict: false });
  } catch (error) {
    console.error('Error checking client conflict:', error);
    res.status(500).json({ error: 'Failed to check conflict' });
  }
});

// Create a new client
router.post('/', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const data = req.body;
    const name = data.companyName || data.customerName || data.name;
    if (!name) return res.status(400).json({ error: 'Customer Name is required' });

    const currentUserId = (req as any).user?.id;
    let resolvedRepId: string | null = null;
    if (currentUserId) {
      const userExists = await prisma.user.findUnique({ where: { id: currentUserId } });
      resolvedRepId = userExists ? currentUserId : null;
    }

    const client = await prisma.client.create({
      data: {
        companyName: name.trim(),
        customerType: data.customerType || 'Company',
        customerGroup: data.customerGroup || 'Commercial',
        territory: data.territory || 'India',
        fromLead: data.fromLead || null,
        fromOpportunity: data.fromOpportunity || null,
        fromProspect: data.fromProspect || null,
        accountManager: data.accountManager || null,
        isAuthOtpApplied: Boolean(data.isAuthOtpApplied),
        defaultPriceList: data.defaultPriceList || 'Standard Selling',
        billingCurrency: data.billingCurrency || 'INR',
        defaultCompanyBankAccount: data.defaultCompanyBankAccount || null,
        email: data.email || null,
        phone: data.phone || data.contact || null,
        contactPersonName: data.contactPersonName || null,
        taxId: data.taxId || null,
        gstNumber: data.gstNumber || null,
        vrnNo: data.vrnNo || null,
        taxCategory: data.taxCategory || 'Standard Rate',
        receivableAccount: data.receivableAccount || 'Debtors - PS',
        paymentTerms: data.paymentTerms || 'Net 30',
        creditLimit: data.creditLimit !== undefined ? parseFloat(data.creditLimit) : 0,
        disabled: Boolean(data.disabled),
        assignedTo: data.assignedTo || null,
        tags: data.tags || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        postalCode: data.postalCode || null,
        country: data.country || 'India',
        imageUrl: data.imageUrl || null,
        attachments: data.attachments || [],
        addresses: data.addresses || [],
        assignedRepId: resolvedRepId
      }
    });

    await logActivity({
      entityType: 'Customer',
      entityId: String(client.id),
      action: 'CREATE',
      description: `Created customer ${client.companyName}`,
      userId: (req as any).user?.id
    });

    res.status(201).json(client);
  } catch (error: any) {
    console.error('Error creating client:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A client with this GST Number or Tax ID already exists' });
    }
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Update a client
router.put('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const data = req.body;
    const name = data.companyName || data.customerName || data.name;

    const oldClient = await prisma.client.findUnique({ where: { id } });

    const client = await prisma.client.update({
      where: { id },
      data: {
        companyName: name ? name.trim() : undefined,
        customerType: data.customerType !== undefined ? data.customerType : undefined,
        customerGroup: data.customerGroup !== undefined ? data.customerGroup : undefined,
        territory: data.territory !== undefined ? data.territory : undefined,
        fromLead: data.fromLead !== undefined ? data.fromLead : undefined,
        fromOpportunity: data.fromOpportunity !== undefined ? data.fromOpportunity : undefined,
        fromProspect: data.fromProspect !== undefined ? data.fromProspect : undefined,
        accountManager: data.accountManager !== undefined ? data.accountManager : undefined,
        isAuthOtpApplied: data.isAuthOtpApplied !== undefined ? Boolean(data.isAuthOtpApplied) : undefined,
        defaultPriceList: data.defaultPriceList !== undefined ? data.defaultPriceList : undefined,
        billingCurrency: data.billingCurrency !== undefined ? data.billingCurrency : undefined,
        defaultCompanyBankAccount: data.defaultCompanyBankAccount !== undefined ? data.defaultCompanyBankAccount : undefined,
        email: data.email !== undefined ? data.email : undefined,
        phone: (data.phone || data.contact) !== undefined ? (data.phone || data.contact) : undefined,
        contactPersonName: data.contactPersonName !== undefined ? data.contactPersonName : undefined,
        taxId: data.taxId !== undefined ? data.taxId : undefined,
        gstNumber: data.gstNumber !== undefined ? data.gstNumber : undefined,
        vrnNo: data.vrnNo !== undefined ? data.vrnNo : undefined,
        taxCategory: data.taxCategory !== undefined ? data.taxCategory : undefined,
        receivableAccount: data.receivableAccount !== undefined ? data.receivableAccount : undefined,
        paymentTerms: data.paymentTerms !== undefined ? data.paymentTerms : undefined,
        creditLimit: data.creditLimit !== undefined ? parseFloat(data.creditLimit) : undefined,
        disabled: data.disabled !== undefined ? Boolean(data.disabled) : undefined,
        assignedTo: data.assignedTo !== undefined ? data.assignedTo : undefined,
        tags: data.tags !== undefined ? data.tags : undefined,
        address: data.address !== undefined ? data.address : undefined,
        city: data.city !== undefined ? data.city : undefined,
        state: data.state !== undefined ? data.state : undefined,
        postalCode: data.postalCode !== undefined ? data.postalCode : undefined,
        country: data.country !== undefined ? data.country : undefined,
        imageUrl: data.imageUrl !== undefined ? data.imageUrl : undefined,
        attachments: data.attachments !== undefined ? data.attachments : undefined,
        addresses: data.addresses !== undefined ? data.addresses : undefined
      }
    });

    await logActivity({
      entityType: 'Customer',
      entityId: String(client.id),
      action: 'UPDATE',
      description: `Updated customer ${client.companyName}`,
      userId: (req as any).user?.id
    });

    res.json(client);
  } catch (error: any) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// Delete a client
router.delete('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const existing = await prisma.client.findUnique({ where: { id } });
    await prisma.client.delete({ where: { id } });
    if (existing) {
      await logActivity({
        entityType: 'Customer',
        entityId: String(id),
        action: 'DELETE',
        description: `Deleted customer ${existing.companyName}`,
        userId: (req as any).user?.id
      });
    }
    res.json({ message: 'Customer deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
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

// Bulk Process Customers Helper
export async function processBulkClients(rows: any[], userId?: string): Promise<{
  successCount: number;
  createdCount: number;
  updatedCount: number;
  errors: string[];
}> {
  let successCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  // Verify that userId exists in User table to avoid Foreign Key violation on assignedRepId
  let resolvedUserId: string | null = null;
  if (userId) {
    try {
      const userExists = await prisma.user.findUnique({ where: { id: userId } });
      if (userExists) {
        resolvedUserId = userExists.id;
      }
    } catch (e) {
      resolvedUserId = null;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const companyName = String(
        row.companyName ||
        row['Customer Name'] ||
        row.customerName ||
        row['Company Name'] ||
        row.name ||
        row.clientName ||
        ''
      ).trim();

      if (!companyName) {
        errors.push(`Row ${rowNum}: Customer Name is required`);
        continue;
      }

      const gstNumber = row.gstNumber || row['GST Number'] || row.gst_number || row.GSTIN || row['GST No'] 
        ? String(row.gstNumber || row['GST Number'] || row.gst_number || row.GSTIN || row['GST No']).trim() 
        : null;
      const taxId = row.taxId || row['Tax ID / PAN'] || row.tax_id || row.PAN 
        ? String(row.taxId || row['Tax ID / PAN'] || row.tax_id || row.PAN).trim() 
        : null;
      const phone = row.phone || row['Phone / Contact'] || row.contact || row.Mobile 
        ? String(row.phone || row['Phone / Contact'] || row.contact || row.Mobile).trim() 
        : null;
      const email = row.email || row.Email || row['Email Address'] 
        ? String(row.email || row.Email || row['Email Address']).trim() 
        : null;
      const contactPersonName = row.contactPersonName || row['Contact Person'] || row.contactPerson 
        ? String(row.contactPersonName || row['Contact Person'] || row.contactPerson).trim() 
        : null;
      const customerType = row.customerType || row['Customer Type'] || 'Company';
      const customerGroup = row.customerGroup || row['Customer Group'] || 'Commercial';
      const territory = row.territory || row.Territory || 'India';
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
      const country = row.country || row.Country || 'India';
      const creditLimit = parseNum(row.creditLimit || row['Credit Limit'], 0);
      const paymentTerms = row.paymentTerms || row['Payment Terms'] || 'Net 30';
      const taxCategory = row.taxCategory || row['Tax Category'] || 'Standard Rate';
      const disabled = parseBool(row.disabled || row.Disabled, false);

      // Check if client already exists (match by gstNumber if present, or by companyName)
      let existingClient = null;
      if (gstNumber) {
        existingClient = await prisma.client.findFirst({
          where: { gstNumber: { equals: gstNumber, mode: 'insensitive' } }
        });
      }
      if (!existingClient) {
        existingClient = await prisma.client.findFirst({
          where: { companyName: { equals: companyName, mode: 'insensitive' } }
        });
      }

      if (existingClient) {
        await prisma.client.update({
          where: { id: existingClient.id },
          data: {
            companyName,
            customerType,
            customerGroup,
            territory,
            contactPersonName: contactPersonName || existingClient.contactPersonName,
            phone: phone || existingClient.phone,
            email: email || existingClient.email,
            gstNumber: gstNumber || existingClient.gstNumber,
            taxId: taxId || existingClient.taxId,
            address: address || existingClient.address,
            city: city || existingClient.city,
            state: state || existingClient.state,
            postalCode: postalCode || existingClient.postalCode,
            country: country || existingClient.country,
            creditLimit: creditLimit !== 0 ? creditLimit : existingClient.creditLimit,
            paymentTerms: paymentTerms || existingClient.paymentTerms,
            taxCategory: taxCategory || existingClient.taxCategory,
            disabled
          }
        });
        updatedCount++;
      } else {
        await prisma.client.create({
          data: {
            companyName,
            customerType,
            customerGroup,
            territory,
            contactPersonName,
            phone,
            email,
            gstNumber,
            taxId,
            address,
            city,
            state,
            postalCode,
            country,
            creditLimit,
            paymentTerms,
            taxCategory,
            disabled,
            assignedRepId: resolvedUserId
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
        entityType: 'Customer',
        entityId: 'BULK',
        action: 'BULK_IMPORT',
        description: `Bulk imported ${successCount} customers (${createdCount} created, ${updatedCount} updated)`,
        userId: resolvedUserId || undefined
      });
    } catch (logErr) {
      console.warn('Failed to log bulk customer import activity', logErr);
    }
  }

  return { successCount, createdCount, updatedCount, errors };
}

// POST bulk import (JSON array)
router.post('/bulk-import', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req: Request, res: Response) => {
  try {
    const items = req.body.items || req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No customer records provided for import' });
    }

    const currentUserId = (req as any).user?.id;
    const result = await processBulkClients(items, currentUserId);

    res.json({
      message: `Successfully processed ${result.successCount} customers (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk import customers error:', error);
    res.status(500).json({ error: 'Failed to process bulk import', message: error?.message });
  }
});

// POST bulk upload (multipart Excel file)
router.post('/bulk-upload', authorizeRole('PLANT_ADMIN', 'SALES_REP'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any>(sheet);

    const currentUserId = (req as any).user?.id;
    const result = await processBulkClients(rows, currentUserId);

    res.json({
      message: `Successfully processed ${result.successCount} customers (${result.createdCount} created, ${result.updatedCount} updated).`,
      ...result
    });
  } catch (error: any) {
    console.error('Bulk upload customers error:', error);
    res.status(500).json({ error: 'Failed to process bulk upload', message: error?.message });
  }
});

export default router;
