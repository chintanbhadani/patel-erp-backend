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

export default router;
