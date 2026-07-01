import { Router } from "express";
import path from "path";
import { BlockchainStatus, RecordType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadTo } from "../middleware/upload.js";
import { ApiError, ok } from "../utils/api.js";
import { hashFile, hashMetadata } from "../utils/hash.js";
import { anchorRecord } from "../services/blockchain.js";
import { hasPatientAccess } from "../services/access.js";

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
    ok(res, await prisma.medicalRecord.findMany({ where: { creatorUserId: req.user!.id, recordType: RecordType.LAB_REPORT }, include: { patient: { include: { user: true } } }, orderBy: { createdAt: "desc" } }));
  })
);

router.get(
  "/patients/search",
  asyncHandler(async (req, res) => {
    await verifiedLab(req.user!.id);
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
    await verifiedLab(req.user!.id);
    const body = z.object({
      requestedCategories: z.array(z.string()).min(1),
      reason: z.string().min(5),
      requestedDurationHours: z.number().int().min(1).max(720)
    }).parse(req.body);
    const request = await prisma.accessRequest.create({
      data: { patientId: req.params.patientId, requesterUserId: req.user!.id, requesterRole: Role.LABORATORY, ...body }
    });
    const patient = await prisma.patientProfile.findUnique({ where: { id: req.params.patientId } });
    if (patient) {
      await prisma.notification.create({
        data: {
          userId: patient.userId,
          title: "Laboratory access request",
          message: `${req.user!.fullName} requested access to ${body.requestedCategories.join(", ")}.`,
          relatedEntityType: "AccessRequest",
          relatedEntityId: request.id
        }
      });
    }
    ok(res.status(201), request, "Laboratory access request sent");
  })
);

router.get(
  "/access-requests",
  asyncHandler(async (req, res) => {
    ok(res, await prisma.accessRequest.findMany({ where: { requesterUserId: req.user!.id }, include: { patient: { include: { user: true } } }, orderBy: { createdAt: "desc" } }));
  })
);

router.post(
  "/reports/upload",
  upload.single("file") as any,
  asyncHandler(async (req, res) => {
    const lab = await verifiedLab(req.user!.id);
    if (!req.file) throw new ApiError(400, "Report file is required");
    const body = z.object({ patientId: z.string(), category: z.string(), title: z.string(), testDate: z.string(), resultSummary: z.string().optional(), notes: z.string().optional() }).parse(req.body);
    if (!(await hasPatientAccess(req.user!.id, body.patientId, "Diagnostic reports only"))) throw new ApiError(403, "Patient has not granted diagnostic report access");
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
    const anchor = await anchorRecord({ recordId: record.id, healthId: patient.healthId, fileHash, metadataHash, recordType: 3 });
    const updated = await prisma.medicalRecord.update({ where: { id: record.id }, data: { blockchainStatus: anchor.status, blockchainTxHash: anchor.txHash, blockchainBlockNumber: anchor.blockNumber, blockchainTimestamp: anchor.timestamp, blockchainError: anchor.error } });
    ok(res.status(201), updated, "Report uploaded and queued for blockchain proof");
  })
);

router.post(
  "/reports/:id/verify",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id } });
    if (!record || record.creatorUserId !== req.user!.id) throw new ApiError(404, "Report not found");
    ok(res, record, "Use /api/patients/medical-records/:id/verify for integrity verification");
  })
);

export default router;
