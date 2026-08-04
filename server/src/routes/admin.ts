import { Router } from "express";
import { Role, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok, publicUserSelect } from "../utils/api.js";
import { env } from "../config/env.js";

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

router.get("/users", asyncHandler(async (_req, res) => ok(res, await prisma.user.findMany({ select: { ...publicUserSelect, patientProfile: { select: { id: true, healthId: true } }, doctorProfile: true, hospitalProfile: true, laboratoryProfile: true }, orderBy: { createdAt: "desc" } }))));

router.post("/users/:id/suspend", asyncHandler(async (req, res) => {
  const body = z.object({ isActive: z.boolean() }).parse(req.body);
  if (req.params.id === req.user!.id && !body.isActive) throw new ApiError(400, "You cannot suspend your own admin account");
  ok(res, await prisma.user.update({ where: { id: req.params.id }, data: { isActive: body.isActive }, select: publicUserSelect }), body.isActive ? "User activated" : "User suspended");
}));

router.post("/doctors/:id/verify", asyncHandler(async (req, res) => {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: req.params.id } });
  if (!doctor) throw new ApiError(404, "Doctor not found");
  if (doctor.verificationStatus !== VerificationStatus.PENDING) throw new ApiError(409, `Doctor is already ${doctor.verificationStatus.toLowerCase()}`);
  ok(res, await prisma.doctorProfile.update({ where: { id: doctor.id }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedBy: req.user!.id } }), "Doctor verified");
}));

router.post("/doctors/:id/reject", asyncHandler(async (_req, res) => {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: _req.params.id } });
  if (!doctor) throw new ApiError(404, "Doctor not found");
  if (doctor.verificationStatus !== VerificationStatus.PENDING) throw new ApiError(409, `Doctor is already ${doctor.verificationStatus.toLowerCase()}`);
  ok(res, await prisma.doctorProfile.update({ where: { id: doctor.id }, data: { verificationStatus: VerificationStatus.REJECTED, verifiedAt: null, verifiedBy: null } }), "Doctor rejected");
}));

router.post("/hospitals/:id/verify", asyncHandler(async (req, res) => {
  const hospital = await prisma.hospitalProfile.findUnique({ where: { id: req.params.id } });
  if (!hospital) throw new ApiError(404, "Hospital not found");
  if (hospital.verificationStatus !== VerificationStatus.PENDING) throw new ApiError(409, `Hospital is already ${hospital.verificationStatus.toLowerCase()}`);
  ok(res, await prisma.hospitalProfile.update({ where: { id: hospital.id }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedBy: req.user!.id } }), "Hospital verified");
}));

router.post("/hospitals/:id/reject", asyncHandler(async (_req, res) => {
  const hospital = await prisma.hospitalProfile.findUnique({ where: { id: _req.params.id } });
  if (!hospital) throw new ApiError(404, "Hospital not found");
  if (hospital.verificationStatus !== VerificationStatus.PENDING) throw new ApiError(409, `Hospital is already ${hospital.verificationStatus.toLowerCase()}`);
  ok(res, await prisma.hospitalProfile.update({ where: { id: hospital.id }, data: { verificationStatus: VerificationStatus.REJECTED, verifiedAt: null, verifiedBy: null } }), "Hospital rejected");
}));

router.post("/laboratories/:id/verify", asyncHandler(async (req, res) => {
  const lab = await prisma.laboratoryProfile.findUnique({ where: { id: req.params.id } });
  if (!lab) throw new ApiError(404, "Laboratory not found");
  if (lab.verificationStatus !== VerificationStatus.PENDING) throw new ApiError(409, `Laboratory is already ${lab.verificationStatus.toLowerCase()}`);
  ok(res, await prisma.laboratoryProfile.update({ where: { id: lab.id }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedBy: req.user!.id } }), "Laboratory verified");
}));

router.post("/laboratories/:id/reject", asyncHandler(async (_req, res) => {
  const lab = await prisma.laboratoryProfile.findUnique({ where: { id: _req.params.id } });
  if (!lab) throw new ApiError(404, "Laboratory not found");
  if (lab.verificationStatus !== VerificationStatus.PENDING) throw new ApiError(409, `Laboratory is already ${lab.verificationStatus.toLowerCase()}`);
  ok(res, await prisma.laboratoryProfile.update({ where: { id: lab.id }, data: { verificationStatus: VerificationStatus.REJECTED, verifiedAt: null, verifiedBy: null } }), "Laboratory rejected");
}));

router.get("/medical-records", asyncHandler(async (_req, res) => ok(res, await prisma.medicalRecord.findMany({
  select: {
    id: true,
    title: true,
    recordType: true,
    recordDate: true,
    fileHash: true,
    metadataHash: true,
    blockchainStatus: true,
    blockchainTxHash: true,
    blockchainBlockNumber: true,
    createdAt: true,
    patient: { select: { healthId: true, user: { select: { fullName: true, email: true } } } },
    creator: { select: { fullName: true, email: true, role: true } }
  },
  orderBy: { createdAt: "desc" },
  take: env.ADMIN_LIST_LIMIT
}))));

router.get("/access-permissions", asyncHandler(async (_req, res) => ok(res, await prisma.accessPermission.findMany({
  include: { patient: { select: { id: true, healthId: true, user: { select: { id: true, fullName: true, email: true } } } }, grantee: { select: publicUserSelect } },
  orderBy: { grantedAt: "desc" },
  take: env.ADMIN_LIST_LIMIT
}))));

router.get("/audit-logs", asyncHandler(async (_req, res) => ok(res, await prisma.auditLog.findMany({ include: { actor: { select: publicUserSelect }, patient: { select: { id: true, healthId: true } } }, orderBy: { createdAt: "desc" }, take: env.ADMIN_LIST_LIMIT }))));
router.get("/emergency-logs", asyncHandler(async (_req, res) => ok(res, await prisma.emergencyAccessLog.findMany({ include: { requester: { select: publicUserSelect }, patient: { select: { id: true, healthId: true, user: { select: { id: true, fullName: true, email: true } } } } }, orderBy: { createdAt: "desc" } }))));
router.get("/blockchain-transactions", asyncHandler(async (_req, res) => ok(res, await prisma.blockchainTransaction.findMany({ include: { record: { select: { id: true, title: true, recordType: true, blockchainStatus: true } } }, orderBy: { createdAt: "desc" } }))));

export default router;
