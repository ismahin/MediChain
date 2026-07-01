import { Router } from "express";
import { BlockchainStatus, RecordType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok } from "../utils/api.js";
import { hashMetadata, sha256Hex, stableStringify } from "../utils/hash.js";
import { anchorRecord } from "../services/blockchain.js";
import { hasPatientAccess } from "../services/access.js";
import { writeAudit } from "../services/audit.js";

const router = Router();
router.use(authenticate, requireRoles(Role.DOCTOR));

async function verifiedDoctor(userId: string) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId }, include: { user: true } });
  if (!doctor) throw new ApiError(404, "Doctor profile not found");
  if (doctor.verificationStatus !== "VERIFIED") throw new ApiError(403, "Doctor account is pending verification");
  return doctor;
}

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const doctor = await prisma.doctorProfile.findUnique({ where: { userId: req.user!.id } });
    const [pendingRequests, prescriptions, records, transactions] = await Promise.all([
      prisma.accessRequest.count({ where: { requesterUserId: req.user!.id, status: "PENDING" } }),
      doctor ? prisma.prescription.count({ where: { doctorId: doctor.id } }) : 0,
      prisma.medicalRecord.count({ where: { creatorUserId: req.user!.id } }),
      prisma.blockchainTransaction.findMany({ where: { record: { creatorUserId: req.user!.id } }, take: 5, orderBy: { createdAt: "desc" } })
    ]);
    ok(res, { verificationStatus: doctor?.verificationStatus ?? "PENDING", todayConsultations: records, pendingRequests, prescriptions, transactions });
  })
);

router.get(
  "/patients/search",
  asyncHandler(async (req, res) => {
    await verifiedDoctor(req.user!.id);
    const query = String(req.query.q ?? "");
    const patients = await prisma.patientProfile.findMany({
      where: {
        OR: [{ healthId: { contains: query } }, { user: { fullName: { contains: query } } }]
      },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      take: 10
    });
    const filtered = [];
    for (const patient of patients) {
      const allowed = patient.healthId.includes(query) || (await hasPatientAccess(req.user!.id, patient.id));
      if (allowed) filtered.push(patient);
    }
    ok(res, filtered);
  })
);

router.post(
  "/patients/:patientId/access-request",
  asyncHandler(async (req, res) => {
    await verifiedDoctor(req.user!.id);
    const body = z
      .object({
        requestedCategories: z.array(z.string()).min(1),
        reason: z.string().min(5),
        requestedDurationHours: z.number().int().min(1).max(720)
      })
      .parse(req.body);
    const request = await prisma.accessRequest.create({
      data: { patientId: req.params.patientId, requesterUserId: req.user!.id, requesterRole: Role.DOCTOR, ...body }
    });
    const patient = await prisma.patientProfile.findUnique({ where: { id: req.params.patientId }, include: { user: true } });
    if (patient) {
      await prisma.notification.create({
        data: {
          userId: patient.userId,
          title: "New access request",
          message: `${req.user!.fullName} requested access to ${body.requestedCategories.join(", ")}.`,
          relatedEntityType: "AccessRequest",
          relatedEntityId: request.id
        }
      });
    }
    ok(res.status(201), request, "Access request sent");
  })
);

router.get(
  "/access-requests",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.accessRequest.findMany({ where: { requesterUserId: req.user!.id }, include: { patient: { include: { user: true } } }, orderBy: { createdAt: "desc" } }));
  })
);

router.post(
  "/consultations",
  asyncHandler(async (req, res) => {
    const doctor = await verifiedDoctor(req.user!.id);
    const body = z
      .object({
        patientId: z.string(),
        chiefComplaint: z.string().min(2),
        diagnosis: z.string().min(2),
        notes: z.string().optional(),
        followUpDate: z.string().optional()
      })
      .parse(req.body);
    if (!(await hasPatientAccess(req.user!.id, body.patientId, "Full medical history"))) throw new ApiError(403, "Patient has not granted consultation access");
    const patient = await prisma.patientProfile.findUnique({ where: { id: body.patientId } });
    if (!patient) throw new ApiError(404, "Patient not found");
    const payload = { ...body, doctorId: doctor.id, createdAt: new Date().toISOString() };
    const fileHash = sha256Hex(stableStringify(payload));
    const metadataHash = hashMetadata({ title: "Doctor consultation", type: RecordType.CONSULTATION, patientId: body.patientId, doctorId: doctor.id });
    const record = await prisma.medicalRecord.create({
      data: {
        patientId: body.patientId,
        creatorUserId: req.user!.id,
        recordType: RecordType.CONSULTATION,
        title: `Consultation - ${body.diagnosis}`,
        description: `${body.chiefComplaint}\n${body.notes ?? ""}`,
        recordDate: new Date(),
        fileHash,
        metadataHash,
        blockchainStatus: BlockchainStatus.PENDING
      }
    });
    const anchor = await anchorRecord({ recordId: record.id, healthId: patient.healthId, fileHash, metadataHash, recordType: 1 });
    const updated = await prisma.medicalRecord.update({
      where: { id: record.id },
      data: { blockchainStatus: anchor.status, blockchainTxHash: anchor.txHash, blockchainBlockNumber: anchor.blockNumber, blockchainTimestamp: anchor.timestamp, blockchainError: anchor.error }
    });
    await writeAudit({ actorUserId: req.user!.id, patientId: body.patientId, action: "CONSULTATION_CREATED", entityType: "MedicalRecord", entityId: record.id, ipAddress: req.ip });
    ok(res.status(201), updated, "Consultation saved");
  })
);

router.post(
  "/prescriptions",
  asyncHandler(async (req, res) => {
    const doctor = await verifiedDoctor(req.user!.id);
    const body = z
      .object({
        patientId: z.string(),
        diagnosis: z.string().min(2),
        notes: z.string().optional(),
        followUpDate: z.string().optional(),
        medications: z.array(z.object({ medicineName: z.string(), dosage: z.string(), frequency: z.string(), duration: z.string(), instructions: z.string().optional() })).min(1)
      })
      .parse(req.body);
    if (!(await hasPatientAccess(req.user!.id, body.patientId, "Prescriptions only"))) throw new ApiError(403, "Patient has not granted prescription access");
    const patient = await prisma.patientProfile.findUnique({ where: { id: body.patientId } });
    if (!patient) throw new ApiError(404, "Patient not found");
    const payload = { ...body, doctor: { name: req.user!.fullName, registration: doctor.medicalRegistrationNumber, specialty: doctor.specialization }, issueDate: new Date().toISOString() };
    const fileHash = sha256Hex(stableStringify(payload));
    const metadataHash = hashMetadata({ type: RecordType.PRESCRIPTION, patientId: body.patientId, doctorId: doctor.id, diagnosis: body.diagnosis });
    const record = await prisma.medicalRecord.create({
      data: {
        patientId: body.patientId,
        creatorUserId: req.user!.id,
        recordType: RecordType.PRESCRIPTION,
        title: `Prescription - ${body.diagnosis}`,
        description: body.notes,
        recordDate: new Date(),
        fileHash,
        metadataHash,
        prescription: {
          create: {
            patientId: body.patientId,
            doctorId: doctor.id,
            diagnosis: body.diagnosis,
            notes: body.notes,
            followUpDate: body.followUpDate ? new Date(body.followUpDate) : undefined,
            medications: { create: body.medications }
          }
        }
      },
      include: { prescription: { include: { medications: true } } }
    });
    const anchor = await anchorRecord({ recordId: record.id, healthId: patient.healthId, fileHash, metadataHash, recordType: 2 });
    const updated = await prisma.medicalRecord.update({
      where: { id: record.id },
      data: { blockchainStatus: anchor.status, blockchainTxHash: anchor.txHash, blockchainBlockNumber: anchor.blockNumber, blockchainTimestamp: anchor.timestamp, blockchainError: anchor.error },
      include: { prescription: { include: { medications: true } } }
    });
    await writeAudit({ actorUserId: req.user!.id, patientId: body.patientId, action: "PRESCRIPTION_CREATED", entityType: "MedicalRecord", entityId: record.id, ipAddress: req.ip });
    ok(res.status(201), updated, "Prescription anchored and saved");
  })
);

router.get(
  "/consultations",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.medicalRecord.findMany({ where: { creatorUserId: req.user!.id, recordType: RecordType.CONSULTATION }, include: { patient: { include: { user: true } } }, orderBy: { createdAt: "desc" } }));
  })
);

router.get(
  "/prescriptions",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.prescription.findMany({ where: { doctor: { userId: req.user!.id } }, include: { patient: { include: { user: true } }, medications: true, medicalRecord: true }, orderBy: { createdAt: "desc" } }));
  })
);

export default router;
