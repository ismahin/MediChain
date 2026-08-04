import { Router } from "express";
import path from "path";
import fs from "fs";
import { BlockchainStatus, RecordType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadTo, validateUploadedFile } from "../middleware/upload.js";
import { ApiError, ok, patientSummarySelect, withoutStoragePath } from "../utils/api.js";
import { hashFile, hashMetadata } from "../utils/hash.js";
import { ACCESS_CATEGORIES, hasPatientAccess, isAllowedProviderAccessCategory, isSupportedAccessCategory, patientAccessStatus } from "../services/access.js";
import { verifyOnChain } from "../services/blockchain.js";
import { env } from "../config/env.js";

const router = Router();
const upload = uploadTo("reports");
router.use(authenticate, requireRoles(Role.LABORATORY));

async function verifiedLab(userId: string) {
  const lab = await prisma.laboratoryProfile.findUnique({ where: { userId } });
  if (!lab) throw new ApiError(404, "Laboratory profile not found");
  if (lab.verificationStatus !== "VERIFIED") throw new ApiError(403, "Laboratory account is pending verification");
  return lab;
}

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const lab = await prisma.laboratoryProfile.findUnique({ where: { userId: req.user!.id } });
    const [reports, pending, anchored] = await Promise.all([
      prisma.medicalRecord.count({ where: { creatorUserId: req.user!.id, recordType: RecordType.LAB_REPORT } }),
      prisma.accessRequest.count({ where: { requesterUserId: req.user!.id, status: "PENDING" } }),
      prisma.medicalRecord.count({ where: { creatorUserId: req.user!.id, blockchainStatus: { in: ["ANCHORED", "VERIFIED"] } } })
    ]);
    ok(res, { verificationStatus: lab?.verificationStatus ?? "PENDING", reports, pendingAccessRequests: pending, anchored });
  })
);

router.get(
  "/reports",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.medicalRecord.findMany({ where: { creatorUserId: req.user!.id, recordType: RecordType.LAB_REPORT }, omit: { filePath: true }, include: { patient: { select: patientSummarySelect } }, orderBy: { createdAt: "desc" } }));
  })
);

router.get(
  "/patients/search",
  asyncHandler(async (req, res) => {
    await verifiedLab(req.user!.id);
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
    await verifiedLab(req.user!.id);
    const body = z.object({
      requestedCategories: z.array(z.string().refine((category) => isSupportedAccessCategory(category) && isAllowedProviderAccessCategory("LABORATORY", category), "Unsupported access category")).min(1),
      reason: z.string().min(5),
      requestedDurationHours: z.number().int().min(1).max(env.MAX_ACCESS_DURATION_HOURS)
    }).parse(req.body);
    const accessStatus = await patientAccessStatus(req.user!.id, req.params.patientId);
    if (accessStatus === "ACTIVE") throw new ApiError(409, "You already have active access to this patient");
    if (accessStatus === "PENDING") throw new ApiError(409, "An access request for this patient is already pending");
    const patient = await prisma.patientProfile.findUnique({ where: { id: req.params.patientId } });
    if (!patient) throw new ApiError(404, "Patient not found");
    const request = await prisma.accessRequest.create({
      data: { patientId: req.params.patientId, requesterUserId: req.user!.id, requesterRole: Role.LABORATORY, ...body }
    });
    await prisma.notification.create({
        data: {
          userId: patient.userId,
          title: "Laboratory access request",
          message: `${req.user!.fullName} requested access to ${body.requestedCategories.join(", ")}.`,
          relatedEntityType: "AccessRequest",
          relatedEntityId: request.id
        }
      });
    ok(res.status(201), request, "Laboratory access request sent");
  })
);

router.get(
  "/access-requests",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.accessRequest.findMany({ where: { requesterUserId: req.user!.id }, include: { patient: { select: patientSummarySelect } }, orderBy: { createdAt: "desc" }, distinct: ["patientId", "requesterUserId"] }));
  })
);

router.post(
  "/reports/upload",
  upload.single("file") as any,
  asyncHandler(async (req, res) => {
    const lab = await verifiedLab(req.user!.id);
    if (!req.file) throw new ApiError(400, "Report file is required");
    validateUploadedFile(req.file);
    const body = z.object({ patientId: z.string(), category: z.string().min(2), title: z.string().min(2), testDate: z.string().refine((value) => { const date = new Date(value); return !Number.isNaN(date.getTime()) && date <= new Date(); }, "Test date must be a valid date that is not in the future"), resultSummary: z.string().optional(), notes: z.string().optional() }).parse(req.body);
    if (!(await hasPatientAccess(req.user!.id, body.patientId, ACCESS_CATEGORIES.DIAGNOSTIC_REPORTS))) throw new ApiError(403, "Patient has not granted diagnostic report access");
    const patient = await prisma.patientProfile.findUnique({ where: { id: body.patientId } });
    if (!patient) throw new ApiError(404, "Patient not found");
    const fileHash = await hashFile(req.file.path);
    const metadataHash = hashMetadata({ patientId: body.patientId, category: body.category, title: body.title, testDate: body.testDate, labId: lab.id });
    const record = await prisma.medicalRecord.create({
      data: {
        patientId: body.patientId,
        creatorUserId: req.user!.id,
        creatorOrganizationId: lab.id,
        recordType: RecordType.LAB_REPORT,
        title: body.title,
        description: body.resultSummary,
        recordDate: new Date(body.testDate),
        filePath: path.resolve(req.file.path),
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        fileHash,
        metadataHash,
        blockchainStatus: BlockchainStatus.PENDING
      }
    });
    ok(res.status(201), withoutStoragePath(record), "Report uploaded; confirm the blockchain proof in MetaMask");
  })
);

router.post(
  "/reports/:id/verify",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id } });
    if (!record || record.creatorUserId !== req.user!.id) throw new ApiError(404, "Report not found");
    const recalculatedHash = record.filePath && fs.existsSync(record.filePath) ? await hashFile(record.filePath) : "";
    const onChain = await verifyOnChain(record.fileHash);
    const matches = Boolean(recalculatedHash) && recalculatedHash === record.fileHash;
    const verified = matches && onChain.configured && onChain.exists && onChain.active;
    await prisma.medicalRecord.update({ where: { id: record.id }, data: { blockchainStatus: verified ? "VERIFIED" : record.blockchainStatus } });
    ok(res, { verified, matches, recalculatedHash, storedHash: record.fileHash, onChain }, verified ? "Report file and blockchain proof verified" : "Report could not be verified against the blockchain");
  })
);

export default router;
