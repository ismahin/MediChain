import { BlockchainStatus, TransactionStatus, TransactionType } from "@prisma/client";
import { Contract, Interface, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { mediChainAbi } from "../blockchain/abi.js";
import { sha256Bytes32, sha256Hex, stableStringify } from "../utils/hash.js";

const recordTypes: Record<string, number> = { CONSULTATION: 1, PRESCRIPTION: 2, LAB_REPORT: 3, ADMISSION: 4, DISCHARGE: 4, SURGERY: 5, VACCINATION: 6, DOCUMENT: 7 };

export function recordTypeCode(recordType: string) {
  return recordTypes[recordType] ?? 0;
}

function configured() {
  return Boolean(env.RPC_URL && env.BLOCKCHAIN_PRIVATE_KEY && env.CONTRACT_ADDRESS && env.CHAIN_ID);
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
  return {
    contractAddress: env.CONTRACT_ADDRESS,
    chainId: env.CHAIN_ID,
    network: {
      name: env.BLOCKCHAIN_NETWORK_NAME,
      rpcUrl: env.BLOCKCHAIN_PUBLIC_RPC_URL ?? env.RPC_URL,
      explorerUrl: env.BLOCKCHAIN_EXPLORER_URL,
      nativeCurrency: { name: env.BLOCKCHAIN_CURRENCY_NAME, symbol: env.BLOCKCHAIN_CURRENCY_SYMBOL, decimals: env.BLOCKCHAIN_CURRENCY_DECIMALS }
    },
    method: "registerRecord" as const,
    args: [patientIdHash(record.patient.healthId), `0x${record.fileHash}`, `0x${record.metadataHash}`, recordTypeCode(record.recordType)]
  };
}

type ReconcileRecord = {
  id: string;
  fileHash: string;
  metadataHash: string;
  recordType: string;
  blockchainStatus: BlockchainStatus;
  blockchainTxHash: string | null;
  patient: { healthId: string };
};

async function blockNearTimestamp(provider: JsonRpcProvider, timestamp: number) {
  let low = 0;
  let high = await provider.getBlockNumber();
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const block = await provider.getBlock(middle);
    if (!block || block.timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Makes record anchoring idempotent when a transaction succeeded on-chain but
 * the browser never completed the database confirmation request.
 */
export async function reconcileExistingRecordProof(record: ReconcileRecord) {
  if (!env.RPC_URL || !env.CONTRACT_ADDRESS || !env.CHAIN_ID) return null;

  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID);
  const contract = new Contract(env.CONTRACT_ADDRESS, mediChainAbi, provider);
  const expectedPatientHash = patientIdHash(record.patient.healthId).toLowerCase();
  const expectedRecordHash = `0x${record.fileHash}`.toLowerCase();
  const expectedMetadataHash = `0x${record.metadataHash}`.toLowerCase();
  const expectedRecordType = recordTypeCode(record.recordType);
  const proof = await contract.verifyRecord(expectedRecordHash);
  if (!Boolean(proof.exists)) return null;

  if (String(proof.patientIdHash).toLowerCase() !== expectedPatientHash || Number(proof.recordType) !== expectedRecordType || !Boolean(proof.active)) {
    throw new Error("This record hash is already used by a different or inactive blockchain proof.");
  }

  let txHash = record.blockchainTxHash;
  let blockNumber: number | null = null;
  try {
    const iface = new Interface(mediChainAbi);
    const event = iface.getEvent("RecordRegistered");
    if (!event) throw new Error("RecordRegistered event is missing from the contract interface.");
    const latestBlock = await provider.getBlockNumber();
    const approximateBlock = await blockNearTimestamp(provider, Number(proof.timestamp));
    const logs = await provider.getLogs({
      address: env.CONTRACT_ADDRESS,
      topics: [event.topicHash, expectedPatientHash, expectedRecordHash],
      // Public RPC providers commonly restrict historical log ranges, so
      // locate the event by timestamp instead of scanning the entire chain.
      fromBlock: Math.max(0, approximateBlock - 500),
      toBlock: Math.min(latestBlock, approximateBlock + 500)
    });
    if (logs.length > 0) {
      const matchingLog = logs.find((log) => {
        const parsed = iface.parseLog(log);
        return parsed && String(parsed.args.metadataHash).toLowerCase() === expectedMetadataHash && Number(parsed.args.recordType) === expectedRecordType;
      });
      if (!matchingLog) throw new Error("The existing blockchain proof has different record metadata.");
      txHash = matchingLog.transactionHash;
      blockNumber = matchingLog.blockNumber;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("different record metadata")) throw error;
    // Some RPC providers restrict historical log queries. The contract's
    // record mapping above still proves the hash, patient, type, and state.
  }

  const blockchainTimestamp = Number(proof.timestamp) > 0 ? new Date(Number(proof.timestamp) * 1000) : new Date();
  await prisma.$transaction(async (database) => {
    await database.medicalRecord.update({
      where: { id: record.id },
      data: {
        blockchainStatus: record.blockchainStatus === BlockchainStatus.VERIFIED ? BlockchainStatus.VERIFIED : BlockchainStatus.ANCHORED,
        blockchainTxHash: txHash,
        blockchainBlockNumber: blockNumber,
        blockchainTimestamp,
        blockchainError: null
      }
    });
    if (txHash) {
      const transaction = await database.blockchainTransaction.findFirst({ where: { txHash } });
      if (transaction) {
        await database.blockchainTransaction.update({ where: { id: transaction.id }, data: { recordId: record.id, blockNumber, status: TransactionStatus.CONFIRMED, confirmedAt: blockchainTimestamp, errorMessage: null } });
      } else {
        await database.blockchainTransaction.create({ data: { recordId: record.id, transactionType: TransactionType.RECORD, txHash, blockNumber, network: String(env.CHAIN_ID), status: TransactionStatus.CONFIRMED, confirmedAt: blockchainTimestamp } });
      }
    }
  });

  return { alreadyAnchored: true as const, txHash, blockNumber, timestamp: blockchainTimestamp };
}

export async function confirmWalletRecordTransaction(recordId: string, txHash: string) {
  if (!env.RPC_URL || !env.CONTRACT_ADDRESS || !env.CHAIN_ID) throw new Error("Blockchain RPC, contract address, and chain ID are not configured");
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
  const expectedRecordType = recordTypeCode(record.recordType);
  const event = receipt.logs
    .filter((log) => getAddress(log.address) === getAddress(env.CONTRACT_ADDRESS!))
    .map((log) => { try { return iface.parseLog(log); } catch { return null; } })
    .find((log) => log?.name === "RecordRegistered" && String(log.args.patientIdHash).toLowerCase() === expectedPatient && String(log.args.recordHash).toLowerCase() === expectedRecord && String(log.args.metadataHash).toLowerCase() === expectedMetadata && Number(log.args.recordType) === expectedRecordType);
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
  const contract = getContract();
  if (!contract || !env.CHAIN_ID) {
    return { status: BlockchainStatus.PENDING, error: "Blockchain not configured" };
  }
  const txLog = await prisma.blockchainTransaction.create({
    data: { recordId: input.recordId, transactionType: TransactionType.RECORD, network: String(env.CHAIN_ID), status: TransactionStatus.PENDING }
  });

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
