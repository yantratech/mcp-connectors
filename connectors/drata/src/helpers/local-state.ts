import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface DrataLocalState {
  vendorSecurityReviews?: Record<string, number[]>;
}

function statePath(): string {
  return (
    process.env.DRATA_MCP_STATE_PATH ??
    join(homedir(), ".local/state/drata-mcp/drata-state.json")
  );
}

export function readLocalState(): DrataLocalState {
  const file = statePath();
  try {
    return JSON.parse(readFileSync(file, "utf8")) as DrataLocalState;
  } catch {
    return {};
  }
}

export function getRememberedVendorSecurityReviewIds(vendorId: number): number[] {
  return readLocalState().vendorSecurityReviews?.[String(vendorId)] ?? [];
}
