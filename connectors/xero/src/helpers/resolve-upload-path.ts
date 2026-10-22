import fs from "fs";
import path from "path";

import { registeredTempFiles } from "./attachment-temp-files.js";

/**
 * Local-file read policy for upload_attachment (filePath) and upload_file.
 *
 * Without it, a prompt-injected model could ask the server to read any file
 * it can access (SSH keys, .env files, browser profiles) and upload it to
 * Xero, where it can be read back. The policy:
 *
 *  - the path is resolved with realpath (symlinks and `..` collapsed; on
 *    macOS this also maps /var/... to /private/var/...);
 *  - the resolved path must be a temp file created by prepare_attachment in
 *    this server process, or lie inside the directory named by the optional
 *    XERO_UPLOAD_DIR environment variable (itself realpath-resolved);
 *  - the file is opened with O_NOFOLLOW and checked via fstat on the open
 *    descriptor: it must be a regular file no larger than MAX_UPLOAD_BYTES,
 *    and the bytes are read from that same descriptor.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UPLOAD_DIR_ENV = "XERO_UPLOAD_DIR";

function canonicalTempPath(filePath: string): string | null {
  // Resolve the directory only: if the temp file itself has been replaced by
  // a symlink, realpath(requested) resolves to the link target and will not
  // match, so the upload is refused.
  try {
    return path.join(fs.realpathSync(path.dirname(filePath)), path.basename(filePath));
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
}

function uploadDirRoot(env: NodeJS.ProcessEnv): string | null {
  const configured = env[UPLOAD_DIR_ENV]?.trim();
  if (!configured) return null;
  if (!path.isAbsolute(configured)) {
    throw new Error(`${UPLOAD_DIR_ENV} must be an absolute path.`);
  }
  try {
    const real = fs.realpathSync(configured);
    if (!fs.statSync(real).isDirectory()) throw new Error("not a directory");
    return real;
  } catch {
    throw new Error(
      `${UPLOAD_DIR_ENV} does not point to an existing directory.`,
    );
  }
}

/**
 * Resolves a caller-supplied upload path and checks it against the
 * allow-list. Returns the canonical (realpath) path. Throws on violation.
 */
export function resolveUploadPath(
  requestedPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) {
    throw new Error("filePath is required.");
  }
  if (!path.isAbsolute(requestedPath)) {
    throw new Error(`filePath must be an absolute path, got: "${requestedPath}"`);
  }

  let real: string;
  try {
    real = fs.realpathSync(requestedPath);
  } catch {
    throw new Error(`File not found or not accessible: "${requestedPath}"`);
  }

  for (const temp of registeredTempFiles()) {
    if (canonicalTempPath(temp) === real) return real;
  }

  const root = uploadDirRoot(env);
  if (root && isInside(root, real)) return real;

  throw new Error(
    `filePath "${requestedPath}" is not an allowed upload source. ` +
      `Stage the file with prepare_attachment and pass the returned filePath, ` +
      `or ask the operator to set ${UPLOAD_DIR_ENV} to a directory of files ` +
      `that may be uploaded.`,
  );
}

/**
 * Resolves and validates the path, then reads it through a single
 * O_NOFOLLOW descriptor (regular file, size-capped).
 */
export function readUploadFile(
  requestedPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  const real = resolveUploadPath(requestedPath, env);

  const flags =
    fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW ?? 0) |
    // Don't block on a FIFO swapped in at this path; fstat rejects it below.
    (fs.constants.O_NONBLOCK ?? 0);

  let fd: number;
  try {
    fd = fs.openSync(real, flags);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EMLINK") {
      throw new Error(
        `Refusing to upload through a symbolic link: "${requestedPath}"`,
        { cause: error },
      );
    }
    throw new Error(`File not found or not accessible: "${requestedPath}"`, {
      cause: error,
    });
  }

  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`filePath is not a regular file: "${requestedPath}"`);
    }
    if (stat.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `File exceeds the ${MAX_UPLOAD_BYTES}-byte upload limit: "${requestedPath}"`,
      );
    }

    // Read from the descriptor, enforcing the cap even if the file grows
    // after fstat.
    const chunks: Buffer[] = [];
    let total = 0;
    const buf = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_UPLOAD_BYTES) {
        throw new Error(
          `File exceeds the ${MAX_UPLOAD_BYTES}-byte upload limit: "${requestedPath}"`,
        );
      }
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks);
  } finally {
    fs.closeSync(fd);
  }
}
