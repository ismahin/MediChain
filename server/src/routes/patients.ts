import fs from "fs";
import path from "path";
import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok, publicUserSelect } from "../utils/api.js";
import { hashFile } from "../utils/hash.js";
import { accessScopeAllows, getPatientAccessScope, hasPatientAccess } from "../services/access.js";
import { verifyOnChain } from "../services/blockchain.js";
import { writeAudit } from "../services/audit.js";

const router = Router();
router.use(authenticate);

async function ownPatientId(userId: string) {
  const profile = await prisma.patientProfile.findUnique({ where: { userId }, include: { user: { select: publicUserSelect } } });
  if (!profile) throw new ApiError(404, "Patient profile not found");
  return profile;
}

router.get(
  "/profile",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    ok(res, await ownPatientId(req.user!.id));
  })
);

router.put(
  "/profile",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        allergies: z.array(z.string()).optional(),
        chronicConditions: z.array(z.string()).optional(),
        currentMedications: z.array(z.string()).optional(),
        surgeryHistory: z.array(z.string()).optional(),
        vaccinationHistory: z.array(z.string()).optional(),
        emergencyContactName: z.string().optional(),
        emergencyContactPhone: z.string().optional(),
        address: z.string().optional()
      })
      .parse(req.body);
    const profile = await ownPatientId(req.user!.id);
    const updated = await prisma.patientProfile.update({ where: { id: profile.id }, data: body });
    await writeAudit({ actorUserId: req.user!.id, patientId: profile.id, action: "PATIENT_PROFILE_UPDATED", entityType: "PatientProfile", entityId: profile.id, ipAddress: req.ip });
    ok(res, updated, "Profile updated");
  })
);

router.get(
  "/timeline",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const profile = await ownPatientId(req.user!.id);
    const [records, permissions, emergency] = await Promise.all([
      prisma.medicalRecord.findMany({ where: { patientId: profile.id }, omit: { filePath: true }, include: { creator: { select: publicUserSelect } }, orderBy: { recordDate: "desc" } }),
      prisma.accessPermission.findMany({ where: { patientId: profile.id }, include: { grantee: { select: publicUserSelect } }, orderBy: { grantedAt: "desc" } }),
      prisma.emergencyAccessLog.findMany({ where: { patientId: profile.id }, include: { requester: { select: publicUserSelect } }, orderBy: { createdAt: "desc" } })
    ]);
    ok(res, { records, permissions, emergency });
  })
);

router.get(
  "/medical-records",
  asyncHandler(async (req, res) => {
    const patientId = req.user!.role === Role.PATIENT ? (await ownPatientId(req.user!.id)).id : String(req.query.patientId ?? "");
    const scope = await getPatientAccessScope(req.user!.id, patientId);
    if (!scope.allowed) throw new ApiError(403, "No active permission for this patient");
    const records = await prisma.medicalRecord.findMany({ where: { patientId, isActive: true }, omit: { filePath: true }, include: { creator: { select: publicUserSelect }, prescription: { include: { medications: true } } }, orderBy: { recordDate: "desc" } });
    ok(res, records.filter((record) => accessScopeAllows(scope, record.recordType)));
  })
);

router.get(
  "/medical-records/:id",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id }, omit: { filePath: true }, include: { creator: { select: publicUserSelect }, prescription: { include: { medications: true } } } });
    if (!record) throw new ApiError(404, "Medical record not found");
    if (!(await hasPatientAccess(req.user!.id, record.patientId, record.recordType))) throw new ApiError(403, "No permission for this record");
    ok(res, record);
  })
);

router.get(
  "/medical-records/:id/download",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id } });
    if (!record?.filePath) throw new ApiError(404, "Downloadable file not found");
    if (!(await hasPatientAccess(req.user!.id, record.patientId, record.recordType))) throw new ApiError(403, "No permission for this file");
    const root = path.resolve(process.cwd(), env.UPLOAD_DIR);
    const fullPath = path.resolve(record.filePath);
    const relativePath = path.relative(root, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || !fs.existsSync(fullPath)) throw new ApiError(404, "File no longer exists");
    await writeAudit({ actorUserId: req.user!.id, patientId: record.patientId, action: "MEDICAL_RECORD_DOWNLOADED", entityType: "MedicalRecord", entityId: record.id, ipAddress: req.ip });
    res.download(fullPath, record.originalFileName ?? path.basename(fullPath));
  })
);

router.post(
  "/medical-records/:id/verify",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id } });
    if (!record) throw new ApiError(404, "Medical record not found");
    if (!(await hasPatientAccess(req.user!.id, record.patientId, record.recordType))) throw new ApiError(403, "No permission for this record");
    const recalculatedHash = record.filePath && fs.existsSync(record.filePath) ? await hashFile(record.filePath) : record.fileHash;
    const onChain = await verifyOnChain(record.fileHash);
    const matches = recalculatedHash === record.fileHash;
    const verified = matches && onChain.configured && onChain.exists && onChain.active;
    await prisma.medicalRecord.update({ where: { id: record.id }, data: { blockchainStatus: verified ? "VERIFIED" : record.blockchainStatus } });
    const message = !matches
      ? "Warning: The local file hash does not match the stored record"
      : !onChain.configured
        ? "Local file integrity matches, but blockchain verification is not configured"
        : !onChain.exists || !onChain.active
          ? "Local file integrity matches, but no active blockchain proof was found"
          : "Verified: File integrity matches the blockchain record";
    ok(res, { verified, matches, recalculatedHash, storedHash: record.fileHash, onChain }, message);
  })
);

router.get(
  "/emergency-profile",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const profile = await ownPatientId(req.user!.id);
    ok(res, {
      emergencyAccessEnabled: profile.emergencyAccessEnabled,
      bloodGroup: profile.bloodGroup,
      allergies: profile.allergies,
      chronicConditions: profile.chronicConditions,
      emergencyContactName: profile.emergencyContactName,
      emergencyContactPhone: profile.emergencyContactPhone,
      currentMedications: profile.currentMedications,
      logs: await prisma.emergencyAccessLog.findMany({ where: { patientId: profile.id }, include: { requester: { select: publicUserSelect } }, orderBy: { createdAt: "desc" } })
    });
  })
);

router.put(
  "/emergency-profile",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const body = z.object({ emergencyAccessEnabled: z.boolean() }).parse(req.body);
    const profile = await ownPatientId(req.user!.id);
    const updated = await prisma.patientProfile.update({ where: { id: profile.id }, data: body });
    ok(res, updated, "Emergency profile updated");
  })
);

export default router;
