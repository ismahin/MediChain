import type { Response } from "express";
import type { Prisma } from "@prisma/client";

export const publicUserSelect = {
  id: true, fullName: true, email: true, phone: true, role: true,
  walletAddress: true, isActive: true, createdAt: true, updatedAt: true
} satisfies Prisma.UserSelect;

export const patientSummarySelect = {
  id: true,
  healthId: true,
  user: { select: { id: true, fullName: true, email: true } }
} satisfies Prisma.PatientProfileSelect;

export function ok<T>(res: Response, data: T, message = "OK") {
  return res.json({ success: true, message, data });
}

export class ApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function toPublicUser(user: {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  walletAddress: string | null;
  isActive: boolean;
}) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    walletAddress: user.walletAddress,
    isActive: user.isActive
  };
}

export function withoutStoragePath<T extends { filePath?: unknown }>(record: T) {
  const { filePath: _filePath, ...safe } = record;
  return safe;
}
