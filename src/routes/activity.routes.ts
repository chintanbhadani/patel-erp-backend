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

    let entityIds = [String(entityId)];
    const typeStr = String(entityType);
    const idStr = String(entityId);

    if (typeStr === 'MaterialRequest') {
      const mr = await prisma.materialRequest.findFirst({
        where: {
          OR: [
            { id: idStr },
            { materialRequestCode: idStr }
          ]
        }
      });
      if (mr) {
        entityIds = Array.from(new Set([mr.id, mr.materialRequestCode].filter(Boolean) as string[]));
      }
    } else if (typeStr === 'PurchaseOrder') {
      const po = await prisma.purchaseOrder.findFirst({
        where: {
          OR: [
            { id: idStr },
            { poNumber: idStr }
          ]
        }
      });
      if (po) {
        entityIds = Array.from(new Set([po.id, po.poNumber].filter(Boolean) as string[]));
      }
    } else if (typeStr === 'GRN' || typeStr === 'Grn') {
      const grn = await prisma.grn.findFirst({
        where: {
          OR: [
            { id: idStr },
            { grnNumber: idStr }
          ]
        }
      });
      if (grn) {
        entityIds = Array.from(new Set([grn.id, grn.grnNumber].filter(Boolean) as string[]));
      }
    } else if (typeStr === 'Item') {
      const p = await prisma.product.findFirst({
        where: {
          OR: [
            { id: idStr },
            { sku: idStr }
          ]
        }
      });
      if (p) {
        entityIds = Array.from(new Set([p.id, p.sku].filter(Boolean) as string[]));
      }
    }

    const activities = await prisma.activityLog.findMany({
      where: {
        entityType: { in: [typeStr, typeStr.toLowerCase(), typeStr.toUpperCase()] },
        entityId: { in: entityIds },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            firstName: true,
            lastName: true,
            email: true
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
    const { entityType, entityId, action, description, metadata, userId } = req.body;
    const reqUserId = (req as any).user?.id && (req as any).user?.id !== 'dev-user' ? (req as any).user?.id : null;

    if (!entityType || !entityId || !description) {
      return res.status(400).json({ error: 'entityType, entityId, and description are required' });
    }

    let finalUserId = reqUserId || userId || null;
    if (!finalUserId) {
      const defaultUser = await prisma.user.findFirst();
      if (defaultUser) {
        finalUserId = defaultUser.id;
      }
    }

    const activity = await prisma.activityLog.create({
      data: {
        entityType: String(entityType),
        entityId: String(entityId),
        action: action || 'COMMENT',
        description: String(description).trim(),
        metadata: metadata || null,
        userId: finalUserId
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            firstName: true,
            lastName: true,
            email: true
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

import { logActivity } from '../services/activityLogger';

// Delete an activity or comment from DB
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const reqUserId = (req as any).user?.id && (req as any).user?.id !== 'dev-user' ? (req as any).user?.id : null;

    // 1. Fetch existing log before deletion to log the delete action
    const existingLog = await prisma.activityLog.findUnique({
      where: { id }
    });

    // 2. Delete the target comment / activity
    await prisma.activityLog.delete({
      where: { id }
    });

    // 3. Create a DELETE activity audit log
    if (existingLog) {
      const commentSnippet = existingLog.description 
        ? ` "${existingLog.description.length > 30 ? existingLog.description.substring(0, 30) + '...' : existingLog.description}"` 
        : '';
      const deleteDescription = existingLog.action === 'COMMENT'
        ? `deleted comment${commentSnippet}`
        : `deleted activity (${existingLog.action})`;

      await logActivity({
        entityType: existingLog.entityType,
        entityId: existingLog.entityId,
        action: 'DELETE',
        description: deleteDescription,
        userId: reqUserId || existingLog.userId,
        metadata: existingLog.metadata || null
      });
    }

    res.json({ message: 'Activity deleted successfully' });
  } catch (error) {
    console.error('Error deleting activity:', error);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

export default router;
