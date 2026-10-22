#!/usr/bin/env node
// Live scope probe for the Xero connector — NOT part of `npm test`.
//
// `npm test` globs `test/*.test.mjs`; this file ends in `.mjs` (no `.test`),
// so CI stays fully offline. Run it manually against a real tenant:
//
//   export XERO_CLIENT_ID=...   export XERO_CLIENT_SECRET=...
//   node test/live-smoke.mjs                  # request the default (granular-only) scopes
//   node test/live-smoke.mjs --with-broad     # also request broad accounting.transactions
//   node test/live-smoke.mjs --with-journals  # also request accounting.journals.read
//   XERO_ENABLE_RECEIPTS=1 node test/live-smoke.mjs   # same as --with-broad
//   XERO_ENABLE_JOURNALS=1 node test/live-smoke.mjs   # same as --with-journals
//
// It (1) mints a client_credentials token with the requested scope set,
// (2) diffs requested-vs-granted scopes, (3) hits one read endpoint per Xero
// resource family and flags any 401/403 (= insufficient scope). It NEVER prints
// the client secret or any access token.
//
// The default run requests exactly what the server requests by default
// (granular-only, no journals). It confirms that a fresh Custom Connection,
// which cannot be granted the deprecated accounting.transactions scopes or
// accounting.journals.read, mints a token and reaches every default family.
// Receipts has no granular scope and is expected to 403 unless the broad
// scopes are added, which the server does only with XERO_ENABLE_RECEIPTS=1
// (mirrored here by --with-broad). Journals is expected to 403 unless
// accounting.journals.read is added, which the server does only with
// XERO_ENABLE_JOURNALS=1 (mirrored here by --with-journals). Only Custom
// Connections created before 29 April 2026 can hold that scope, unless Xero
// grants a newer one Advanced-tier access to the Journals endpoint.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- minimal dependency-free .env loader (connector dir) -------------------
function loadEnv() {
  for (const p of [join(__dirname, "..", ".env"), join(process.cwd(), ".env")]) {
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      /* no .env at this path — fine */
    }
  }
}
loadEnv();

// After loadEnv(), so XERO_ENABLE_RECEIPTS and XERO_ENABLE_JOURNALS from .env
// count, as they do for the server (dotenv).
const flagSet = (name) =>
  ["1", "true"].includes((process.env[name] ?? "").trim().toLowerCase());
const WITH_BROAD =
  process.argv.includes("--with-broad") || flagSet("XERO_ENABLE_RECEIPTS");
const WITH_JOURNALS =
  process.argv.includes("--with-journals") || flagSet("XERO_ENABLE_JOURNALS");

const CLIENT_ID = process.env.XERO_CLIENT_ID;
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log(
    "⏭  live-smoke skipped: set XERO_CLIENT_ID and XERO_CLIENT_SECRET to run the probe.",
  );
  process.exit(0);
}

// --- scope sets ------------------------------------------------------------
// GRANULAR must equal the server's default scope list, BROAD_TX its receipt
// scopes and JOURNALS its journal scopes (src/consts/xero-scopes.ts; kept
// inline so this probe runs without a build); test/oauth-scopes.test.mjs
// enforces the sync.
const GRANULAR = [
  "accounting.invoices", "accounting.invoices.read",
  "accounting.payments", "accounting.payments.read",
  "accounting.banktransactions", "accounting.banktransactions.read",
  "accounting.manualjournals", "accounting.manualjournals.read",
  "accounting.contacts", "accounting.contacts.read",
  "accounting.settings", "accounting.settings.read",
  "accounting.reports.balancesheet.read", "accounting.reports.banksummary.read",
  "accounting.reports.profitandloss.read", "accounting.reports.trialbalance.read",
  "accounting.reports.aged.read", "accounting.reports.executivesummary.read",
  "accounting.reports.budgetsummary.read",
  "accounting.attachments", "accounting.attachments.read",
  "accounting.budgets.read",
  "payroll.settings",
  "payroll.employees.read",
  "payroll.timesheets", "payroll.timesheets.read",
  "assets", "assets.read",
  "projects", "projects.read",
  "files", "files.read",
];
const BROAD_TX = ["accounting.transactions", "accounting.transactions.read"];
const JOURNALS = ["accounting.journals.read"];
// Same order as the server: defaults, then receipts, then journals.
const requested = [
  ...GRANULAR,
  ...(WITH_BROAD ? BROAD_TX : []),
  ...(WITH_JOURNALS ? JOURNALS : []),
];

// --- endpoints: one read per resource family -------------------------------
const A = "https://api.xero.com/api.xro/2.0";
const ENDPOINTS = [
  { family: "Invoices", scope: "accounting.invoices.read", url: `${A}/Invoices?page=1` },
  { family: "CreditNotes", scope: "accounting.invoices.read", url: `${A}/CreditNotes?page=1` },
  { family: "Quotes", scope: "accounting.invoices.read", url: `${A}/Quotes` },
  { family: "PurchaseOrders", scope: "accounting.invoices.read", url: `${A}/PurchaseOrders?page=1` },
  { family: "RepeatingInvoices", scope: "accounting.invoices.read", url: `${A}/RepeatingInvoices` },
  { family: "Items", scope: "accounting.invoices.read | settings.read", url: `${A}/Items` },
  { family: "LinkedTransactions", scope: "accounting.invoices.read", url: `${A}/LinkedTransactions` },
  { family: "BankTransactions", scope: "accounting.banktransactions.read", url: `${A}/BankTransactions?page=1` },
  { family: "BankTransfers", scope: "accounting.banktransactions.read", url: `${A}/BankTransfers` },
  { family: "Payments", scope: "accounting.payments.read", url: `${A}/Payments?page=1` },
  { family: "Overpayments", scope: "accounting.payments.read", url: `${A}/Overpayments?page=1` },
  { family: "Prepayments", scope: "accounting.payments.read", url: `${A}/Prepayments?page=1` },
  { family: "ManualJournals", scope: "accounting.manualjournals.read", url: `${A}/ManualJournals?page=1` },
  { family: "Receipts ⚠", scope: "broad accounting.transactions ONLY (no granular)", url: `${A}/Receipts`, knownGap: true },
  { family: "Contacts", scope: "accounting.contacts.read", url: `${A}/Contacts?page=1` },
  { family: "Accounts", scope: "accounting.settings.read", url: `${A}/Accounts` },
  { family: "Journals ⚠", scope: "accounting.journals.read (opt-in)", url: `${A}/Journals`, needsJournals: true },
  { family: "Budgets", scope: "accounting.budgets.read", url: `${A}/Budgets` },
  { family: "Report:BalanceSheet", scope: "accounting.reports.balancesheet.read", url: `${A}/Reports/BalanceSheet` },
  { family: "Report:BankSummary", scope: "accounting.reports.banksummary.read", url: `${A}/Reports/BankSummary` },
  { family: "Report:ProfitAndLoss", scope: "accounting.reports.profitandloss.read", url: `${A}/Reports/ProfitAndLoss` },
  { family: "Report:TrialBalance", scope: "accounting.reports.trialbalance.read", url: `${A}/Reports/TrialBalance` },
  { family: "Report:ExecutiveSummary", scope: "accounting.reports.executivesummary.read", url: `${A}/Reports/ExecutiveSummary` },
  { family: "Report:BudgetSummary", scope: "accounting.reports.budgetsummary.read", url: `${A}/Reports/BudgetSummary` },
  { family: "Report:AgedPayables", scope: "accounting.reports.aged.read", url: `${A}/Reports/AgedPayablesByContact` },
  { family: "Assets", scope: "assets.read", url: `https://api.xero.com/assets.xro/1.0/Assets?status=DRAFT` },
  { family: "Projects", scope: "projects.read", url: `https://api.xero.com/projects.xro/2.0/Projects` },
  { family: "Files", scope: "files.read", url: `https://api.xero.com/files.xro/1.0/Files` },
  { family: "Payroll:Employees (NZ/UK only)", scope: "payroll.employees.read", url: `https://api.xero.com/payroll.xro/2.0/Employees`, optional: true },
  { family: "Payroll:LeaveTypes (NZ/UK only)", scope: "payroll.settings", url: `https://api.xero.com/payroll.xro/2.0/LeaveTypes`, optional: true },
  { family: "Payroll:Timesheets (NZ/UK only)", scope: "payroll.timesheets.read", url: `https://api.xero.com/payroll.xro/2.0/Timesheets`, optional: true },
];

// --- helpers ---------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);

async function getToken() {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(requested.join(" "))}`,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Identity errors are {error, error_description} — safe to surface (no
    // secret/token echoed). We deliberately do NOT print the raw body.
    return { ok: false, status: res.status, error: data.error, desc: data.error_description };
  }
  return { ok: true, accessToken: data.access_token, granted: (data.scope || "").split(/\s+/).filter(Boolean) };
}

async function getTenantId(accessToken) {
  const res = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) && arr.length ? arr[0].tenantId : undefined;
}

// --- run -------------------------------------------------------------------
const mode =
  WITH_BROAD || WITH_JOURNALS
    ? ["granular", WITH_BROAD && "broad transactions", WITH_JOURNALS && "journals"]
        .filter(Boolean)
        .join(" + ")
    : "GRANULAR-ONLY";
console.log(`\nXero scope probe — mode: ${mode}`);
console.log(`Requesting ${requested.length} scopes.\n`);

const tok = await getToken();
if (!tok.ok) {
  console.error(`❌ Token request FAILED: HTTP ${tok.status}` + (tok.error ? ` — ${tok.error}: ${tok.desc ?? ""}` : ""));
  if (tok.error === "invalid_scope") {
    console.error(
      "   This is the granular-migration failure mode. A requested scope is not\n" +
      "   granted on the Custom Connection. Grant it in developer.xero.com, or\n" +
      "   remove it from the requested set.",
    );
    if (WITH_BROAD || WITH_JOURNALS) {
      console.error(
        "   Connections created on or after 29 April 2026 cannot be granted\n" +
        "   accounting.transactions or accounting.journals.read: drop --with-broad\n" +
        "   and --with-journals, and unset XERO_ENABLE_RECEIPTS and XERO_ENABLE_JOURNALS.",
      );
    }
  }
  process.exit(1);
}
console.log("✅ Token minted.");

// scope diff
const grantedSet = new Set(tok.granted);
const reqSet = new Set(requested);
const notGranted = requested.filter((s) => !grantedSet.has(s));
const extraGranted = tok.granted.filter((s) => !reqSet.has(s));
if (notGranted.length) console.log(`⚠  Requested but NOT in granted token: ${notGranted.join(", ")}`);
else console.log("✅ Every requested scope appears in the granted token.");
if (extraGranted.length) console.log(`ℹ  Granted but not requested (app default): ${extraGranted.join(", ")}`);

const tenantId = await getTenantId(tok.accessToken);
if (!tenantId) {
  console.error("❌ Could not resolve a tenant from /connections.");
  process.exit(1);
}
console.log(`✅ Tenant resolved.\n`);

console.log(pad("RESOURCE", 32) + pad("HTTP", 6) + "VERDICT");
console.log("-".repeat(72));

const scopeFails = [];
for (const ep of ENDPOINTS) {
  let status, verdict;
  try {
    const res = await fetch(ep.url, {
      headers: {
        Authorization: `Bearer ${tok.accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    });
    status = res.status;
  } catch {
    status = "ERR";
  }
  // Journals is expected to fail when accounting.journals.read was not requested.
  const journalsOff = ep.needsJournals && !WITH_JOURNALS;
  const scopeFail = status === 401 || status === 403;
  if (scopeFail) {
    verdict = ep.knownGap
      ? `${status} — KNOWN GAP (no granular scope for Receipts)`
      : journalsOff
        ? `${status} — expected: accounting.journals.read not requested`
        : ep.optional
          ? `${status} — optional family not granted on this tenant (informational)`
          : "❌ SCOPE FAIL (401/403)";
    scopeFails.push({ ...ep, status, journalsOff });
  } else if (status === "ERR") {
    verdict = "network error";
  } else {
    // 200 OK, or 400/404/415 (request-shape issues) — all mean scope passed auth.
    verdict = ep.knownGap
      ? `✅ reachable (status ${status}) — Receipts NOT gated here`
      : journalsOff
        ? `✅ reachable (status ${status}) — Journals NOT gated here`
        : `✅ scope OK (${status})`;
  }
  console.log(pad(ep.family, 32) + pad(status, 6) + verdict);
}

// --- verdict ---------------------------------------------------------------
console.log("\n" + "=".repeat(72));
const unexpected = scopeFails.filter((f) => !f.knownGap && !f.optional && !f.journalsOff);
const receiptsGap = scopeFails.find((f) => f.knownGap);
const journalsGap = scopeFails.find((f) => f.journalsOff);

if (unexpected.length) {
  console.log(`❌ ${unexpected.length} UNEXPECTED scope failure(s): ${unexpected.map((f) => f.family).join(", ")}`);
  console.log("   The granular set is INCOMPLETE for these families — do not ship.");
} else {
  console.log("✅ No unexpected scope failures — the granular set covers every family probed.");
}
if (!WITH_BROAD) {
  if (receiptsGap) {
    console.log(`✅ Receipts ${receiptsGap.status} under granular-only — CONFIRMS the documented gap.`);
    console.log("   Receipts works only via the broad accounting.transactions scope, which the");
    console.log("   server requests only with XERO_ENABLE_RECEIPTS=1. Re-run with --with-broad to verify.");
  } else {
    console.log("ℹ  Receipts did NOT 403 under granular-only — Xero may have changed the");
    console.log("   scope model; re-check whether the broad transactions scope is still needed.");
  }
}
if (!WITH_JOURNALS) {
  if (journalsGap) {
    console.log(`✅ Journals ${journalsGap.status} without accounting.journals.read — as expected.`);
    console.log("   The server requests that scope, and registers list_journals and get_journal,");
    console.log("   only with XERO_ENABLE_JOURNALS=1. On a connection that holds the scope (one");
    console.log("   created before 29 April 2026), re-run with --with-journals to verify.");
  } else {
    console.log("ℹ  Journals did NOT 403 without accounting.journals.read — check the scope diff");
    console.log("   above; Xero may have granted it anyway or changed the scope model.");
  }
}
console.log("=".repeat(72) + "\n");

process.exit(unexpected.length ? 1 : 0);
