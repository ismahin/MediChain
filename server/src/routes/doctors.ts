import { Router } from "express";
import { BlockchainStatus, RecordType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok, patientSummarySelect, publicUserSelect } from "../utils/api.js";
import { hashMetadata, sha256Hex, stableStringify } from "../utils/hash.js";
import { ACCESS_CATEGORIES, accessScopeAllows, getPatientAccessScope, hasPatientAccess, isAllowedProviderAccessCategory, isSupportedAccessCategory, patientAccessStatus } from "../services/access.js";
import { writeAudit } from "../services/audit.js";
import { env } from "../config/env.js";

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
    const query = String(req.query.q ?? "").trim();
    const patients = await prisma.patientProfile.findMany({
      where: query ? {
        OR: [{ healthId: { contains: query } }, { user: { fullName: { contains: query } } }, { user: { email: { contains: query } } }]
      } : undefined,
      select: { id: true, healthId: true, user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "desc" }
    });
    ok(res, await Promise.all(patients.map(async (patient) => ({ ...patient, accessStatus: await patientAccessStatus(req.user!.id, patient.id) }))));
  })
);

router.post(
  "/patients/:patientId/access-request",
  asyncHandler(async (req, res) => {
    await verifiedDoctor(req.user!.id);
    const body = z
      .object({
        requestedCategories: z.array(z.string().refine((category) => isSupportedAccessCategory(category) && isAllowedProviderAccessCategory("DOCTOR", category), "Unsupported access category")).min(1),
        reason: z.string().min(5),
        requestedDurationHours: z.number().int().min(1).max(env.MAX_ACCESS_DURATION_HOURS)
      })
      .parse(req.body);
    const accessStatus = await patientAccessStatus(req.user!.id, req.params.patientId);
    if (accessStatus === "ACTIVE") throw new ApiError(409, "You already have active access to this patient");
    if (accessStatus === "PENDING") throw new ApiError(409, "An access request for this patient is already pending");
    const patient = await prisma.patientProfile.findUnique({ where: { id: req.params.patientId } });
    if (!patient) throw new ApiError(404, "Patient not found");
    const request = await prisma.accessRequest.create({
      data: { patientId: req.params.patientId, requesterUserId: req.user!.id, requesterRole: Role.DOCTOR, ...body }
    });
    await prisma.notification.create({
        data: {
          userId: patient.userId,
          title: "New access request",
          message: `${req.user!.fullName} requested access to ${body.requestedCategories.join(", ")}.`,
          relatedEntityType: "AccessRequest",
          relatedEntityId: request.id
        }
      });
    ok(res.status(201), request, "Access request sent");
  })
);

router.get(
  "/access-requests",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.accessRequest.findMany({ where: { requesterUserId: req.user!.id }, include: { patient: { select: patientSummarySelect } }, orderBy: { createdAt: "desc" }, distinct: ["patientId", "requesterUserId"] }));
  })
);

router.get(
  "/patients/:patientId/workspace",
  asyncHandler(async (req, res) => {
    await verifiedDoctor(req.user!.id);
    const scope = await getPatientAccessScope(req.user!.id, req.params.patientId);
    if (!scope.allowed) throw new ApiError(403, "Patient access is required before opening the clinical workspace");
    const patient = await prisma.patientProfile.findUnique({
      where: { id: req.params.patientId },
      select: {
        id: true, healthId: true, dateOfBirth: true, gender: true, bloodGroup: true,
        allergies: true, chronicConditions: true, currentMedications: true,
        surgeryHistory: true, vaccinationHistory: true,
        user: { select: publicUserSelect }
      }
    });
    if (!patient) throw new ApiError(404, "Patient not found");
    const records = await prisma.medicalRecord.findMany({
      where: { patientId: patient.id, isActive: true },
      omit: { filePath: true },
      include: { creator: { select: publicUserSelect }, prescription: { include: { medications: true } } },
      orderBy: { recordDate: "desc" }
    });
    const canReadClinicalSummary = accessScopeAllows(scope, ACCESS_CATEGORIES.FULL) || accessScopeAllows(scope, ACCESS_CATEGORIES.EMERGENCY_INFO);
    ok(res, {
      patient: canReadClinicalSummary ? patient : { ...patient, allergies: [], chronicConditions: [], currentMedications: [], surgeryHistory: [], vaccinationHistory: [] },
      records: records.filter((record) => accessScopeAllows(scope, record.recordType)),
      grantedCategories: [...scope.categories]
    });
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
        followUpDate: z.string().refine((value) => value === "" || (!Number.isNaN(new Date(value).getTime()) && new Date(value) > new Date()), "Follow-up date must be in the future").optional()
      })
      .parse(req.body);
    if (!(await hasPatientAccess(req.user!.id, body.patientId, ACCESS_CATEGORIES.FULL))) throw new ApiError(403, "Patient has not granted consultation access");
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
    await writeAudit({ actorUserId: req.user!.id, patientId: body.patientId, action: "CONSULTATION_CREATED", entityType: "MedicalRecord", entityId: record.id, ipAddress: req.ip });
    ok(res.status(201), record, "Consultation saved; confirm the blockchain proof in MetaMask");
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
        followUpDate: z.string().refine((value) => value === "" || (!Number.isNaN(new Date(value).getTime()) && new Date(value) > new Date()), "Follow-up date must be in the future").optional(),
        medications: z.array(z.object({ medicineName: z.string(), dosage: z.string(), frequency: z.string(), duration: z.string(), instructions: z.string().optional() })).min(1)
      })
      .parse(req.body);
    if (!(await hasPatientAccess(req.user!.id, body.patientId, ACCESS_CATEGORIES.PRESCRIPTIONS))) throw new ApiError(403, "Patient has not granted prescription access");
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
    await writeAudit({ actorUserId: req.user!.id, patientId: body.patientId, action: "PRESCRIPTION_CREATED", entityType: "MedicalRecord", entityId: record.id, ipAddress: req.ip });
    ok(res.status(201), record, "Prescription saved; confirm the blockchain proof in MetaMask");
  })
);

router.get(
  "/consultations",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.medicalRecord.findMany({ where: { creatorUserId: req.user!.id, recordType: RecordType.CONSULTATION }, omit: { filePath: true }, include: { patient: { select: patientSummarySelect } }, orderBy: { createdAt: "desc" } }));
  })
);

router.get(
  "/prescriptions",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.prescription.findMany({ where: { doctor: { userId: req.user!.id } }, include: { patient: { select: patientSummarySelect }, medications: true, medicalRecord: { omit: { filePath: true } } }, orderBy: { createdAt: "desc" } }));
  })
);

router.get(
  "/hospital-invitations",
  asyncHandler(async (req, res) => {
    await verifiedDoctor(req.user!.id);
    const invitations = await prisma.hospitalDoctor.findMany({ where: { doctorUserId: req.user!.id }, orderBy: { createdAt: "desc" } });
    const hospitals = await prisma.user.findMany({
      where: { id: { in: invitations.map((invitation) => invitation.hospitalUserId) }, role: Role.HOSPITAL },
      select: { ...publicUserSelect, hospitalProfile: { select: { hospitalName: true, licenseNumber: true, address: true, verificationStatus: true } } }
    });
    const hospitalById = new Map(hospitals.map((hospital) => [hospital.id, hospital]));
    ok(res, invitations.flatMap((invitation) => {
      const hospital = hospitalById.get(invitation.hospitalUserId);
      return hospital ? [{ ...invitation, hospital }] : [];
    }));
  })
);

router.post(
  "/hospital-invitations/:invitationId/respond",
  asyncHandler(async (req, res) => {
    await verifiedDoctor(req.user!.id);
    const { decision } = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).parse(req.body);
    const invitation = await prisma.hospitalDoctor.findFirst({ where: { id: req.params.invitationId, doctorUserId: req.user!.id, status: "PENDING" } });
    if (!invitation) throw new ApiError(404, "Pending hospital invitation not found");
    const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.hospitalDoctor.update({ where: { id: invitation.id }, data: { status, respondedAt: new Date() } });
      await tx.notification.create({ data: { userId: invitation.hospitalUserId, title: `Staff invitation ${status.toLowerCase()}`, message: `${req.user!.fullName} ${decision === "APPROVE" ? "accepted" : "declined"} your hospital staff invitation.`, relatedEntityType: "HospitalDoctor", relatedEntityId: saved.id } });
      return saved;
    });
    ok(res, updated, decision === "APPROVE" ? "Hospital invitation approved; you are now on staff" : "Hospital invitation rejected");
  })
);

export default router;
