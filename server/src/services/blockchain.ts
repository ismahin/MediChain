import { BlockchainStatus, TransactionStatus, TransactionType } from "@prisma/client";
import { Contract, Interface, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { mediChainAbi } from "../blockchain/abi.js";
import { sha256Bytes32, sha256Hex, stableStringify } from "../utils/hash.js";

function configured() {
  return Boolean(env.RPC_URL && env.BLOCKCHAIN_PRIVATE_KEY && env.CONTRACT_ADDRESS);
}

function getContract() {
  if (!configured()) return null;
  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID);
  const wallet = new Wallet(env.BLOCKCHAIN_PRIVATE_KEY!, provider);
  return new Contract(env.CONTRACT_ADDRESS!, mediChainAbi, wallet);
}

export function patientIdHash(healthId: string) {
  return sha256Bytes32(`MEDICHAIN_PATIENT:${healthId}`);
}

export function permissionHash(input: unknown) {
  return sha256Hex(stableStringify(input));
}

export function recordProofInput(record: { patient: { healthId: string }; fileHash: string; metadataHash: string; recordType: string }) {
  const recordTypes: Record<string, number> = { CONSULTATION: 1, PRESCRIPTION: 2, LAB_REPORT: 3, ADMISSION: 4, DISCHARGE: 4, SURGERY: 5, VACCINATION: 6, DOCUMENT: 7 };
  return {
    contractAddress: env.CONTRACT_ADDRESS,
    chainId: env.CHAIN_ID,
    method: "registerRecord" as const,
    args: [patientIdHash(record.patient.healthId), `0x${record.fileHash}`, `0x${record.metadataHash}`, recordTypes[record.recordType] ?? 0]
  };
}

export async function confirmWalletRecordTransaction(recordId: string, txHash: string) {
  if (!env.RPC_URL || !env.CONTRACT_ADDRESS) throw new Error("Blockchain RPC and contract address are not configured");
  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID);
  const [record, receipt, transaction] = await Promise.all([
    prisma.medicalRecord.findUnique({ where: { id: recordId }, include: { patient: true } }),
    provider.getTransactionReceipt(txHash),
    provider.getTransaction(txHash)
  ]);
  if (!record) throw new Error("Medical record not found");
  if (!receipt || !transaction) throw new Error("Transaction is not mined yet");
  if (receipt.status !== 1) throw new Error("Blockchain transaction reverted");
  if (!transaction.to || getAddress(transaction.to) !== getAddress(env.CONTRACT_ADDRESS)) throw new Error("Transaction was sent to an unexpected contract");

  const iface = new Interface(mediChainAbi);
  const expectedPatient = patientIdHash(record.patient.healthId).toLowerCase();
  const expectedRecord = `0x${record.fileHash}`.toLowerCase();
  const expectedMetadata = `0x${record.metadataHash}`.toLowerCase();
  const event = receipt.logs
    .filter((log) => getAddress(log.address) === getAddress(env.CONTRACT_ADDRESS!))
    .map((log) => { try { return iface.parseLog(log); } catch { return null; } })
    .find((log) => log?.name === "RecordRegistered" && String(log.args.patientIdHash).toLowerCase() === expectedPatient && String(log.args.recordHash).toLowerCase() === expectedRecord && String(log.args.metadataHash).toLowerCase() === expectedMetadata);
  if (!event) throw new Error("Receipt does not contain the expected RecordRegistered proof");

  const block = await provider.getBlock(receipt.blockNumber);
  const timestamp = block ? new Date(block.timestamp * 1000) : new Date();
  const existing = await prisma.blockchainTransaction.findFirst({ where: { txHash } });
  if (existing) await prisma.blockchainTransaction.update({ where: { id: existing.id }, data: { recordId, blockNumber: receipt.blockNumber, status: TransactionStatus.CONFIRMED, confirmedAt: timestamp, errorMessage: null } });
  else await prisma.blockchainTransaction.create({ data: { recordId, transactionType: TransactionType.RECORD, txHash, blockNumber: receipt.blockNumber, network: String(env.CHAIN_ID), status: TransactionStatus.CONFIRMED, confirmedAt: timestamp } });
  return prisma.medicalRecord.update({ where: { id: recordId }, data: { blockchainStatus: BlockchainStatus.ANCHORED, blockchainTxHash: txHash, blockchainBlockNumber: receipt.blockNumber, blockchainTimestamp: timestamp, blockchainError: null } });
}

export async function anchorRecord(input: {
  recordId: string;
  healthId: string;
  fileHash: string;
  metadataHash: string;
  recordType: number;
}) {
  const txLog = await prisma.blockchainTransaction.create({
    data: { recordId: input.recordId, transactionType: TransactionType.RECORD, status: TransactionStatus.PENDING }
  });

  const contract = getContract();
  if (!contract) {
    await prisma.blockchainTransaction.update({
      where: { id: txLog.id },
      data: { status: TransactionStatus.FAILED, errorMessage: "Blockchain not configured. Fill RPC_URL, private key, and contract address." }
    });
    return { status: BlockchainStatus.PENDING, error: "Blockchain not configured" };
  }

  try {
    const tx = await contract.registerRecord(patientIdHash(input.healthId), `0x${input.fileHash}`, `0x${input.metadataHash}`, input.recordType);
    await prisma.blockchainTransaction.update({ where: { id: txLog.id }, data: { txHash: tx.hash } });
    const receipt = await tx.wait(1);
    await prisma.blockchainTransaction.update({
      where: { id: txLog.id },
      data: {
        status: TransactionStatus.CONFIRMED,
        blockNumber: Number(receipt.blockNumber),
        confirmedAt: new Date()
      }
    });
    return {
      status: BlockchainStatus.ANCHORED,
      txHash: tx.hash as string,
      blockNumber: Number(receipt.blockNumber),
      timestamp: new Date()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blockchain transaction failed";
    await prisma.blockchainTransaction.update({ where: { id: txLog.id }, data: { status: TransactionStatus.FAILED, errorMessage: message } });
    return { status: BlockchainStatus.FAILED, error: message };
  }
}

export async function recordAccessProof(input: {
  type: "grant" | "revoke";
  healthId: string;
  grantee: string;
  permissionHash: string;
  expiresAt?: Date;
}) {
  const contract = getContract();
  if (!contract) return { status: BlockchainStatus.PENDING, error: "Blockchain not configured" };
  try {
    const tx =
      input.type === "grant"
        ? await contract.grantAccess(patientIdHash(input.healthId), input.grantee, `0x${input.permissionHash}`, Math.floor(input.expiresAt!.getTime() / 1000))
        : await contract.revokeAccess(patientIdHash(input.healthId), input.grantee, `0x${input.permissionHash}`);
    const receipt = await tx.wait(1);
    return { status: BlockchainStatus.ANCHORED, txHash: tx.hash as string, blockNumber: Number(receipt.blockNumber) };
  } catch (error) {
    return { status: BlockchainStatus.FAILED, error: error instanceof Error ? error.message : "Blockchain transaction failed" };
  }
}

export async function verifyOnChain(fileHash: string) {
  const contract = getContract();
  if (!contract) return { configured: false, exists: false };
  const result = await contract.verifyRecord(`0x${fileHash}`);
  return { configured: true, exists: Boolean(result.exists), active: Boolean(result.active), creator: result.creator as string };
}
