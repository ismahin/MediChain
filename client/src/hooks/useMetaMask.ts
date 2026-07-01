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
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      const required = BigInt(import.meta.env.VITE_CHAIN_ID ?? 324705682);
      const requiredHex = `0x${required.toString(16)}`;
      if (network.chainId !== required) {
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: requiredHex }] });
        } catch (switchError) {
          const code = typeof switchError === "object" && switchError && "code" in switchError ? Number((switchError as { code: unknown }).code) : 0;
          if (code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: requiredHex,
                chainName: "SKALE Base Sepolia",
                nativeCurrency: { name: "CREDIT", symbol: "CREDIT", decimals: 18 },
                rpcUrls: ["https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha"],
                blockExplorerUrls: ["https://base-sepolia-testnet-explorer.skalenodes.com"]
              }]
            });
          } else {
            throw switchError;
          }
        }
      }
      setAddress(accounts[0] ?? "");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "MetaMask connection failed.");
    }
  }

  return { address, error, connect };
}
