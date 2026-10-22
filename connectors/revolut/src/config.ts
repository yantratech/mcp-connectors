/**
 * Configuration loading and validation for the Revolut Business MCP server.
 *
 * Everything comes from environment variables (set in the MCP client config).
 * Config is validated eagerly so the server fails fast with an actionable
 * message rather than surfacing a cryptic auth error on the first tool call.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type RevolutEnv = "sandbox" | "production";

export interface RevolutConfig {
  env: RevolutEnv;
  /** REST API base, e.g. https://sandbox-b2b.revolut.com/api/1.0 */
  apiBaseUrl: string;
  /** Web app base used for the consent flow, e.g. https://sandbox-business.revolut.com */
  webAppUrl: string;
  clientId: string;
  privateKeyPath: string;
  /** PEM contents of the RSA private key, read at load time. */
  privateKey: string;
  /** JWT `iss` claim — the redirect-URI domain, no scheme. */
  jwtIss: string;
  /** Human operator name stamped onto every payment draft. */
  operator: string;
  /** Absolute path to the per-env token store JSON. */
  tokenStorePath: string;
}

const ENV_BASES: Record<RevolutEnv, { api: string; web: string }> = {
  production: {
    api: "https://b2b.revolut.com/api/1.0",
    web: "https://business.revolut.com",
  },
  sandbox: {
    api: "https://sandbox-b2b.revolut.com/api/1.0",
    web: "https://sandbox-business.revolut.com",
  },
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Environment variable ${name} is required and must be non-empty.`,
    );
  }
  return value.trim();
}

/**
 * Resolve the environment. Defaults to sandbox; production is only selected
 * when REVOLUT_ENV is explicitly "production", so the server never silently
 * talks to the live banking API.
 */
function resolveEnv(): RevolutEnv {
  const raw = (process.env.REVOLUT_ENV ?? "sandbox").trim().toLowerCase();
  if (raw === "production") return "production";
  if (raw === "sandbox" || raw === "") return "sandbox";
  throw new Error(
    `REVOLUT_ENV must be "sandbox" or "production" (got "${raw}"). ` +
      `Leave it unset to default to sandbox.`,
  );
}

/** Directory holding the token store; overridable for tests. */
function tokenDir(): string {
  return process.env.REVOLUT_TOKEN_DIR?.trim() || join(homedir(), ".revolut-mcp");
}

export function loadConfig(): RevolutConfig {
  const env = resolveEnv();
  const bases = ENV_BASES[env];

  const clientId = requireEnv("REVOLUT_CLIENT_ID");
  const privateKeyPath = requireEnv("REVOLUT_PRIVATE_KEY_PATH");
  const jwtIss = requireEnv("REVOLUT_JWT_ISS").replace(/^https?:\/\//, "");
  const operator = requireEnv("REVOLUT_OPERATOR");

  let privateKey: string;
  try {
    privateKey = readFileSync(privateKeyPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read the RSA private key at REVOLUT_PRIVATE_KEY_PATH="${privateKeyPath}": ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `Generate it with "openssl genrsa -out privatecert.pem 2048" and upload the ` +
        `matching public cert to the Revolut Business web app.`,
      { cause: error },
    );
  }
  if (!privateKey.includes("PRIVATE KEY")) {
    throw new Error(
      `The file at REVOLUT_PRIVATE_KEY_PATH="${privateKeyPath}" does not look like a ` +
        `PEM private key (no "PRIVATE KEY" header found).`,
    );
  }

  return {
    env,
    apiBaseUrl: bases.api,
    webAppUrl: bases.web,
    clientId,
    privateKeyPath,
    privateKey,
    jwtIss,
    operator,
    tokenStorePath: join(tokenDir(), `tokens-${env}.json`),
  };
}
