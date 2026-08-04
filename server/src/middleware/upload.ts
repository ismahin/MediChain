import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import type { Request } from "express";
import { env } from "../config/env.js";
import { ApiError } from "../utils/api.js";

const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);

function ensureDir(folder: string) {
  fs.mkdirSync(folder, { recursive: true });
}

export function cleanupUploadedFiles(req: Request) {
  const files = [
    req.file,
    ...(Array.isArray(req.files) ? req.files : Object.values(req.files ?? {}).flat())
  ].filter(Boolean) as Express.Multer.File[];
  for (const file of files) {
    try {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (error) {
      console.error(`Could not remove rejected upload ${file.path}`, error);
    }
  }
}

export function validateUploadedFile(file: Express.Multer.File) {
  const descriptor = fs.openSync(file.path, "r");
  const header = Buffer.alloc(8);
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const valid = file.mimetype === "application/pdf"
    ? header.subarray(0, 5).toString("ascii") === "%PDF-"
    : file.mimetype === "image/png"
      ? header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : (file.mimetype === "image/jpeg" || file.mimetype === "image/jpg")
        ? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
        : false;
  if (!valid) throw new ApiError(400, `The contents of ${file.originalname} do not match its declared file type`);
}

export function uploadTo(subfolder: string) {
  const destination = path.resolve(process.cwd(), env.UPLOAD_DIR, subfolder);
  ensureDir(destination);

  return multer({
    storage: multer.diskStorage({
      destination,
      filename: (_req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        cb(null, `${crypto.randomUUID()}${extension}`);
      }
    }),
    limits: { fileSize: env.UPLOAD_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      if (!allowedTypes.has(file.mimetype)) {
        cb(new ApiError(400, "Only PDF, PNG, JPG, and JPEG files are allowed"));
        return;
      }
      cb(null, true);
    }
  });
}
