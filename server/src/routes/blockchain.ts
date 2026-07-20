import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ApiError, ok } from "../utils/api.js";
import { hasPatientAccess } from "../services/access.js";
import { anchorRecord, confirmWalletRecordTransaction, recordProofInput } from "../services/blockchain.js";
import { z } from "zod";

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

router.get(
  "/records/:id/prepare",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id }, include: { patient: true } });
    if (!record) throw new ApiError(404, "Record not found");
    if (record.creatorUserId !== req.user!.id && req.user!.role !== Role.ADMIN) throw new ApiError(403, "Only the record creator or an administrator can anchor it");
    const input = recordProofInput(record);
    if (!input.contractAddress) throw new ApiError(503, "Blockchain contract is not configured");
    ok(res, input);
  })
);

router.post(
  "/records/:id/confirm",
  asyncHandler(async (req, res) => {
    const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.id } });
    if (!record) throw new ApiError(404, "Record not found");
    if (record.creatorUserId !== req.user!.id && req.user!.role !== Role.ADMIN) throw new ApiError(403, "Only the record creator or an administrator can confirm it");
    const { txHash } = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(req.body);
    try { ok(res, await confirmWalletRecordTransaction(record.id, txHash), "Blockchain proof confirmed"); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Could not validate blockchain transaction"); }
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
