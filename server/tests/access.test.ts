import { describe, expect, it, vi } from "vitest";
import { PermissionStatus, Role } from "@prisma/client";

vi.mock("../src/config/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ id: "doctor", role: Role.DOCTOR, patientProfile: null }))
    },
    accessPermission: {
      findMany: vi.fn(async ({ where }: { where: { patientId: string; granteeUserId: string } }) =>
        where.patientId === "patient-with-access" && where.granteeUserId === "doctor" ? [
          {
            status: PermissionStatus.ACTIVE,
            grantedCategories: ["Prescriptions only"],
            expiresAt: new Date(Date.now() + 10000),
            revokedAt: null
          },
          {
            status: PermissionStatus.ACTIVE,
            grantedCategories: ["Allergies and emergency info"],
            expiresAt: new Date(Date.now() + 10000),
            revokedAt: null
          }
        ] : [])
    },
    accessRequest: {
      findFirst: vi.fn(async ({ where }: { where: { patientId: string; requesterUserId: string } }) =>
        where.patientId === "patient-pending" && where.requesterUserId === "doctor" ? { id: "pending-request" } : null)
    }
  }
}));

describe("access service", () => {
  it("allows category-scoped permissions", async () => {
    const { hasPatientAccess } = await import("../src/services/access.js");
    await expect(hasPatientAccess("doctor", "patient-with-access", "Prescriptions only")).resolves.toBe(true);
    await expect(hasPatientAccess("doctor", "patient-with-access", "PRESCRIPTION")).resolves.toBe(true);
    await expect(hasPatientAccess("doctor", "patient-with-access", "Allergies and emergency info")).resolves.toBe(true);
    await expect(hasPatientAccess("doctor", "patient-with-access", "Diagnostic reports only")).resolves.toBe(false);
    await expect(hasPatientAccess("doctor", "patient-with-access", "LAB_REPORT")).resolves.toBe(false);
    await expect(hasPatientAccess("doctor", "patient-with-access", "CONSULTATION")).resolves.toBe(false);
  });

  it("keeps permission and request status isolated between patients", async () => {
    const { patientAccessStatus } = await import("../src/services/access.js");
    await expect(patientAccessStatus("doctor", "patient-with-access")).resolves.toBe("ACTIVE");
    await expect(patientAccessStatus("doctor", "patient-pending")).resolves.toBe("PENDING");
    await expect(patientAccessStatus("doctor", "different-patient")).resolves.toBe("NONE");
  });

  it("does not treat a limited permission as full clinical access", async () => {
    const { accessScopeAllows, isAllowedProviderAccessCategory } = await import("../src/services/access.js");
    const limited = { allowed: true, full: false, categories: new Set(["prescriptions only"]) };
    expect(accessScopeAllows(limited)).toBe(true);
    expect(accessScopeAllows(limited, "PRESCRIPTION")).toBe(true);
    expect(accessScopeAllows(limited, "CONSULTATION")).toBe(false);
    expect(accessScopeAllows({ ...limited, full: true }, "CONSULTATION")).toBe(true);
    expect(isAllowedProviderAccessCategory("DOCTOR", "Prescriptions only")).toBe(true);
    expect(isAllowedProviderAccessCategory("LABORATORY", "Prescriptions only")).toBe(false);
    expect(isAllowedProviderAccessCategory("LABORATORY", "Diagnostic reports only")).toBe(true);
  });
});
