import { describe, expect, it, vi } from "vitest";
import { PermissionStatus, Role } from "@prisma/client";

vi.mock("../src/config/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ id: "doctor", role: Role.DOCTOR, patientProfile: null }))
    },
    accessPermission: {
      findFirst: vi.fn(async () => ({
        status: PermissionStatus.ACTIVE,
        grantedCategories: ["Prescriptions only"],
        expiresAt: new Date(Date.now() + 10000),
        revokedAt: null
      }))
    }
  }
}));

describe("access service", () => {
  it("allows category-scoped permissions", async () => {
    const { hasPatientAccess } = await import("../src/services/access.js");
    await expect(hasPatientAccess("doctor", "patient", "Prescriptions only")).resolves.toBe(true);
    await expect(hasPatientAccess("doctor", "patient", "Diagnostic reports only")).resolves.toBe(false);
  });
});
