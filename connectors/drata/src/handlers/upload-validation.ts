import { stat } from "fs/promises";
import { basename, extname, isAbsolute } from "path";

/**
 * Shared guard for tools that read a caller-supplied file path off the
 * local disk and upload the bytes to Drata (upload_user_document,
 * upload_vendor_document). Without it those tools are a local-file
 * exfiltration primitive under prompt injection: any readable file could
 * be shipped to a third party. Enforces what the tool descriptions
 * already promise:
 *   • the path must be absolute and free of ".." traversal segments,
 *   • the extension must be on the documented allowlist,
 *   • the file must exist, be a regular file, and fit the size cap.
 * Throws a plain Error with a clear message; handlers surface it via
 * mapDrataError as an isError result.
 */

export const ALLOWED_UPLOAD_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".xlsx",
  ".docx",
] as const;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

export async function validateUploadFilePath(filePath: string): Promise<void> {
  if (!isAbsolute(filePath)) {
    throw new Error(
      `Upload rejected: filePath must be an absolute path, got "${filePath}".`,
    );
  }
  if (filePath.split(/[\\/]+/).includes("..")) {
    throw new Error(
      `Upload rejected: filePath must not contain ".." traversal segments, got "${filePath}".`,
    );
  }
  const ext = extname(filePath).toLowerCase();
  if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(
      `Upload rejected: unsupported file extension "${ext || "(none)"}" on "${basename(filePath)}". Allowed extensions: ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")}.`,
    );
  }
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error(
      `Upload rejected: "${filePath}" is not a regular file.`,
    );
  }
  if (info.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Upload rejected: "${basename(filePath)}" is ${info.size} bytes, which exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB upload limit.`,
    );
  }
}
