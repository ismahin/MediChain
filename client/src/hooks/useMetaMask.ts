import { BrowserProvider } from "ethers";
import { useState } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export function useMetaMask() {
  const [address, setAddress] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function connect() {
    setError("");
    if (!window.ethereum) {
      setError("MetaMask is not installed.");
      return;
    }
    const provider = new BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    const required = BigInt(import.meta.env.VITE_CHAIN_ID ?? 11155111);
    if (network.chainId !== required) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      } catch {
        setError("Please switch MetaMask to Ethereum Sepolia.");
        return;
      }
    }
    const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    setAddress(accounts[0] ?? "");
  }

  return { address, error, connect };
}
