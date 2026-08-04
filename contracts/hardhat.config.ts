import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
import path from "path";
import type { HardhatUserConfig } from "hardhat/config";

dotenv.config({ path: path.resolve(__dirname, "../server/.env") });
dotenv.config({ path: path.resolve(__dirname, ".env"), override: true });

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.BLOCKCHAIN_PRIVATE_KEY;
const configuredRpcUrl = process.env.BLOCKCHAIN_DEPLOY_RPC_URL || process.env.RPC_URL;
const configuredChainId = Number(process.env.BLOCKCHAIN_DEPLOY_CHAIN_ID || process.env.CHAIN_ID);

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
      url: process.env.LOCAL_BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545"
    },
    ...(configuredRpcUrl && Number.isInteger(configuredChainId) && configuredChainId > 0 ? {
      configured: { url: configuredRpcUrl, accounts: deployerKey ? [deployerKey] : [], chainId: configuredChainId }
    } : {})
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ""
  }
};

export default config;
