/**
 * Opt-in live READ smoke test against a real (sandbox) Revolut Business
 * account. NOT run in CI (filename is not *.test.mjs) — it needs a configured
 * token store and hits the network.
 *
 * It only ever calls read tools. Prerequisites: complete the one-time consent
 * flow (see README) so a token store exists, then:
 *
 *   REVOLUT_ENV=sandbox \
 *   REVOLUT_CLIENT_ID=... REVOLUT_PRIVATE_KEY_PATH=~/.revolut-mcp/privatecert.pem \
 *   REVOLUT_JWT_ISS=example.com REVOLUT_OPERATOR=alice \
 *   npm run smoke:read
 */
import { loadConfig } from "../dist/config.js";
import { readTokenStore } from "../dist/auth.js";
import { RevolutClient } from "../dist/client.js";

function required() {
  const missing = [
    "REVOLUT_CLIENT_ID",
    "REVOLUT_PRIVATE_KEY_PATH",
    "REVOLUT_JWT_ISS",
    "REVOLUT_OPERATOR",
  ].filter((v) => !process.env[v]);
  if (missing.length) {
    console.error(
      `Skipping live read smoke — missing env: ${missing.join(", ")}.`,
    );
    process.exit(0);
  }
}

const main = async () => {
  required();
  const config = loadConfig();
  try {
    readTokenStore(config);
  } catch (error) {
    console.error(
      `Skipping live read smoke — ${error instanceof Error ? error.message : error}`,
    );
    process.exit(0);
  }

  const client = new RevolutClient(config);
  console.error(`[smoke] env=${config.env} api=${config.apiBaseUrl}`);

  const accounts = await client.listAccounts();
  console.error(`[smoke] list_accounts -> ${accounts.length} account(s)`);

  if (accounts.length > 0) {
    const first = accounts[0];
    const detail = await client.getAccount(first.id);
    console.error(`[smoke] get_account ${first.id} -> state=${detail.state}`);
  }

  const txns = await client.listTransactions({ count: 2 });
  console.error(`[smoke] list_transactions(count=2) -> ${txns.length} txn(s)`);

  const counterparties = await client.listCounterparties({ limit: 3 });
  console.error(
    `[smoke] list_counterparties(limit=3) -> ${counterparties.length} counterparty(ies)`,
  );

  const drafts = await client.listPaymentDrafts();
  const orders = Array.isArray(drafts.payment_orders)
    ? drafts.payment_orders
    : [];
  console.error(`[smoke] list_payment_drafts -> ${orders.length} draft(s)`);

  console.error("[smoke] OK — all read tools returned without error.");
};

main().catch((error) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
