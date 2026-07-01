import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok } from "../utils/api.js";

const router = Router();
router.use(authenticate, requireRoles(Role.ADMIN));

router.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const [patients, doctors, hospitals, labs, records, anchored, grants, emergency] = await Promise.all([
      prisma.patientProfile.count(),
      prisma.doctorProfile.count({ where: { verificationStatus: "VERIFIED" } }),
      prisma.hospitalProfile.count({ where: { verificationStatus: "VERIFIED" } }),
      prisma.laboratoryProfile.count({ where: { verificationStatus: "VERIFIED" } }),
      prisma.medicalRecord.count(),
      prisma.medicalRecord.count({ where: { blockchainStatus: { in: ["ANCHORED", "VERIFIED"] } } }),
      prisma.accessPermission.count({ where: { status: "ACTIVE", expiresAt: { gt: new Date() } } }),
      prisma.emergencyAccessLog.count()
    ]);
    ok(res, { totalPatients: patients, activeDoctors: doctors, verifiedHospitals: hospitals, verifiedLabs: labs, totalMedicalRecords: records, anchoredRecords: anchored, activeAccessGrants: grants, emergencyAccessIncidents: emergency });
  })
);

router.get("/users", asyncHandler(async (_req, res) => ok(res, await prisma.user.findMany({ include: { patientProfile: true, doctorProfile: true, hospitalProfile: true, laboratoryProfile: true }, orderBy: { createdAt: "desc" } }))));

router.post("/doctors/:id/verify", asyncHandler(async (req, res) => {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: req.params.id } });
  if (!doctor) throw new ApiError(404, "Doctor not found");
  ok(res, await prisma.doctorProfile.update({ where: { id: doctor.id }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedBy: req.user!.id } }), "Doctor verified");
}));

router.post("/hospitals/:id/verify", asyncHandler(async (req, res) => {
  const hospital = await prisma.hospitalProfile.findUnique({ where: { id: req.params.id } });
  if (!hospital) throw new ApiError(404, "Hospital not found");
  ok(res, await prisma.hospitalProfile.update({ where: { id: hospital.id }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedBy: req.user!.id } }), "Hospital verified");
}));

router.post("/laboratories/:id/verify", asyncHandler(async (req, res) => {
  const lab = await prisma.laboratoryProfile.findUnique({ where: { id: req.params.id } });
  if (!lab) throw new ApiError(404, "Laboratory not found");
  ok(res, await prisma.laboratoryProfile.update({ where: { id: lab.id }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedBy: req.user!.id } }), "Laboratory verified");
}));

router.get("/audit-logs", asyncHandler(async (_req, res) => ok(res, await prisma.auditLog.findMany({ include: { actor: true, patient: true }, orderBy: { createdAt: "desc" }, take: 200 }))));
router.get("/emergency-logs", asyncHandler(async (_req, res) => ok(res, await prisma.emergencyAccessLog.findMany({ include: { requester: true, patient: { include: { user: true } } }, orderBy: { createdAt: "desc" } }))));
router.get("/blockchain-transactions", asyncHandler(async (_req, res) => ok(res, await prisma.blockchainTransaction.findMany({ include: { record: true }, orderBy: { createdAt: "desc" } }))));

export default router;
