import "dotenv/config";
import { z } from "zod";

const booleanFromEnvironment = z.enum(["true", "false"]).default("false").transform((value) => value === "true");

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  APP_NAME: z.string().min(1).default("MediChain"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("./uploads"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  LOGIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  LOGIN_RATE_MAX: z.coerce.number().int().positive().default(10),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  HEALTH_ID_PREFIX: z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/).default("MCH"),
  ADMIN_LIST_LIMIT: z.coerce.number().int().min(1).max(1000).default(200),
  MAX_ACCESS_DURATION_HOURS: z.coerce.number().int().min(1).default(720),
  RPC_URL: z.string().optional(),
  BLOCKCHAIN_PUBLIC_RPC_URL: z.string().optional(),
  BLOCKCHAIN_PRIVATE_KEY: z.string().optional(),
  CONTRACT_ADDRESS: z.string().optional(),
  CHAIN_ID: z.coerce.number().int().positive().optional(),
  BLOCKCHAIN_NETWORK_NAME: z.string().default("Configured blockchain network"),
  BLOCKCHAIN_EXPLORER_URL: z.string().optional(),
  BLOCKCHAIN_CURRENCY_NAME: z.string().default("Native token"),
  BLOCKCHAIN_CURRENCY_SYMBOL: z.string().default("TOKEN"),
  BLOCKCHAIN_CURRENCY_DECIMALS: z.coerce.number().int().min(0).max(255).default(18),
  DEMO_MODE: booleanFromEnvironment,
  DEMO_ACCOUNTS_JSON: z.string().default("[]")
});

export const env = envSchema.parse(process.env);

const demoAccountSchema = z.array(z.object({
  role: z.enum(["ADMIN", "PATIENT", "DOCTOR", "HOSPITAL", "LABORATORY"]),
  email: z.string().email(),
  password: z.string().min(8)
}));

export const demoAccounts = (() => {
  if (!env.DEMO_MODE) return [];
  try { return demoAccountSchema.parse(JSON.parse(env.DEMO_ACCOUNTS_JSON)); }
  catch { throw new Error("DEMO_ACCOUNTS_JSON must be a valid JSON array of role, email, and password objects"); }
})();
