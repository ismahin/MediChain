import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().default(5000),
  JWT_SECRET: z.string().default("dev_only_replace_with_long_random_secret"),
  JWT_REFRESH_SECRET: z.string().default("dev_only_replace_with_long_random_refresh_secret"),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("./uploads"),
  RPC_URL: z.string().optional(),
  BLOCKCHAIN_PRIVATE_KEY: z.string().optional(),
  CONTRACT_ADDRESS: z.string().optional(),
  CHAIN_ID: z.coerce.number().default(11155111)
});

export const env = envSchema.parse(process.env);
