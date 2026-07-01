import { Router } from "express";
import bcrypt from "bcryptjs";
import { BlockchainStatus, RecordType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok } from "../utils/api.js";
import { hashMetadata, sha256Hex, stableStringify } from "../utils/hash.js";
import { anchorRecord } from "../services/blockchain.js";
import { hasPatientAccess } from "../services/access.js";

const router = Router();
router.use(authenticate, requireRoles(Role.HOSPITAL));

async function verifiedHospital(userId: string) {
  const hospital = await prisma.hospitalProfile.findUnique({ where: { userId } });
  if (!hospital) throw new ApiError(404, "Hospital profile not found");
  if (hospital.verificationStatus !== "VERIFIED") throw new ApiError(403, "Hospital account is pending verification");
  return hospital;
}

async function createHospitalRecord(userId: string, patientId: string, type: RecordType, title: string, payload: unknown, description?: string) {
  const hospital = await verifiedHospital(userId);
  if (!(await hasPatientAccess(userId, patientId, "Full medical history"))) throw new ApiError(403, "Patient has not granted hospital access");
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientId } });
  if (!patient) throw new ApiError(404, "Patient not found");
  const fileHash = sha256Hex(stableStringify(payload));
  const metadataHash = hashMetadata({ type, patientId, hospitalId: hospital.id, title });
  const record = await prisma.medicalRecord.create({
    data: { patientId, creatorUserId: userId, creatorOrganizationId: hospital.id, recordType: type, title, description, recordDate: new Date(), fileHash, metadataHash, blockchainStatus: BlockchainStatus.PENDING }
  });
  const anchor = await anchorRecord({ recordId: record.id, healthId: patient.healthId, fileHash, metadataHash, recordType: type === RecordType.SURGERY ? 5 : 4 });
  return prisma.medicalRecord.update({ where: { id: record.id }, data: { blockchainStatus: anchor.status, blockchainTxHash: anchor.txHash, blockchainBlockNumber: anchor.blockNumber, blockchainTimestamp: anchor.timestamp, blockchainError: anchor.error } });
}

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const hospital = await prisma.hospitalProfile.findUnique({ where: { userId: req.user!.id } });
    const [records, requests, tx] = await Promise.all([
      prisma.medicalRecord.count({ where: { creatorUserId: req.user!.id } }),
      prisma.accessRequest.count({ where: { requesterUserId: req.user!.id, status: "PENDING" } }),
      prisma.blockchainTransaction.findMany({ where: { record: { creatorUserId: req.user!.id } }, take: 5, orderBy: { createdAt: "desc" } })
    ]);
    ok(res, { verificationStatus: hospital?.verificationStatus ?? "PENDING", records, pendingAccessRequests: requests, transactions: tx });
  })
);

router.get(
  "/patients/search",
  asyncHandler(async (req, res) => {
    await verifiedHospital(req.user!.id);
    const query = String(req.query.q ?? "");
    const patients = await prisma.patientProfile.findMany({
      where: {
        OR: [{ healthId: { contains: query } }, { user: { fullName: { contains: query } } }]
      },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      take: 10
    });
    ok(res, patients);
  })
);

router.post(
  "/patients/:patientId/access-request",
  asyncHandler(async (req, res) => {
    await verifiedHospital(req.user!.id);
    const body = z.object({
      requestedCategories: z.array(z.string()).min(1),
      reason: z.string().min(5),
      requestedDurationHours: z.number().int().min(1).max(720)
    }).parse(req.body);
    const request = await prisma.accessRequest.create({
      data: { patientId: req.params.patientId, requesterUserId: req.user!.id, requesterRole: Role.HOSPITAL, ...body }
    });
    const patient = await prisma.patientProfile.findUnique({ where: { id: req.params.patientId } });
    if (patient) {
      await prisma.notification.create({
        data: {
          userId: patient.userId,
          title: "Hospital access request",
          message: `${req.user!.fullName} requested access to ${body.requestedCategories.join(", ")}.`,
          relatedEntityType: "AccessRequest",
          relatedEntityId: request.id
        }
      });
    }
    ok(res.status(201), request, "Hospital access request sent");
  })
);

router.get(
  "/access-requests",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.accessRequest.findMany({ where: { requesterUserId: req.user!.id }, include: { patient: { include: { user: true } } }, orderBy: { createdAt: "desc" } }));
  })
);

router.post(
  "/patients/register",
  asyncHandler(async (req, res) => {
    await verifiedHospital(req.user!.id);
    const body = z.object({
      fullName: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional(),
      dateOfBirth: z.string(),
      gender: z.string(),
      nidOrBirthCertificate: z.string(),
      bloodGroup: z.string(),
      emergencyContactName: z.string(),
      emergencyContactPhone: z.string(),
      address: z.string()
    }).parse(req.body);
    const passwordHash = await bcrypt.hash("Patient@12345", 12);
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        passwordHash,
        role: Role.PATIENT,
        patientProfile: {
          create: {
            healthId: `MCH-2026-${String((await prisma.patientProfile.count()) + 1).padStart(6, "0")}`,
            nidOrBirthCertificate: body.nidOrBirthCertificate,
            dateOfBirth: new Date(body.dateOfBirth),
            gender: body.gender,
            bloodGroup: body.bloodGroup,
            allergies: [],
            chronicConditions: [],
            currentMedications: [],
            surgeryHistory: [],
            vaccinationHistory: [],
            emergencyContactName: body.emergencyContactName,
            emergencyContactPhone: body.emergencyContactPhone,
            address: body.address
          }
        }
      },
      include: { patientProfile: true }
    });
    ok(res.status(201), user, "Patient registered with temporary password Patient@12345");
  })
);

router.post("/admissions", asyncHandler(async (req, res) => {
  const body = z.object({ patientId: z.string(), reason: z.string(), ward: z.string().optional(), notes: z.string().optional() }).parse(req.body);
  ok(res.status(201), await createHospitalRecord(req.user!.id, body.patientId, RecordType.ADMISSION, `Admission - ${body.reason}`, body, body.notes), "Admission record saved");
}));

router.post("/discharge-summaries", asyncHandler(async (req, res) => {
  const body = z.object({ patientId: z.string(), diagnosis: z.string(), summary: z.string(), instructions: z.string().optional() }).parse(req.body);
  ok(res.status(201), await createHospitalRecord(req.user!.id, body.patientId, RecordType.DISCHARGE, `Discharge - ${body.diagnosis}`, body, body.summary), "Discharge summary saved");
}));

router.post("/surgeries", asyncHandler(async (req, res) => {
  const body = z.object({ patientId: z.string(), surgeryName: z.string(), surgeon: z.string(), notes: z.string().optional() }).parse(req.body);
  ok(res.status(201), await createHospitalRecord(req.user!.id, body.patientId, RecordType.SURGERY, `Surgery - ${body.surgeryName}`, body, body.notes), "Surgery record saved");
}));

router.post("/documents/upload", asyncHandler(async (_req, res) => ok(res, { message: "Use laboratory report upload or patient medical records upload flow for files." })));

export default router;
