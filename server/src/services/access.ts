import { PermissionStatus, Role } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const fullAliases = new Set(["Full medical history", "FULL", "ALL"]);

export async function hasPatientAccess(userId: string, patientId: string, category?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { patientProfile: true } });
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;
  if (user.patientProfile?.id === patientId) return true;

  const permission = await prisma.accessPermission.findFirst({
    where: {
      patientId,
      granteeUserId: userId,
      status: PermissionStatus.ACTIVE,
      expiresAt: { gt: new Date() },
      revokedAt: null
    }
  });
  if (!permission) return false;
  if (!category) return true;
  const categories = permission.grantedCategories as string[];
  return categories.some((item) => fullAliases.has(item) || item === category);
}

export async function patientAccessStatus(userId: string, patientId: string): Promise<"NONE" | "PENDING" | "ACTIVE"> {
  if (await hasPatientAccess(userId, patientId)) return "ACTIVE";
  const pending = await prisma.accessRequest.findFirst({ where: { patientId, requesterUserId: userId, status: "PENDING" }, select: { id: true } });
  return pending ? "PENDING" : "NONE";
}
