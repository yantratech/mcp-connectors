import { readFileSync } from "node:fs";

/**
 * The version in this package's package.json, read at runtime so the MCP
 * serverInfo always reports the version that is actually installed. The
 * compiled file lives at dist/helpers/, two levels below package.json.
 * Falls back to "0.0.0" if the file cannot be read (for example, when the
 * server has been bundled into a single file).
 */
export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
