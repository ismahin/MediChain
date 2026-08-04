import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { ApiError } from "../utils/api.js";
import { cleanupUploadedFiles } from "./upload.js";
import { env } from "../config/env.js";

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.path}`));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  cleanupUploadedFiles(req);

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

  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? `Uploaded files must be ${Math.floor(env.UPLOAD_MAX_BYTES / (1024 * 1024))} MB or smaller` : error.message;
    return res.status(400).json({ success: false, message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({ success: false, message: "That value is already registered. Please use a different email or identifier." });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return res.status(404).json({ success: false, message: "The requested record was not found" });
  }

  console.error(error);
  return res.status(500).json({ success: false, message: "Internal server error" });
}
