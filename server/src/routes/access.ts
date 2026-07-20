import { Router } from "express";
import { BlockchainStatus, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok, publicUserSelect } from "../utils/api.js";
import { permissionHash, recordAccessProof } from "../services/blockchain.js";
import { writeAudit } from "../services/audit.js";

const router = Router();
router.use(authenticate);

async function patientProfile(userId: string) {
  const profile = await prisma.patientProfile.findUnique({ where: { userId }, include: { user: true } });
  if (!profile) throw new ApiError(404, "Patient profile not found");
  return profile;
}

router.get(
  "/requests",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const patient = await patientProfile(req.user!.id);
    ok(res, await prisma.accessRequest.findMany({ where: { patientId: patient.id }, include: { requester: { select: publicUserSelect } }, orderBy: { createdAt: "desc" }, distinct: ["patientId", "requesterUserId"] }));
  })
);

router.post(
  "/requests/:id/approve",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const patient = await patientProfile(req.user!.id);
    const body = z.object({ grantedCategories: z.array(z.string()).min(1), expiresAt: z.string().optional() }).parse(req.body);
    const request = await prisma.accessRequest.findUnique({ where: { id: req.params.id }, include: { requester: { select: publicUserSelect } } });
    if (!request || request.patientId !== patient.id) throw new ApiError(404, "Access request not found");
    if (request.status !== "PENDING") throw new ApiError(409, `Access request is already ${request.status.toLowerCase()}`);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + request.requestedDurationHours * 60 * 60 * 1000);
    const hash = permissionHash({ patientId: patient.id, granteeUserId: request.requesterUserId, categories: body.grantedCategories, expiresAt: expiresAt.toISOString() });
    const chain = await recordAccessProof({ type: "grant", healthId: patient.healthId, grantee: request.requester.walletAddress ?? "0x0000000000000000000000000000000000000000", permissionHash: hash, expiresAt });
    const permission = await prisma.accessPermission.create({
      data: {
        patientId: patient.id,
        granteeUserId: request.requesterUserId,
        grantedCategories: body.grantedCategories,
        expiresAt,
        permissionHash: hash,
        blockchainTxHash: chain.txHash,
        blockchainStatus: chain.status
      }
    });
    await prisma.accessRequest.update({ where: { id: request.id }, data: { status: "APPROVED", reviewedAt: new Date() } });
    await prisma.notification.create({ data: { userId: request.requesterUserId, title: "Access approved", message: `${patient.user.fullName} approved your access request.`, type: "SUCCESS" } });
    await writeAudit({ actorUserId: req.user!.id, patientId: patient.id, action: "ACCESS_APPROVED", entityType: "AccessPermission", entityId: permission.id, ipAddress: req.ip });
    ok(res, permission, "Access approved");
  })
);

router.post(
  "/requests/:id/reject",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const patient = await patientProfile(req.user!.id);
    const request = await prisma.accessRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.patientId !== patient.id) throw new ApiError(404, "Access request not found");
    if (request.status !== "PENDING") throw new ApiError(409, `Access request is already ${request.status.toLowerCase()}`);
    const updated = await prisma.accessRequest.update({ where: { id: request.id }, data: { status: "REJECTED", reviewedAt: new Date() } });
    ok(res, updated, "Access rejected");
  })
);

router.get(
  "/permissions",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const patient = await patientProfile(req.user!.id);
    ok(res, await prisma.accessPermission.findMany({ where: { patientId: patient.id }, include: { grantee: { select: publicUserSelect } }, orderBy: { grantedAt: "desc" } }));
  })
);

router.post(
  "/permissions/:id/revoke",
  requireRoles(Role.PATIENT),
  asyncHandler(async (req, res) => {
    const patient = await patientProfile(req.user!.id);
    const permission = await prisma.accessPermission.findUnique({ where: { id: req.params.id }, include: { grantee: { select: publicUserSelect } } });
    if (!permission || permission.patientId !== patient.id) throw new ApiError(404, "Permission not found");
    if (permission.status !== "ACTIVE") throw new ApiError(409, `Permission is already ${permission.status.toLowerCase()}`);
    if (permission.expiresAt <= new Date()) throw new ApiError(409, "Permission is already expired");
    const chain = await recordAccessProof({ type: "revoke", healthId: patient.healthId, grantee: permission.grantee.walletAddress ?? "0x0000000000000000000000000000000000000000", permissionHash: permission.permissionHash });
    const updated = await prisma.accessPermission.update({
      where: { id: permission.id },
      data: { status: "REVOKED", revokedAt: new Date(), blockchainStatus: chain.status === BlockchainStatus.FAILED ? BlockchainStatus.FAILED : permission.blockchainStatus, blockchainTxHash: chain.txHash ?? permission.blockchainTxHash }
    });
    await writeAudit({ actorUserId: req.user!.id, patientId: patient.id, action: "ACCESS_REVOKED", entityType: "AccessPermission", entityId: permission.id, ipAddress: req.ip });
    ok(res, updated, "Access revoked");
  })
);

export default router;
