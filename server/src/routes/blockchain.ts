import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok } from "../utils/api.js";
import { hasPatientAccess } from "../services/access.js";
import { anchorRecord } from "../services/blockchain.js";

const router = Router();
router.use(authenticate);

router.get(
  "/records/:id",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id }, include: { transactions: true } });
    if (!record) throw new ApiError(404, "Record not found");
    if (!(await hasPatientAccess(req.user!.id, record.patientId, record.recordType))) throw new ApiError(403, "No permission for this blockchain record");
    ok(res, record);
  })
);

router.post(
  "/records/:id/retry-anchor",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id }, include: { patient: true } });
    if (!record) throw new ApiError(404, "Record not found");
    const chain = await anchorRecord({ recordId: record.id, healthId: record.patient.healthId, fileHash: record.fileHash, metadataHash: record.metadataHash, recordType: 0 });
    const updated = await prisma.medicalRecord.update({ where: { id: record.id }, data: { blockchainStatus: chain.status, blockchainTxHash: chain.txHash, blockchainBlockNumber: chain.blockNumber, blockchainTimestamp: chain.timestamp, blockchainError: chain.error } });
    ok(res, updated, "Blockchain anchoring retried");
  })
);

router.get(
  "/transactions",
  requireRoles(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    ok(res, await prisma.blockchainTransaction.findMany({ include: { record: true }, orderBy: { createdAt: "desc" } }));
  })
);

router.get(
  "/verify/:recordId",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.recordId } });
    if (!record) throw new ApiError(404, "Record not found");
    if (!(await hasPatientAccess(req.user!.id, record.patientId, record.recordType))) throw new ApiError(403, "No permission for this record");
    ok(res, { fileHash: record.fileHash, metadataHash: record.metadataHash, status: record.blockchainStatus, txHash: record.blockchainTxHash, blockNumber: record.blockchainBlockNumber });
  })
);

export default router;
