import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { env } from "../config/env.js";
import { ApiError } from "../utils/api.js";

const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);

function ensureDir(folder: string) {
  fs.mkdirSync(folder, { recursive: true });
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
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!allowedTypes.has(file.mimetype)) {
        cb(new ApiError(400, "Only PDF, PNG, JPG, and JPEG files are allowed"));
        return;
      }
      cb(null, true);
    }
  });
}
