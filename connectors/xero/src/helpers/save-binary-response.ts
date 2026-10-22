import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

export interface SavedBinaryResponse {
  path: string;
  sizeBytes: number;
}

function alreadyExists(outputPath: string, cause?: unknown): Error {
  return new Error(
    `File already exists: "${outputPath}". Pass overwrite: true to replace it.`,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Writes binary API response bytes to a caller-supplied local path with
 * strict path discipline:
 *
 * - outputPath must be absolute;
 * - the parent directory must already exist (the helper never creates
 *   directories on the caller's behalf);
 * - outputPath must not be a directory, a symlink (dangling or not) or any
 *   other non-regular file;
 * - when overwrite is false the file is created with O_CREAT|O_EXCL ('wx'),
 *   so an existing path, including a symlink planted after the checks
 *   above, is never written through;
 * - when overwrite is true the existing file must itself be writable (as
 *   an in-place write would require), and the bytes go to a fresh temp file in the same
 *   directory, which is then renamed over outputPath. rename() replaces the
 *   directory entry itself, so a symlink at outputPath is replaced rather
 *   than followed, and a reader never sees a half-written file.
 *
 * Binary bytes never enter model context: download tools return the written
 * path plus metadata text only.
 *
 * Throws a plain Error on any violation; tool handlers convert it to the
 * standard isError result via their catch path.
 */
export function saveBinaryResponse(
  outputPath: string,
  data: Buffer,
  overwrite: boolean = false,
): SavedBinaryResponse {
  if (!path.isAbsolute(outputPath)) {
    throw new Error(
      `outputPath must be an absolute path, got: "${outputPath}"`,
    );
  }

  const parentDir = path.dirname(outputPath);
  if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
    throw new Error(
      `Parent directory does not exist: "${parentDir}". Create it first or choose an existing directory.`,
    );
  }

  let existing: fs.Stats | undefined;
  try {
    existing = fs.lstatSync(outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (existing) {
    if (existing.isSymbolicLink()) {
      throw new Error(
        `outputPath is a symbolic link; refusing to write through it: "${outputPath}"`,
      );
    }
    if (existing.isDirectory()) {
      throw new Error(
        `outputPath points to a directory, not a file: "${outputPath}"`,
      );
    }
    if (!existing.isFile()) {
      throw new Error(`outputPath is not a regular file: "${outputPath}"`);
    }
    if (!overwrite) throw alreadyExists(outputPath);
  }

  if (!overwrite) {
    try {
      fs.writeFileSync(outputPath, data, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw alreadyExists(outputPath, error);
      }
      throw error;
    }
    return { path: outputPath, sizeBytes: data.length };
  }

  // rename() needs only write permission on the directory, so without this
  // check an overwrite would replace a read-only file (or one owned by
  // another user) that an in-place write would have been refused. Keep the
  // old rule: replacing a file requires that the file itself be writable.
  if (existing) {
    try {
      fs.accessSync(outputPath, fs.constants.W_OK);
    } catch (error) {
      throw new Error(
        `outputPath is not writable; refusing to replace it: "${outputPath}"`,
        { cause: error },
      );
    }
  }

  // Fixed-length temp name: deriving it from the target's basename would
  // push a long-but-valid file name past NAME_MAX on overwrite only.
  const tempPath = path.join(parentDir, `.xero-dl-${randomUUID()}.tmp`);
  try {
    // Keep the replaced file's permission bits so an overwrite never widens
    // access (e.g. a 0600 financial PDF must not come back 0644).
    fs.writeFileSync(tempPath, data, {
      flag: "wx",
      mode: existing ? existing.mode & 0o777 : 0o666,
    });
    if (existing) fs.chmodSync(tempPath, existing.mode & 0o777);
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort: never mask the original write/rename error.
    }
    throw error;
  }

  return { path: outputPath, sizeBytes: data.length };
}
