import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { ApiError } from "../utils/api.js";

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.path}`));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.flatten().fieldErrors
    });
  }

  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({ success: false, message: "That value is already registered. Please use a different email or identifier." });
  }

  console.error(error);
  return res.status(500).json({ success: false, message: "Internal server error" });
}
