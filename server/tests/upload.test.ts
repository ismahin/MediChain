import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { validateUploadedFile } from "../src/middleware/upload.js";

const temporaryDirectories: string[] = [];

function uploadedFile(contents: Buffer, mimetype: string, originalname: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "medichain-upload-test-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, originalname);
  fs.writeFileSync(filePath, contents);
  return { path: filePath, mimetype, originalname } as Express.Multer.File;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("upload validation", () => {
  it("accepts files whose signature matches their MIME type", () => {
    const file = uploadedFile(Buffer.from("%PDF-1.7\n"), "application/pdf", "report.pdf");
    expect(() => validateUploadedFile(file)).not.toThrow();
  });

  it("rejects files that only pretend to be an allowed type", () => {
    const file = uploadedFile(Buffer.from("not a pdf"), "application/pdf", "report.pdf");
    expect(() => validateUploadedFile(file)).toThrow("do not match");
  });
});
