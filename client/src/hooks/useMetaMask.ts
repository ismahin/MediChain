import { BrowserProvider, Contract, Interface } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { api, unwrap } from "../api/client";
import { useSystemConfig } from "../contexts/SystemConfigContext";

declare global {
  interface Window {
    ethereum?: {
      request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

type PreparedProof =
  | { alreadyAnchored: true; txHash?: string | null; blockNumber?: number | null }
  | { alreadyAnchored: false; contractAddress: string; chainId: number; network: WalletNetwork; method: "registerRecord"; args: [string, string, string, number] };

type WalletNetwork = {
  name: string;
  rpcUrl: string;
  explorerUrl?: string | null;
  nativeCurrency: { name: string; symbol: string; decimals: number };
};

const recordContractAbi = [
  "error RecordAlreadyExists(bytes32 recordHash)",
  "error InvalidHash()",
  "error InvalidRecordType()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "function registerRecord(bytes32 patientIdHash, bytes32 recordHash, bytes32 metadataHash, uint8 recordType)",
  "function PROVIDER_ROLE() view returns (bytes32)",
  "function SYSTEM_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)"
] as const;

const recordContractInterface = new Interface(recordContractAbi);

function errorCode(error: unknown): number {
  if (typeof error !== "object" || !error) return 0;
  const candidate = error as { code?: unknown; error?: unknown; info?: { error?: unknown } };
  const ownCode = Number(candidate.code);
  return Number.isFinite(ownCode) ? ownCode : errorCode(candidate.error) || errorCode(candidate.info?.error);
}

function errorData(error: unknown): string | undefined {
  if (typeof error !== "object" || !error) return undefined;
  const candidate = error as { data?: unknown; error?: unknown; info?: { error?: unknown } };
  if (typeof candidate.data === "string" && candidate.data.startsWith("0x")) return candidate.data;
  return errorData(candidate.error) ?? errorData(candidate.info?.error);
}

function contractErrorName(error: unknown) {
  const data = errorData(error);
  if (!data) return undefined;
  try { return recordContractInterface.parseError(data)?.name; }
  catch { return undefined; }
}

function walletError(error: unknown) {
  if (errorCode(error) === 4001) return "Transaction rejected in MetaMask. No blockchain changes were made.";
  const customError = contractErrorName(error);
  if (customError === "RecordAlreadyExists") return "This medical record is already secured on the blockchain.";
  if (customError === "InvalidHash") return "The record proof is incomplete. Refresh the page and create the record again if needed.";
  if (customError === "InvalidRecordType") return "This medical record type cannot be anchored on the blockchain.";
  if (customError === "AccessControlUnauthorizedAccount") return "This wallet is not authorized as a MediChain provider. Ask an administrator to authorize it, or connect the authorized wallet.";

  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (normalized.includes("insufficient funds")) return "This wallet does not have enough network funds to submit the transaction.";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "Blockchain confirmation timed out. The record is saved; refresh its status before retrying the anchor.";
  if (normalized.includes("user rejected") || normalized.includes("action_rejected")) return "Transaction rejected in MetaMask. No blockchain changes were made.";
  if (normalized.includes("network") && (normalized.includes("changed") || normalized.includes("unsupported") || normalized.includes("unavailable"))) return "The configured blockchain network is unavailable. Check MetaMask's network and try again.";
  if (message && !normalized.includes("execution reverted") && !normalized.includes("estimategas") && !normalized.includes("call_exception")) return message;
  return "The blockchain could not accept this transaction. Refresh the record status and try again.";
}

export type MetaMaskWallet = ReturnType<typeof useMetaMask>;

export function useMetaMask() {
  const { config } = useSystemConfig();
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const switchNetwork = useCallback(async (chainId: bigint, network: WalletNetwork) => {
    if (!window.ethereum) throw new Error("MetaMask is not installed.");
    const chainIdHex = `0x${chainId.toString(16)}`;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (switchError) {
      const code = typeof switchError === "object" && switchError && "code" in switchError ? Number((switchError as { code: unknown }).code) : 0;
      if (code !== 4902) throw switchError;
      if (!network.rpcUrl) throw new Error("The blockchain RPC URL is not configured.");
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: chainIdHex, chainName: network.name, nativeCurrency: network.nativeCurrency, rpcUrls: [network.rpcUrl], ...(network.explorerUrl ? { blockExplorerUrls: [network.explorerUrl] } : {}) }] });
    }
  }, []);

  const connect = useCallback(async () => {
    setError("");
    if (!window.ethereum) { setError("MetaMask is not installed. Install the extension and refresh this page."); return ""; }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const account = accounts[0] ?? "";
      setAddress(account);
      return account;
    } catch (cause) { const message = walletError(cause); setError(message); throw new Error(message); }
  }, []);

  const disconnect = useCallback(async () => {
    setError("");
    try {
      await window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      setError("Wallet disconnected from MediChain locally. If it reconnects after a refresh, remove MediChain from MetaMask's connected sites.");
    } finally {
      setAddress("");
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const accountsChanged = (...args: unknown[]) => setAddress(((args[0] as string[] | undefined)?.[0]) ?? "");
    const chainChanged = () => window.location.reload();
    window.ethereum.on?.("accountsChanged", accountsChanged);
    window.ethereum.on?.("chainChanged", chainChanged);
    void window.ethereum.request({ method: "eth_accounts" }).then((accounts) => setAddress(((accounts as string[])[0]) ?? ""));
    return () => { window.ethereum?.removeListener?.("accountsChanged", accountsChanged); window.ethereum?.removeListener?.("chainChanged", chainChanged); };
  }, []);

  async function anchorRecord(recordId: string) {
    setBusy(true); setError("");
    try {
      if (!window.ethereum) throw new Error("MetaMask is not installed.");
      const proof = await unwrap<PreparedProof>(api.get(`/blockchain/records/${recordId}/prepare`));
      if (proof.alreadyAnchored) return proof.txHash ?? "";
      const account = address || await connect();
      if (!account) throw new Error("Connect a MetaMask account to continue.");
      const provider = new BrowserProvider(window.ethereum);
      if ((await provider.getNetwork()).chainId !== BigInt(proof.chainId)) await switchNetwork(BigInt(proof.chainId), proof.network);
      const activeProvider = new BrowserProvider(window.ethereum);
      if (await activeProvider.getCode(proof.contractAddress) === "0x") throw new Error("The MediChain contract is not deployed on the selected MetaMask network.");
      const signer = await activeProvider.getSigner();
      const contract = new Contract(proof.contractAddress, recordContractAbi, signer);
      const [providerRole, adminRole] = await Promise.all([contract.PROVIDER_ROLE(), contract.SYSTEM_ADMIN_ROLE()]);
      const [isProvider, isAdmin] = await Promise.all([contract.hasRole(providerRole, account), contract.hasRole(adminRole, account)]);
      if (!isProvider && !isAdmin) throw new Error("This wallet is not authorized as a MediChain provider. Ask an administrator to authorize it, or connect the authorized wallet.");
      try {
        const transaction = await contract.registerRecord(...proof.args);
        await transaction.wait(1, Number(import.meta.env.VITE_BLOCKCHAIN_CONFIRMATION_TIMEOUT_MS || 120000));
        await unwrap(api.post(`/blockchain/records/${recordId}/confirm`, { txHash: transaction.hash }));
        return transaction.hash as string;
      } catch (cause) {
        // Handles a race where another browser anchored the proof after the
        // initial server check but before MetaMask estimated this transaction.
        if (contractErrorName(cause) === "RecordAlreadyExists") {
          const reconciled = await unwrap<PreparedProof>(api.get(`/blockchain/records/${recordId}/prepare`));
          if (reconciled.alreadyAnchored) return reconciled.txHash ?? "";
        }
        throw cause;
      }
    } catch (cause) { const message = walletError(cause); setError(message); throw new Error(message); }
    finally { setBusy(false); }
  }

  return { address, error, busy, connect, disconnect, anchorRecord, blockchainConfigured: Boolean(config?.blockchain.configured) };
}
