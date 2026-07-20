import { BrowserProvider, Contract } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { api, unwrap } from "../api/client";

declare global {
  interface Window {
    ethereum?: {
      request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

type PreparedProof = { contractAddress: string; chainId: number; method: "registerRecord"; args: [string, string, string, number] };

function walletError(error: unknown) {
  if (typeof error === "object" && error && "code" in error && Number((error as { code: unknown }).code) === 4001) return "Transaction rejected in MetaMask.";
  return error instanceof Error ? error.message : "MetaMask transaction failed.";
}

export type MetaMaskWallet = ReturnType<typeof useMetaMask>;

export function useMetaMask() {
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const switchNetwork = useCallback(async (chainId: bigint) => {
    if (!window.ethereum) throw new Error("MetaMask is not installed.");
    const chainIdHex = `0x${chainId.toString(16)}`;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (switchError) {
      const code = typeof switchError === "object" && switchError && "code" in switchError ? Number((switchError as { code: unknown }).code) : 0;
      if (code !== 4902) throw switchError;
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: chainIdHex, chainName: "SKALE Base Sepolia", nativeCurrency: { name: "CREDIT", symbol: "CREDIT", decimals: 18 }, rpcUrls: ["https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha"], blockExplorerUrls: ["https://base-sepolia-testnet-explorer.skalenodes.com"] }] });
    }
  }, []);

  const connect = useCallback(async () => {
    setError("");
    if (!window.ethereum) { setError("MetaMask is not installed. Install the extension and refresh this page."); return ""; }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const required = BigInt(import.meta.env.VITE_CHAIN_ID ?? 324705682);
      const provider = new BrowserProvider(window.ethereum);
      if ((await provider.getNetwork()).chainId !== required) await switchNetwork(required);
      const account = accounts[0] ?? "";
      setAddress(account);
      return account;
    } catch (cause) { const message = walletError(cause); setError(message); throw new Error(message); }
  }, [switchNetwork]);

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
      const account = address || await connect();
      if (!account) throw new Error("Connect a MetaMask account to continue.");
      const provider = new BrowserProvider(window.ethereum);
      if ((await provider.getNetwork()).chainId !== BigInt(proof.chainId)) await switchNetwork(BigInt(proof.chainId));
      const signer = await new BrowserProvider(window.ethereum).getSigner();
      const contract = new Contract(proof.contractAddress, ["function registerRecord(bytes32,bytes32,bytes32,uint8)"], signer);
      const transaction = await contract.registerRecord(...proof.args);
      await transaction.wait(1);
      await unwrap(api.post(`/blockchain/records/${recordId}/confirm`, { txHash: transaction.hash }));
      return transaction.hash as string;
    } catch (cause) { const message = walletError(cause); setError(message); throw new Error(message); }
    finally { setBusy(false); }
  }

  return { address, error, busy, connect, anchorRecord };
}
