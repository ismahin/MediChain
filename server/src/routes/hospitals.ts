import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { BlockchainStatus, RecordType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok, patientSummarySelect, publicUserSelect } from "../utils/api.js";
import { hashMetadata, sha256Hex, stableStringify } from "../utils/hash.js";
import { ACCESS_CATEGORIES, hasPatientAccess, isAllowedProviderAccessCategory, isSupportedAccessCategory, patientAccessStatus } from "../services/access.js";
import { generateHealthId } from "../utils/healthId.js";
import { env } from "../config/env.js";

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
  if (!(await hasPatientAccess(userId, patientId, ACCESS_CATEGORIES.FULL))) throw new ApiError(403, "Patient has not granted hospital access");
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientId } });
  if (!patient) throw new ApiError(404, "Patient not found");
  const fileHash = sha256Hex(stableStringify(payload));
  const metadataHash = hashMetadata({ type, patientId, hospitalId: hospital.id, title });
  return prisma.medicalRecord.create({
    data: { patientId, creatorUserId: userId, creatorOrganizationId: hospital.id, recordType: type, title, description, recordDate: new Date(), fileHash, metadataHash, blockchainStatus: BlockchainStatus.PENDING }
  });
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
    await verifiedHospital(req.user!.id);
    const body = z.object({
      requestedCategories: z.array(z.string().refine((category) => isSupportedAccessCategory(category) && isAllowedProviderAccessCategory("HOSPITAL", category), "Unsupported access category")).min(1),
      reason: z.string().min(5),
      requestedDurationHours: z.number().int().min(1).max(env.MAX_ACCESS_DURATION_HOURS)
    }).parse(req.body);
    const accessStatus = await patientAccessStatus(req.user!.id, req.params.patientId);
    if (accessStatus === "ACTIVE") throw new ApiError(409, "You already have active access to this patient");
    if (accessStatus === "PENDING") throw new ApiError(409, "An access request for this patient is already pending");
    const patient = await prisma.patientProfile.findUnique({ where: { id: req.params.patientId } });
    if (!patient) throw new ApiError(404, "Patient not found");
    const request = await prisma.accessRequest.create({
      data: { patientId: req.params.patientId, requesterUserId: req.user!.id, requesterRole: Role.HOSPITAL, ...body }
    });
    await prisma.notification.create({
        data: {
          userId: patient.userId,
          title: "Hospital access request",
          message: `${req.user!.fullName} requested access to ${body.requestedCategories.join(", ")}.`,
          relatedEntityType: "AccessRequest",
          relatedEntityId: request.id
        }
      });
    ok(res.status(201), request, "Hospital access request sent");
  })
);

router.get(
  "/access-requests",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.accessRequest.findMany({ where: { requesterUserId: req.user!.id }, include: { patient: { select: patientSummarySelect } }, orderBy: { createdAt: "desc" }, distinct: ["patientId", "requesterUserId"] }));
  })
);

router.get(
  "/records",
  asyncHandler(async (req, res) => {
    await verifiedHospital(req.user!.id);
    ok(res, await prisma.medicalRecord.findMany({ where: { creatorUserId: req.user!.id }, omit: { filePath: true }, include: { patient: { select: patientSummarySelect } }, orderBy: { createdAt: "desc" } }));
  })
);

router.get(
  "/staff-doctors",
  asyncHandler(async (req, res) => {
    await verifiedHospital(req.user!.id);
    const [doctors, memberships] = await Promise.all([
      prisma.doctorProfile.findMany({ where: { verificationStatus: "VERIFIED", user: { isActive: true } }, include: { user: { select: publicUserSelect } }, orderBy: { user: { fullName: "asc" } } }),
      prisma.hospitalDoctor.findMany({ where: { hospitalUserId: req.user!.id } })
    ]);
    const membershipByDoctor = new Map(memberships.map((item) => [item.doctorUserId, item]));
    ok(res, doctors.map((doctor) => {
      const membership = membershipByDoctor.get(doctor.userId);
      return { ...doctor, isStaff: membership?.status === "APPROVED", invitationStatus: membership?.status ?? "NONE", invitationId: membership?.id ?? null };
    }));
  })
);

router.post("/staff-doctors/:doctorUserId", asyncHandler(async (req, res) => {
  await verifiedHospital(req.user!.id);
  const doctor = await prisma.doctorProfile.findFirst({ where: { userId: req.params.doctorUserId, verificationStatus: "VERIFIED", user: { isActive: true } } });
  if (!doctor) throw new ApiError(404, "Verified doctor not found");
  const existing = await prisma.hospitalDoctor.findUnique({ where: { hospitalUserId_doctorUserId: { hospitalUserId: req.user!.id, doctorUserId: doctor.userId } } });
  if (existing?.status === "PENDING") throw new ApiError(409, "An invitation is already pending for this doctor");
  if (existing?.status === "APPROVED") throw new ApiError(409, "This doctor is already on the hospital staff");
  const invitation = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.hospitalDoctor.update({ where: { id: existing.id }, data: { status: "PENDING", respondedAt: null, createdAt: new Date() } })
      : await tx.hospitalDoctor.create({ data: { hospitalUserId: req.user!.id, doctorUserId: doctor.userId, status: "PENDING" } });
    await tx.notification.create({ data: { userId: doctor.userId, title: "Hospital staff invitation", message: `${req.user!.fullName} invited you to join its medical staff. Review the invitation in your doctor dashboard.`, relatedEntityType: "HospitalDoctor", relatedEntityId: saved.id } });
    return saved;
  });
  ok(res.status(201), invitation, "Staff invitation sent to the doctor");
}));

router.delete("/staff-doctors/:doctorUserId", asyncHandler(async (req, res) => {
  await verifiedHospital(req.user!.id);
  const membership = await prisma.hospitalDoctor.findUnique({ where: { hospitalUserId_doctorUserId: { hospitalUserId: req.user!.id, doctorUserId: req.params.doctorUserId } } });
  if (!membership) throw new ApiError(404, "No staff membership or invitation exists for this doctor");
  await prisma.hospitalDoctor.delete({ where: { id: membership.id } });
  ok(res, null, membership.status === "PENDING" ? "Staff invitation cancelled" : "Doctor removed from hospital staff");
}));

router.post(
  "/patients/register",
  asyncHandler(async (req, res) => {
    await verifiedHospital(req.user!.id);
    const body = z.object({
      fullName: z.string().min(2),
      email: z.string().trim().toLowerCase().email(),
      phone: z.string().optional(),
      dateOfBirth: z.string().refine((value) => { const date = new Date(value); return !Number.isNaN(date.getTime()) && date < new Date(); }, "Date of birth must be a valid date in the past"),
      gender: z.string(),
      nidOrBirthCertificate: z.string(),
      bloodGroup: z.string(),
      emergencyContactName: z.string(),
      emergencyContactPhone: z.string(),
      address: z.string()
    }).parse(req.body);
    const existingUser = await prisma.user.findUnique({ where: { email: body.email }, include: { patientProfile: true } });
    if (existingUser) {
      const patientHint = existingUser.patientProfile?.healthId ? ` Their Health ID is ${existingUser.patientProfile.healthId}. Find them in Patient Directory.` : " Use a different email address.";
      throw new ApiError(409, `An account with ${body.email} already exists.${patientHint}`);
    }
    const temporaryPassword = `Tmp-${crypto.randomBytes(6).toString("base64url")}!`;
    const passwordHash = await bcrypt.hash(temporaryPassword, env.BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        passwordHash,
        role: Role.PATIENT,
        patientProfile: {
          create: {
            healthId: await generateHealthId(),
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
    ok(res.status(201), {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      patientProfile: user.patientProfile,
      temporaryPassword
    }, "Patient registered successfully");
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
