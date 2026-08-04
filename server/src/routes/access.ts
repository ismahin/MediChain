import { Router } from "express";
import { BlockchainStatus, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok, publicUserSelect } from "../utils/api.js";
import { permissionHash, recordAccessProof } from "../services/blockchain.js";
import { writeAudit } from "../services/audit.js";
import { isSupportedAccessCategory } from "../services/access.js";

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
    const body = z.object({
      grantedCategories: z.array(z.string().refine(isSupportedAccessCategory, "Unsupported access category")).min(1),
      expiresAt: z.string().optional()
    }).parse(req.body);
    const request = await prisma.accessRequest.findUnique({ where: { id: req.params.id }, include: { requester: { select: publicUserSelect } } });
    if (!request || request.patientId !== patient.id) throw new ApiError(404, "Access request not found");
    if (request.status !== "PENDING") throw new ApiError(409, `Access request is already ${request.status.toLowerCase()}`);
    const requestedCategories = new Set(request.requestedCategories as string[]);
    const grantedCategories = [...new Set(body.grantedCategories)];
    if (grantedCategories.some((category) => !requestedCategories.has(category))) throw new ApiError(400, "Granted categories must be a subset of the provider's request");
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + request.requestedDurationHours * 60 * 60 * 1000);
    const maximumExpiry = new Date(Date.now() + request.requestedDurationHours * 60 * 60 * 1000);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) throw new ApiError(400, "Access expiry must be a valid future date");
    if (expiresAt > maximumExpiry) throw new ApiError(400, "Access expiry cannot exceed the requested duration");
    const hash = permissionHash({ patientId: patient.id, granteeUserId: request.requesterUserId, categories: grantedCategories, expiresAt: expiresAt.toISOString() });
    let permission = await prisma.$transaction(async (tx) => {
      const claimed = await tx.accessRequest.updateMany({ where: { id: request.id, patientId: patient.id, status: "PENDING" }, data: { status: "APPROVED", reviewedAt: new Date() } });
      if (claimed.count !== 1) throw new ApiError(409, "Access request has already been reviewed");
      const created = await tx.accessPermission.create({
        data: { patientId: patient.id, granteeUserId: request.requesterUserId, grantedCategories, expiresAt, permissionHash: hash }
      });
      await tx.notification.create({ data: { userId: request.requesterUserId, title: "Access approved", message: `${patient.user.fullName} approved your access request.`, type: "SUCCESS" } });
      return created;
    });
    if (request.requester.walletAddress) {
      const chain = await recordAccessProof({ type: "grant", healthId: patient.healthId, grantee: request.requester.walletAddress, permissionHash: hash, expiresAt });
      permission = await prisma.accessPermission.update({ where: { id: permission.id }, data: { blockchainTxHash: chain.txHash, blockchainStatus: chain.status } });
    }
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
    const updated = await prisma.accessRequest.updateMany({ where: { id: request.id, patientId: patient.id, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: new Date() } });
    if (updated.count !== 1) throw new ApiError(409, "Access request has already been reviewed");
    ok(res, await prisma.accessRequest.findUniqueOrThrow({ where: { id: request.id } }), "Access rejected");
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
    if (permission.expiresAt <= new Date()) {
      await prisma.accessPermission.update({ where: { id: permission.id }, data: { status: "EXPIRED" } });
      throw new ApiError(409, "Permission is already expired");
    }
    const chain = permission.grantee.walletAddress
      ? await recordAccessProof({ type: "revoke", healthId: patient.healthId, grantee: permission.grantee.walletAddress, permissionHash: permission.permissionHash })
      : { status: permission.blockchainStatus, txHash: undefined };
    const updated = await prisma.accessPermission.update({
      where: { id: permission.id },
      data: { status: "REVOKED", revokedAt: new Date(), blockchainStatus: chain.status === BlockchainStatus.FAILED ? BlockchainStatus.FAILED : permission.blockchainStatus, blockchainTxHash: chain.txHash ?? permission.blockchainTxHash }
    });
    await writeAudit({ actorUserId: req.user!.id, patientId: patient.id, action: "ACCESS_REVOKED", entityType: "AccessPermission", entityId: permission.id, ipAddress: req.ip });
    ok(res, updated, "Access revoked");
  })
);

export default router;
