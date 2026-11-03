import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { logActivity } from '../services/activityLogger';

const router = Router();
const prisma = new PrismaClient();

// GET all transporters
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search, status } = req.query;
    const where: any = {};

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { gstin: { contains: q, mode: 'insensitive' } },
        { transporterId: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { contactPerson: { contains: q, mode: 'insensitive' } }
      ];
    }

    if (status === 'active') {
      where.disabled = false;
    } else if (status === 'disabled') {
      where.disabled = true;
    }

    const transporters = await prisma.transporter.findMany({
      where,
      orderBy: { updatedAt: 'desc' }
    });

    res.json(transporters);
  } catch (error: any) {
    console.error('Error fetching transporters:', error);
    res.status(500).json({ error: 'Failed to fetch transporters' });
  }
});

// GET transporter by ID
router.get('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const transporter = await prisma.transporter.findUnique({
      where: { id }
    });

    if (!transporter) {
      return res.status(404).json({ error: 'Transporter not found' });
    }

    res.json(transporter);
  } catch (error: any) {
    console.error('Error fetching transporter details:', error);
    res.status(500).json({ error: 'Failed to fetch transporter details' });
  }
});

// POST create transporter
router.post('/', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const {
      name,
      gstin,
      transporterId,
      phone,
      email,
      contactPerson,
      address,
      city,
      state,
      pincode,
      modeOfTransport,
      vehicleTypes,
      freightTerms,
      trackingUrl,
      imageUrl,
      disabled
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Transporter name is required' });
    }

    const trimmedName = name.trim();

    // Check duplicate name
    const existingName = await prisma.transporter.findFirst({
      where: {
        name: {
          equals: trimmedName,
          mode: 'insensitive'
        }
      }
    });

    if (existingName) {
      return res.status(400).json({ error: `Transporter "${trimmedName}" already exists` });
    }

    // Check duplicate GSTIN if provided
    const trimmedGstin = gstin ? String(gstin).trim().toUpperCase() : null;
    if (trimmedGstin) {
      const existingGst = await prisma.transporter.findFirst({
        where: {
          gstin: {
            equals: trimmedGstin,
            mode: 'insensitive'
          }
        }
      });
      if (existingGst) {
        return res.status(400).json({ error: `Transporter with GSTIN "${trimmedGstin}" already exists (${existingGst.name})` });
      }
    }

    const transporter = await prisma.transporter.create({
      data: {
        name: trimmedName,
        gstin: trimmedGstin,
        transporterId: transporterId ? String(transporterId).trim() : null,
        phone: phone ? String(phone).trim() : null,
        email: email ? String(email).trim().toLowerCase() : null,
        contactPerson: contactPerson ? String(contactPerson).trim() : null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        state: state ? String(state).trim() : null,
        pincode: pincode ? String(pincode).trim() : null,
        modeOfTransport: modeOfTransport ? String(modeOfTransport).trim() : 'Road',
        vehicleTypes: vehicleTypes ? String(vehicleTypes).trim() : null,
        freightTerms: freightTerms ? String(freightTerms).trim() : 'To Pay',
        trackingUrl: trackingUrl ? String(trackingUrl).trim() : null,
        imageUrl: imageUrl ? String(imageUrl).trim() : null,
        disabled: disabled !== undefined ? Boolean(disabled) : false
      }
    });

    await logActivity({
      entityType: 'Transporter',
      entityId: String(transporter.id),
      action: 'CREATE',
      description: `Created transporter ${transporter.name}`,
      userId: (req as any).user?.id
    });

    res.status(201).json(transporter);
  } catch (error: any) {
    console.error('Error creating transporter:', error);
    res.status(500).json({ error: error?.message || 'Failed to create transporter' });
  }
});

// POST bulk import transporters
router.post('/bulk-import', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const rawItems: any[] = Array.isArray(req.body) ? req.body : req.body?.items || [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'No items provided for import' });
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const item of rawItems) {
      const name = item.name ? String(item.name).trim() : '';
      if (!name) continue;

      const gstin = item.gstin ? String(item.gstin).trim().toUpperCase() : null;

      const existing = await prisma.transporter.findFirst({
        where: {
          OR: [
            { name: { equals: name, mode: 'insensitive' as const } },
            ...(gstin ? [{ gstin: { equals: gstin, mode: 'insensitive' as const } }] : [])
          ]
        }
      });

      const payload = {
        name,
        gstin,
        transporterId: item.transporterId ? String(item.transporterId).trim() : null,
        phone: item.phone ? String(item.phone).trim() : null,
        email: item.email ? String(item.email).trim().toLowerCase() : null,
        contactPerson: item.contactPerson ? String(item.contactPerson).trim() : null,
        address: item.address ? String(item.address).trim() : null,
        city: item.city ? String(item.city).trim() : null,
        state: item.state ? String(item.state).trim() : null,
        pincode: item.pincode ? String(item.pincode).trim() : null,
        modeOfTransport: item.modeOfTransport ? String(item.modeOfTransport).trim() : 'Road',
        vehicleTypes: item.vehicleTypes ? String(item.vehicleTypes).trim() : null,
        freightTerms: item.freightTerms ? String(item.freightTerms).trim() : 'To Pay',
        trackingUrl: item.trackingUrl ? String(item.trackingUrl).trim() : null,
        disabled: item.disabled !== undefined ? Boolean(item.disabled) : false
      };

      if (existing) {
        await prisma.transporter.update({
          where: { id: existing.id },
          data: payload
        });
        updatedCount++;
      } else {
        await prisma.transporter.create({
          data: payload
        });
        createdCount++;
      }
    }

    await logActivity({
      entityType: 'Transporter',
      entityId: 'BULK',
      action: 'BULK_IMPORT',
      description: `Bulk imported ${createdCount + updatedCount} transporters (${createdCount} created, ${updatedCount} updated)`,
      userId: (req as any).user?.id
    });

    res.json({
      success: true,
      successCount: createdCount + updatedCount,
      count: createdCount + updatedCount,
      createdCount,
      updatedCount,
      errors: [],
      message: `Successfully imported ${createdCount + updatedCount} transporters`
    });
  } catch (error: any) {
    console.error('Bulk import transporters error:', error);
    res.status(500).json({ error: 'Failed to process bulk import', message: error?.message });
  }
});

// PUT update transporter
router.put('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = await prisma.transporter.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Transporter not found' });
    }

    const {
      name,
      gstin,
      transporterId,
      phone,
      email,
      contactPerson,
      address,
      city,
      state,
      pincode,
      modeOfTransport,
      vehicleTypes,
      freightTerms,
      trackingUrl,
      imageUrl,
      disabled
    } = req.body;

    let trimmedName = existing.name;
    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Transporter name cannot be empty' });
      }
      trimmedName = name.trim();

      // Check duplicate name excluding self
      const duplicateName = await prisma.transporter.findFirst({
        where: {
          id: { not: id },
          name: {
            equals: trimmedName,
            mode: 'insensitive'
          }
        }
      });
      if (duplicateName) {
        return res.status(400).json({ error: `Transporter "${trimmedName}" already exists` });
      }
    }

    let trimmedGstin = existing.gstin;
    if (gstin !== undefined) {
      trimmedGstin = gstin ? String(gstin).trim().toUpperCase() : null;
      if (trimmedGstin) {
        const duplicateGstin = await prisma.transporter.findFirst({
          where: {
            id: { not: id },
            gstin: {
              equals: trimmedGstin,
              mode: 'insensitive'
            }
          }
        });
        if (duplicateGstin) {
          return res.status(400).json({ error: `Transporter with GSTIN "${trimmedGstin}" already exists (${duplicateGstin.name})` });
        }
      }
    }

    const updated = await prisma.transporter.update({
      where: { id },
      data: {
        name: trimmedName,
        gstin: trimmedGstin,
        transporterId: transporterId !== undefined ? (transporterId ? String(transporterId).trim() : null) : existing.transporterId,
        phone: phone !== undefined ? (phone ? String(phone).trim() : null) : existing.phone,
        email: email !== undefined ? (email ? String(email).trim().toLowerCase() : null) : existing.email,
        contactPerson: contactPerson !== undefined ? (contactPerson ? String(contactPerson).trim() : null) : existing.contactPerson,
        address: address !== undefined ? (address ? String(address).trim() : null) : existing.address,
        city: city !== undefined ? (city ? String(city).trim() : null) : existing.city,
        state: state !== undefined ? (state ? String(state).trim() : null) : existing.state,
        pincode: pincode !== undefined ? (pincode ? String(pincode).trim() : null) : existing.pincode,
        modeOfTransport: modeOfTransport !== undefined ? (modeOfTransport ? String(modeOfTransport).trim() : 'Road') : existing.modeOfTransport,
        vehicleTypes: vehicleTypes !== undefined ? (vehicleTypes ? String(vehicleTypes).trim() : null) : existing.vehicleTypes,
        freightTerms: freightTerms !== undefined ? (freightTerms ? String(freightTerms).trim() : 'To Pay') : existing.freightTerms,
        trackingUrl: trackingUrl !== undefined ? (trackingUrl ? String(trackingUrl).trim() : null) : existing.trackingUrl,
        imageUrl: imageUrl !== undefined ? (imageUrl ? String(imageUrl).trim() : null) : existing.imageUrl,
        disabled: disabled !== undefined ? Boolean(disabled) : existing.disabled
      }
    });

    await logActivity({
      entityType: 'Transporter',
      entityId: String(updated.id),
      action: 'UPDATE',
      description: `Updated transporter ${updated.name}`,
      userId: (req as any).user?.id
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating transporter:', error);
    res.status(500).json({ error: error?.message || 'Failed to update transporter' });
  }
});

// DELETE transporter
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = await prisma.transporter.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Transporter not found' });
    }

    await prisma.transporter.delete({ where: { id } });

    await logActivity({
      entityType: 'Transporter',
      entityId: String(id),
      action: 'DELETE',
      description: `Deleted transporter ${existing.name}`,
      userId: (req as any).user?.id
    });

    res.json({ message: 'Transporter deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting transporter:', error);
    res.status(500).json({ error: 'Failed to delete transporter' });
  }
});

export default router;
