import { prisma } from "../config/prisma.js";

export async function writeAudit(input: {
  actorUserId?: string;
  patientId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: unknown;
  ipAddress?: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      patientId: input.patientId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata === undefined ? undefined : (input.metadata as object),
      ipAddress: input.ipAddress
    }
  });
}
