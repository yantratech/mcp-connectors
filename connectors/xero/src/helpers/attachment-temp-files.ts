/**
 * Registry of temp files created by prepare_attachment in this server
 * process. resolveUploadPath() treats exactly these paths (plus anything
 * under XERO_UPLOAD_DIR) as uploadable, so upload_attachment / upload_file
 * cannot be pointed at arbitrary local files.
 */
const tempFiles = new Map<string, string>();

export function registerTempFile(id: string, filePath: string): void {
  tempFiles.set(id, filePath);
}

export function getTempFile(id: string): string | undefined {
  return tempFiles.get(id);
}

export function registeredTempFiles(): string[] {
  return [...tempFiles.values()];
}

/** Test-only: forget all registered temp files. */
export function clearTempFiles(): void {
  tempFiles.clear();
}
