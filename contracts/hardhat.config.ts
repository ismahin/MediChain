import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
import path from "path";
import type { HardhatUserConfig } from "hardhat/config";

dotenv.config({ path: path.resolve(__dirname, "../server/.env") });
dotenv.config({ path: path.resolve(__dirname, ".env"), override: true });

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.BLOCKCHAIN_PRIVATE_KEY;
const skaleBaseSepoliaRpcUrl =
  process.env.SKALE_BASE_SEPOLIA_RPC_URL ||
  "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: deployerKey ? [deployerKey] : [],
      chainId: 11155111
    },
    skaleBaseSepolia: {
      url: skaleBaseSepoliaRpcUrl,
      accounts: deployerKey ? [deployerKey] : [],
      chainId: 324705682
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ""
  }
};

export default config;
