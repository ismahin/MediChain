import type { Response } from "express";

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
