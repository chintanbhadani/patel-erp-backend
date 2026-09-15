import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function logActivity(params: {
  userId?: string;
  entityType: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'ATTACHMENT' | 'OTHER';
  description: string;
  metadata?: any;
}) {
  try {
    const activity = await prisma.activityLog.create({
      data: {
        userId: params.userId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        description: params.description,
        metadata: params.metadata ? (params.metadata as any) : undefined,
      },
    });
    return activity;
  } catch (error) {
    console.error('Failed to log activity:', error);
    // We do not throw to avoid crashing the main transaction
  }
}
