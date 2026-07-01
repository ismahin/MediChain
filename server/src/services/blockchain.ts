import { BlockchainStatus, TransactionStatus, TransactionType } from "@prisma/client";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
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
