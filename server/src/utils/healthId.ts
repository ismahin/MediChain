import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";

export async function generateHealthId() {
  const year = new Date().getUTCFullYear();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const healthId = `${env.HEALTH_ID_PREFIX}-${year}-${suffix}`;
    const existing = await prisma.patientProfile.findUnique({ where: { healthId }, select: { id: true } });
    if (!existing) return healthId;
  }
  throw new Error("Could not allocate a unique Health ID");
}
