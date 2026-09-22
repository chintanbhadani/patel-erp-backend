import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

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
    const { companyName, email, phone, gstNumber, imageUrl, attachments } = req.body;
    const currentUserId = (req as any).user?.id;

    // Verify the userId is a real DB row (dev-mode bypass sets id='dev-user' which doesn't exist)
    let resolvedRepId: string | null = null;
    if (currentUserId) {
      const userExists = await prisma.user.findUnique({ where: { id: currentUserId } });
      resolvedRepId = userExists ? currentUserId : null;
    }

    const client = await prisma.client.create({
      data: {
        companyName,
        email,
        phone,
        gstNumber,
        imageUrl: imageUrl || null,
        attachments: attachments || [],
        assignedRepId: resolvedRepId
      }
    });

    res.status(201).json(client);
  } catch (error: any) {
    console.error('Error creating client:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A client with this GST Number already exists' });
    }
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Update a client
router.put('/:id', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const { id } = req.params;
    const { companyName, email, phone, gstNumber, imageUrl, attachments } = req.body;

    const client = await prisma.client.update({
      where: { id },
      data: {
        companyName: companyName !== undefined ? companyName : undefined,
        email: email !== undefined ? email : undefined,
        phone: phone !== undefined ? phone : undefined,
        gstNumber: gstNumber !== undefined ? gstNumber : undefined,
        imageUrl: imageUrl !== undefined ? imageUrl : undefined,
        attachments: attachments !== undefined ? attachments : undefined
      }
    });

    res.json(client);
  } catch (error: any) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

export default router;
