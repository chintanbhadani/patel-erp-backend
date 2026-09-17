import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get activities for a specific entity
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { entityType, entityId } = req.query;

    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId are required' });
    }

    const activities = await prisma.activityLog.findMany({
      where: {
        entityType: String(entityType),
        entityId: String(entityId),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(activities);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// Create a new activity or comment in DB
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { entityType, entityId, action, description, metadata } = req.body;
    const userId = (req as any).user?.id !== 'dev-user' ? (req as any).user?.id : undefined;

    if (!entityType || !entityId || !description) {
      return res.status(400).json({ error: 'entityType, entityId, and description are required' });
    }

    const activity = await prisma.activityLog.create({
      data: {
        entityType: String(entityType),
        entityId: String(entityId),
        action: action || 'COMMENT',
        description: String(description).trim(),
        metadata: metadata || null,
        userId: userId || null
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          }
        }
      }
    });

    res.status(201).json(activity);
  } catch (error) {
    console.error('Error creating activity:', error);
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

// Delete an activity or comment from DB
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.activityLog.delete({
      where: { id }
    });
    res.json({ message: 'Activity deleted successfully' });
  } catch (error) {
    console.error('Error deleting activity:', error);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

export default router;
