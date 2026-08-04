import { Router } from "express";
import { env, demoAccounts } from "../config/env.js";
import { ACCESS_CATEGORIES, PROVIDER_ACCESS_CATEGORIES } from "../services/access.js";
import { ok } from "../utils/api.js";

const router = Router();

router.get("/", (_req, res) => {
  const blockchainConfigured = Boolean(env.RPC_URL && env.CONTRACT_ADDRESS && env.CHAIN_ID);
  ok(res, {
    appName: env.APP_NAME,
    environment: env.NODE_ENV,
    demoMode: env.DEMO_MODE,
    demoAccounts: env.DEMO_MODE ? demoAccounts : [],
    blockchain: {
      configured: blockchainConfigured,
      networkName: env.BLOCKCHAIN_NETWORK_NAME,
      chainId: env.CHAIN_ID ?? null,
      rpcUrl: env.BLOCKCHAIN_PUBLIC_RPC_URL ?? env.RPC_URL ?? null,
      explorerUrl: env.BLOCKCHAIN_EXPLORER_URL ?? null,
      nativeCurrency: {
        name: env.BLOCKCHAIN_CURRENCY_NAME,
        symbol: env.BLOCKCHAIN_CURRENCY_SYMBOL,
        decimals: env.BLOCKCHAIN_CURRENCY_DECIMALS
      }
    },
    access: {
      categories: Object.values(ACCESS_CATEGORIES),
      roleCategories: PROVIDER_ACCESS_CATEGORIES,
      maxDurationHours: env.MAX_ACCESS_DURATION_HOURS
    },
    uploads: { maxBytes: env.UPLOAD_MAX_BYTES, storage: "server-managed off-chain storage" }
  });
});

export default router;
