#!/usr/bin/env node

/**
 * One-time CLI: exchange a fresh OAuth authorization code for tokens and write
 * the token store (mode 0600).
 *
 * Usage:  revolut-mcp-authorize <code>
 *   npx:    npx -y -p @yantratech/revolut-mcp-server revolut-mcp-authorize <code>
 *   source: npm run authorize -- <code>   (from connectors/revolut)
 *
 * The authorization code is only valid for 2 minutes, so run this immediately
 * after completing the consent flow in the browser (see README).
 */
import { exchangeAuthorizationCode } from "../auth.js";
import { loadConfig } from "../config.js";

const main = async (): Promise<void> => {
  const code = process.argv[2]?.trim();
  if (!code) {
    console.error(
      "Usage: revolut-mcp-authorize <code>\n" +
        "  (via npx: npx -y -p @yantratech/revolut-mcp-server revolut-mcp-authorize <code>)\n" +
        "  (from a source checkout: npm run authorize -- <code>)\n" +
        "  <code> is the value of the `code` query parameter Revolut appended " +
        "to your redirect URI after you approved access. It expires 2 minutes " +
        "after issue — run this immediately.",
    );
    process.exit(2);
  }

  const config = loadConfig();
  console.error(
    `[revolut-mcp] exchanging authorization code (env=${config.env})...`,
  );

  const tokens = await exchangeAuthorizationCode(config, code);
  const expiresAt = new Date(tokens.access_token_expires_at).toISOString();

  // Never print token values.
  console.error(
    `[revolut-mcp] success. Token store written to ${config.tokenStorePath} (mode 0600).\n` +
      `[revolut-mcp] access token valid until ${expiresAt}; refresh token stored ` +
      `(it does not expire). You can now run the MCP server.`,
  );
};

main().catch((error) => {
  console.error(
    `[revolut-mcp] authorize failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
