import { PermissionStatus, RecordType, Role } from "@prisma/client";
import { prisma } from "../config/prisma.js";

export const ACCESS_CATEGORIES = {
  FULL: "Full medical history",
  PRESCRIPTIONS: "Prescriptions only",
  DIAGNOSTIC_REPORTS: "Diagnostic reports only",
  EMERGENCY_INFO: "Allergies and emergency info"
} as const;

export const SUPPORTED_ACCESS_CATEGORIES = Object.values(ACCESS_CATEGORIES);

export const PROVIDER_ACCESS_CATEGORIES = {
  DOCTOR: [ACCESS_CATEGORIES.FULL, ACCESS_CATEGORIES.PRESCRIPTIONS, ACCESS_CATEGORIES.DIAGNOSTIC_REPORTS, ACCESS_CATEGORIES.EMERGENCY_INFO],
  HOSPITAL: [ACCESS_CATEGORIES.FULL, ACCESS_CATEGORIES.PRESCRIPTIONS, ACCESS_CATEGORIES.DIAGNOSTIC_REPORTS, ACCESS_CATEGORIES.EMERGENCY_INFO],
  LABORATORY: [ACCESS_CATEGORIES.DIAGNOSTIC_REPORTS]
} as const;

export function isAllowedProviderAccessCategory(role: keyof typeof PROVIDER_ACCESS_CATEGORIES, value: string) {
  return (PROVIDER_ACCESS_CATEGORIES[role] as readonly string[]).includes(value);
}

export function isSupportedAccessCategory(value: string) {
  return SUPPORTED_ACCESS_CATEGORIES.includes(value as typeof SUPPORTED_ACCESS_CATEGORIES[number]);
}

const recordCategories: Record<RecordType, string> = {
  CONSULTATION: ACCESS_CATEGORIES.FULL,
  PRESCRIPTION: ACCESS_CATEGORIES.PRESCRIPTIONS,
  LAB_REPORT: ACCESS_CATEGORIES.DIAGNOSTIC_REPORTS,
  ADMISSION: ACCESS_CATEGORIES.FULL,
  DISCHARGE: ACCESS_CATEGORIES.FULL,
  SURGERY: ACCESS_CATEGORIES.FULL,
  VACCINATION: ACCESS_CATEGORIES.FULL,
  DOCUMENT: ACCESS_CATEGORIES.FULL
};

function normalizeCategory(category: string) {
  const recordCategory = recordCategories[category as RecordType];
  return (recordCategory ?? category).trim().toLowerCase();
}

const fullAliases = new Set([ACCESS_CATEGORIES.FULL, "FULL", "ALL"].map(normalizeCategory));

export type PatientAccessScope = {
  allowed: boolean;
  full: boolean;
  categories: Set<string>;
};

export function accessScopeAllows(scope: PatientAccessScope, category?: string) {
  if (!scope.allowed) return false;
  if (!category || scope.full) return true;
  return scope.categories.has(normalizeCategory(category));
}

export async function getPatientAccessScope(userId: string, patientId: string): Promise<PatientAccessScope> {
  if (!patientId) return { allowed: false, full: false, categories: new Set() };

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { patientProfile: true } });
  if (!user) return { allowed: false, full: false, categories: new Set() };
  if (user.role === Role.ADMIN || user.patientProfile?.id === patientId) {
    return { allowed: true, full: true, categories: new Set() };
  }

  const permissions = await prisma.accessPermission.findMany({
    where: {
      patientId,
      granteeUserId: userId,
      status: PermissionStatus.ACTIVE,
      expiresAt: { gt: new Date() },
      revokedAt: null
    }
  });
  const categories = new Set(
    permissions
      .flatMap((permission) => Array.isArray(permission.grantedCategories) ? permission.grantedCategories : [])
      .filter((category): category is string => typeof category === "string")
      .map(normalizeCategory)
  );
  return { allowed: permissions.length > 0, full: [...categories].some((item) => fullAliases.has(item)), categories };
}

export async function hasPatientAccess(userId: string, patientId: string, category?: string) {
  return accessScopeAllows(await getPatientAccessScope(userId, patientId), category);
}

export async function patientAccessStatus(userId: string, patientId: string): Promise<"NONE" | "PENDING" | "ACTIVE"> {
  if (await hasPatientAccess(userId, patientId)) return "ACTIVE";
  const pending = await prisma.accessRequest.findFirst({ where: { patientId, requesterUserId: userId, status: "PENDING" }, select: { id: true } });
  return pending ? "PENDING" : "NONE";
}
