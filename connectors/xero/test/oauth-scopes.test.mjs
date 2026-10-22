/**
 * OAuth scope minimisation.
 *
 * The client_credentials token must request exactly the scopes the tools
 * use, and nothing else. This file locks that in from six angles:
 *
 *  1. Snapshot: the requested list is exactly EXPECTED_SCOPES, so any change
 *     to it is a deliberate, reviewed edit of this file too.
 *  2. Removal-only safety: every requested scope was already requested
 *     before scope minimisation. A Custom Connection rejects the whole token
 *     request (invalid_scope) if asked for a scope it was not granted, so
 *     requesting a subset can never break an existing connection, but adding
 *     or swapping a scope can.
 *  3. Coverage: every payroll and report SDK call in the compiled handlers
 *     is mapped to the scope it needs, and that scope is requested. A new
 *     tool calling an unmapped payroll/report method fails here until its
 *     scope is considered. Only the opt-in journal tools call the Journals
 *     endpoint.
 *  4. Wire: the token request actually carries the list (via the loopback
 *     token endpoint in test/helpers/loopback-token-endpoint.mjs, so no
 *     network).
 *  5. Opt-in scopes: the deprecated broad accounting.transactions(.read)
 *     scopes are requested only with XERO_ENABLE_RECEIPTS=1, and
 *     accounting.journals.read only with XERO_ENABLE_JOURNALS=1, because
 *     connections created on/after 29 Apr 2026 cannot be granted them and
 *     Xero then rejects the whole request with invalid_scope.
 *  6. Error mapping: the OAuth `error` code is surfaced (invalid_scope is
 *     not blamed on the client credentials, and its hint never tells the
 *     user to grant an opt-in scope a new connection cannot get) and nothing
 *     else from the identity response is echoed.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startRejectingTokenEndpoint } from "./helpers/loopback-token-endpoint.mjs";

process.env.XERO_ENABLE_RECEIPTS = "";
process.env.XERO_ENABLE_JOURNALS = "";

const {
  XERO_CLIENT_CREDENTIALS_SCOPES,
  XERO_RECEIPT_SCOPES,
  XERO_JOURNAL_SCOPES,
  XERO_JOURNAL_TOOL_NAMES,
  getClientCredentialsScopes,
  receiptsEnabled,
  journalsEnabled,
  receiptsDisabledError,
} = await import("../dist/consts/xero-scopes.js");
const { xeroClient } = await import("../dist/clients/xero-client.js");
const { default: listInvoicesFactory } = await import(
  "../dist/tools/list/list-invoices.tool.js"
);

const EXPECTED_SCOPES = [
  "accounting.invoices",
  "accounting.invoices.read",
  "accounting.payments",
  "accounting.payments.read",
  "accounting.banktransactions",
  "accounting.banktransactions.read",
  "accounting.manualjournals",
  "accounting.manualjournals.read",
  "accounting.contacts",
  "accounting.contacts.read",
  "accounting.settings",
  "accounting.settings.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.aged.read",
  "accounting.reports.executivesummary.read",
  "accounting.reports.budgetsummary.read",
  "accounting.attachments",
  "accounting.attachments.read",
  "accounting.budgets.read",
  "payroll.settings",
  "payroll.employees.read",
  "payroll.timesheets",
  "payroll.timesheets.read",
  "assets",
  "assets.read",
  "projects",
  "projects.read",
  "files",
  "files.read",
];

const RECEIPT_SCOPES = ["accounting.transactions", "accounting.transactions.read"];
const JOURNAL_SCOPES = ["accounting.journals.read"];

// Every opt-in combination, in the order the scopes are appended.
const OPT_IN_COMBINATIONS = [
  { env: {}, scopes: EXPECTED_SCOPES },
  { env: { XERO_ENABLE_RECEIPTS: "1" }, scopes: [...EXPECTED_SCOPES, ...RECEIPT_SCOPES] },
  { env: { XERO_ENABLE_JOURNALS: "1" }, scopes: [...EXPECTED_SCOPES, ...JOURNAL_SCOPES] },
  {
    env: { XERO_ENABLE_RECEIPTS: "1", XERO_ENABLE_JOURNALS: "1" },
    scopes: [...EXPECTED_SCOPES, ...RECEIPT_SCOPES, ...JOURNAL_SCOPES],
  },
];

// The 41 scopes requested before scope minimisation.
const PRE_MINIMISATION_SCOPES = [
  ...EXPECTED_SCOPES,
  ...RECEIPT_SCOPES,
  ...JOURNAL_SCOPES,
  "accounting.reports.tenninetynine.read",
  "payroll.employees",
  "payroll.payruns",
  "payroll.payruns.read",
  "payroll.payslip",
  "payroll.payslip.read",
];

const REMOVED_BY_MINIMISATION = [
  "accounting.reports.tenninetynine.read",
  "payroll.employees",
  "payroll.payruns",
  "payroll.payruns.read",
  "payroll.payslip",
  "payroll.payslip.read",
];

// Every payroll / report SDK method the handlers may call, and the scope it
// needs (Xero NZ Payroll + Accounting reports scope tables). A write scope
// also grants the matching read.
const PAYROLL_METHOD_SCOPE = {
  getEmployees: "payroll.employees.read",
  getEmployeeLeaves: "payroll.employees.read",
  getEmployeeLeaveBalances: "payroll.employees.read",
  getEmployeeLeavePeriods: "payroll.employees.read",
  getEmployeeLeaveTypes: "payroll.employees.read",
  getLeaveTypes: "payroll.settings",
  getTimesheet: "payroll.timesheets.read",
  getTimesheets: "payroll.timesheets.read",
  createTimesheet: "payroll.timesheets",
  createTimesheetLine: "payroll.timesheets",
  updateTimesheetLine: "payroll.timesheets",
  approveTimesheet: "payroll.timesheets",
  revertTimesheet: "payroll.timesheets",
  deleteTimesheet: "payroll.timesheets",
};

const REPORT_METHOD_SCOPE = {
  getReportBalanceSheet: "accounting.reports.balancesheet.read",
  getReportBankSummary: "accounting.reports.banksummary.read",
  getReportProfitAndLoss: "accounting.reports.profitandloss.read",
  getReportTrialBalance: "accounting.reports.trialbalance.read",
  getReportAgedPayablesByContact: "accounting.reports.aged.read",
  getReportAgedReceivablesByContact: "accounting.reports.aged.read",
  getReportExecutiveSummary: "accounting.reports.executivesummary.read",
  getReportBudgetSummary: "accounting.reports.budgetsummary.read",
};

const handlersSource = (() => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "handlers");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ file: f, src: readFileSync(join(dir, f), "utf8") }));
})();

function sdkCalls(pattern) {
  const calls = new Map();
  for (const { file, src } of handlersSource) {
    for (const m of src.matchAll(pattern)) {
      if (!calls.has(m[1])) calls.set(m[1], file);
    }
  }
  return calls;
}

describe("requested OAuth scopes (client_credentials)", () => {
  it("are exactly the expected least-privilege list", () => {
    assert.deepEqual([...XERO_CLIENT_CREDENTIALS_SCOPES], EXPECTED_SCOPES);
    assert.deepEqual([...getClientCredentialsScopes({})], EXPECTED_SCOPES);
  });

  it("do not request the deprecated accounting.transactions scopes by default", () => {
    for (const scope of RECEIPT_SCOPES) {
      assert.ok(
        !getClientCredentialsScopes({}).includes(scope),
        `${scope} must be opt-in (XERO_ENABLE_RECEIPTS=1)`,
      );
    }
  });

  it("do not request accounting.journals.read by default", () => {
    for (const scope of JOURNAL_SCOPES) {
      assert.ok(
        !getClientCredentialsScopes({}).includes(scope),
        `${scope} must be opt-in (XERO_ENABLE_JOURNALS=1)`,
      );
    }
  });

  it("add exactly the two receipt scopes when XERO_ENABLE_RECEIPTS=1", () => {
    assert.deepEqual([...XERO_RECEIPT_SCOPES], RECEIPT_SCOPES);
    for (const v of ["1", "true", "TRUE", " 1 "]) {
      assert.deepEqual(
        [...getClientCredentialsScopes({ XERO_ENABLE_RECEIPTS: v })],
        [...EXPECTED_SCOPES, ...RECEIPT_SCOPES],
        `XERO_ENABLE_RECEIPTS=${JSON.stringify(v)}`,
      );
    }
    for (const v of ["", "0", "false", "no", "yes please"]) {
      assert.equal(receiptsEnabled({ XERO_ENABLE_RECEIPTS: v }), false, v);
    }
  });

  it("add exactly accounting.journals.read when XERO_ENABLE_JOURNALS=1", () => {
    assert.deepEqual([...XERO_JOURNAL_SCOPES], JOURNAL_SCOPES);
    for (const v of ["1", "true", "TRUE", " 1 "]) {
      assert.deepEqual(
        [...getClientCredentialsScopes({ XERO_ENABLE_JOURNALS: v })],
        [...EXPECTED_SCOPES, ...JOURNAL_SCOPES],
        `XERO_ENABLE_JOURNALS=${JSON.stringify(v)}`,
      );
    }
    for (const v of ["", "0", "false", "no", "yes please"]) {
      assert.equal(journalsEnabled({ XERO_ENABLE_JOURNALS: v }), false, v);
    }
  });

  it("match the expected list for every opt-in combination (receipts, then journals)", () => {
    for (const { env, scopes } of OPT_IN_COMBINATIONS) {
      assert.deepEqual([...getClientCredentialsScopes(env)], scopes, JSON.stringify(env));
    }
  });

  it("contain no duplicates, with or without the opt-in scopes", () => {
    for (const { env } of OPT_IN_COMBINATIONS) {
      const scopes = getClientCredentialsScopes(env);
      assert.equal(new Set(scopes).size, scopes.length, JSON.stringify(env));
    }
  });

  it("no longer request the unused payroll / 1099 scopes", () => {
    for (const scope of REMOVED_BY_MINIMISATION) {
      assert.ok(
        !XERO_CLIENT_CREDENTIALS_SCOPES.includes(scope),
        `${scope} must not be requested`,
      );
    }
  });

  it("are a subset of the scopes requested before scope minimisation (removal only — cannot trigger invalid_scope on an existing connection)", () => {
    for (const { env } of OPT_IN_COMBINATIONS) {
      for (const scope of getClientCredentialsScopes(env)) {
        assert.ok(
          PRE_MINIMISATION_SCOPES.includes(scope),
          `${scope} was not in the original scope list; adding it needs coordinated re-granting on every Custom Connection`,
        );
      }
    }
    assert.equal(
      PRE_MINIMISATION_SCOPES.length - XERO_CLIENT_CREDENTIALS_SCOPES.length,
      REMOVED_BY_MINIMISATION.length + RECEIPT_SCOPES.length + JOURNAL_SCOPES.length,
    );
  });
});

describe("every payroll / report SDK call is covered by a requested scope", () => {
  it("payroll calls are NZ-only and each maps to a requested scope", () => {
    const calls = sdkCalls(/payroll(?:NZ|UK|AU)Api\s*\.\s*([A-Za-z]+)\s*\(/g);
    assert.ok(calls.size > 0, "scan found no payroll calls — check the pattern");
    for (const { src, file } of handlersSource) {
      assert.doesNotMatch(src, /payroll(?:UK|AU)Api\s*\./, `${file}: unexpected non-NZ payroll API`);
    }
    for (const [method, file] of calls) {
      const scope = PAYROLL_METHOD_SCOPE[method];
      assert.ok(scope, `${file}: payrollNZApi.${method} has no scope mapping — add one`);
      assert.ok(
        XERO_CLIENT_CREDENTIALS_SCOPES.includes(scope),
        `${file}: payrollNZApi.${method} needs ${scope}, which is not requested`,
      );
    }
  });

  it("no handler calls a pay-run, payslip or 1099 endpoint", () => {
    for (const { file, src } of handlersSource) {
      assert.doesNotMatch(
        src,
        /Api\s*\.\s*\w*(PayRun|PaySlip|Payslip|TenNinetyNine)\w*\s*\(/,
        `${file} calls an endpoint whose scope was removed by scope minimisation`,
      );
    }
  });

  it("report calls each map to a requested granular report scope", () => {
    const calls = sdkCalls(/accountingApi\s*\.\s*(getReport[A-Za-z]+)\s*\(/g);
    assert.ok(calls.size > 0, "scan found no report calls — check the pattern");
    for (const [method, file] of calls) {
      const scope = REPORT_METHOD_SCOPE[method];
      assert.ok(scope, `${file}: accountingApi.${method} has no scope mapping — add one`);
      assert.ok(
        XERO_CLIENT_CREDENTIALS_SCOPES.includes(scope),
        `${file}: accountingApi.${method} needs ${scope}, which is not requested`,
      );
    }
  });

  it("only the opt-in journal tools call the Journals endpoint (accounting.journals.read)", () => {
    // getJournal, getJournals, getJournalByNumber; never getManualJournal*.
    const journalsCall = /accountingApi\s*\.\s*getJournal(?:s|ByNumber)?\s*\(/;
    const handlers = handlersSource
      .filter(({ src }) => journalsCall.test(src))
      .map(({ file }) => file);
    assert.deepEqual(handlers.sort(), [
      "get-xero-journal.handler.js",
      "list-xero-journals.handler.js",
    ]);

    // The tools wired to those handlers must be exactly the gated ones, or a
    // new caller would be registered without XERO_ENABLE_JOURNALS and fail.
    const toolsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "tools");
    const callers = readdirSync(toolsDir, { recursive: true })
      .filter((f) => f.endsWith(".tool.js"))
      .map((f) => readFileSync(join(toolsDir, f), "utf8"))
      .filter((src) => handlers.some((h) => src.includes(`/handlers/${h}"`)))
      .map((src) => src.match(/CreateXeroTool\(\s*"([a-z0-9_]+)"/)?.[1]);
    assert.deepEqual(callers.sort(), [...XERO_JOURNAL_TOOL_NAMES].sort());
  });
});

describe("documented scope lists stay in sync with the code", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const expected = [...EXPECTED_SCOPES].sort();

  // First fenced code block after `marker` in a markdown file, as a sorted
  // list of whitespace-separated scope tokens.
  const docBlock = (file, marker) => {
    const s = readFileSync(join(root, file), "utf8");
    const at = s.indexOf(marker);
    assert.ok(at >= 0, `${file}: marker ${JSON.stringify(marker)} not found`);
    const open = s.indexOf("```", at);
    const bodyStart = s.indexOf("\n", open) + 1;
    const close = s.indexOf("```", bodyStart);
    return s.slice(bodyStart, close).split(/\s+/).filter(Boolean).sort();
  };

  it("README.md", () => {
    assert.deepEqual(docBlock("README.md", "By default the server requests the following scopes"), expected);
  });

  it("SECURITY.md", () => {
    assert.deepEqual(docBlock("SECURITY.md", "## OAuth Scopes"), expected);
  });

  it("test/live-smoke.mjs (GRANULAR default, BROAD_TX = receipt scopes, JOURNALS = journal scopes)", () => {
    const s = readFileSync(join(root, "test", "live-smoke.mjs"), "utf8");
    const listOf = (name) => {
      const m = s.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
      assert.ok(m, `live-smoke.mjs: ${name} not found`);
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    };
    assert.deepEqual([...listOf("GRANULAR")].sort(), expected);
    assert.deepEqual(listOf("BROAD_TX"), RECEIPT_SCOPES);
    assert.deepEqual(listOf("JOURNALS"), JOURNAL_SCOPES);
  });
});

// Runs fn with the given opt-in flags set, then clears them again.
async function withFlags(flags, fn) {
  Object.assign(process.env, flags);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(flags)) process.env[key] = "";
  }
}

describe("token request on the wire", () => {
  let endpoint;

  before(async () => {
    endpoint = await startRejectingTokenEndpoint(xeroClient);
  });

  after(async () => {
    await endpoint.stop();
  });

  async function scopesSentWith(flags) {
    endpoint.reset();
    await withFlags(flags, () => listInvoicesFactory().handler({ page: 1 }));
    assert.equal(endpoint.requests.length, 1);
    return new URLSearchParams(endpoint.requests[0].body).get("scope").split(" ");
  }

  it("sends exactly the requested scope list", async () => {
    await listInvoicesFactory().handler({ page: 1 });
    assert.equal(endpoint.requests.length, 1);
    const params = new URLSearchParams(endpoint.requests[0].body);
    assert.equal(params.get("grant_type"), "client_credentials");
    assert.deepEqual(params.get("scope").split(" "), EXPECTED_SCOPES);
  });

  it("adds the receipt scopes on the wire only when XERO_ENABLE_RECEIPTS=1", async () => {
    assert.deepEqual(await scopesSentWith({ XERO_ENABLE_RECEIPTS: "1" }), [
      ...EXPECTED_SCOPES,
      ...RECEIPT_SCOPES,
    ]);
  });

  it("adds accounting.journals.read on the wire only when XERO_ENABLE_JOURNALS=1", async () => {
    assert.deepEqual(await scopesSentWith({ XERO_ENABLE_JOURNALS: "1" }), [
      ...EXPECTED_SCOPES,
      ...JOURNAL_SCOPES,
    ]);
  });

  it("adds both opt-in scope sets on the wire when both flags are set", async () => {
    assert.deepEqual(
      await scopesSentWith({ XERO_ENABLE_RECEIPTS: "1", XERO_ENABLE_JOURNALS: "1" }),
      [...EXPECTED_SCOPES, ...RECEIPT_SCOPES, ...JOURNAL_SCOPES],
    );
  });
});

describe("token error mapping", () => {
  const SECRET_MARKERS = /offline-test-secret|offline-test-id|b2ZmbGluZ|access_token|SENTINEL/;
  const CUTOFF = "connections created on or after 29 April 2026";

  async function errorFor(status, body) {
    const endpoint = await startRejectingTokenEndpoint(xeroClient, { status, body });
    try {
      const res = await listInvoicesFactory().handler({ page: 1 });
      assert.equal(res.isError, true);
      return res.content[0].text;
    } finally {
      await endpoint.stop();
    }
  }

  it("surfaces invalid_scope and does not blame the client credentials", async () => {
    const text = await errorFor(400, {
      error: "invalid_scope",
      error_description: "SENTINEL description that must not be echoed",
    });
    assert.match(text, /HTTP 400 invalid_scope/);
    assert.match(text, /not been granted every scope/);
    assert.doesNotMatch(text, /XERO_CLIENT_ID|XERO_CLIENT_SECRET/);
    assert.doesNotMatch(text, SECRET_MARKERS);
  });

  it("points only at the default scopes on invalid_scope when no opt-in is set", async () => {
    const text = await errorFor(400, { error: "invalid_scope" });
    assert.match(text, /Grant the default scopes listed in the README \(Custom Connections\) at developer\.xero\.com\.$/);
    assert.doesNotMatch(text, /XERO_ENABLE_|accounting\.transactions|accounting\.journals/);
  });

  it("suggests unsetting XERO_ENABLE_RECEIPTS on invalid_scope when it is set", async () => {
    const text = await withFlags({ XERO_ENABLE_RECEIPTS: "1" }, () =>
      errorFor(400, { error: "invalid_scope" }),
    );
    assert.ok(
      text.endsWith(
        ", or unset XERO_ENABLE_RECEIPTS if this connection cannot be granted " +
          `accounting.transactions (${CUTOFF} cannot be granted it).`,
      ),
      text,
    );
    assert.doesNotMatch(text, /XERO_ENABLE_JOURNALS|accounting\.journals/);
  });

  it("suggests unsetting XERO_ENABLE_JOURNALS on invalid_scope when it is set", async () => {
    const text = await withFlags({ XERO_ENABLE_JOURNALS: "1" }, () =>
      errorFor(400, { error: "invalid_scope" }),
    );
    assert.ok(
      text.endsWith(
        ", or unset XERO_ENABLE_JOURNALS if this connection cannot be granted " +
          `accounting.journals.read (${CUTOFF} cannot be granted it).`,
      ),
      text,
    );
    assert.doesNotMatch(text, /XERO_ENABLE_RECEIPTS|accounting\.transactions/);
  });

  it("names both opt-in flags on invalid_scope when both are set", async () => {
    const text = await withFlags(
      { XERO_ENABLE_RECEIPTS: "1", XERO_ENABLE_JOURNALS: "1" },
      () => errorFor(400, { error: "invalid_scope" }),
    );
    assert.ok(
      text.endsWith(
        ", or unset XERO_ENABLE_RECEIPTS if this connection cannot be granted " +
          "accounting.transactions, or unset XERO_ENABLE_JOURNALS if this " +
          "connection cannot be granted accounting.journals.read " +
          `(${CUTOFF} cannot be granted either).`,
      ),
      text,
    );
  });

  it("keeps the credentials hint for invalid_client", async () => {
    const text = await errorFor(401, { error: "invalid_client" });
    assert.match(text, /HTTP 401 invalid_client - check XERO_CLIENT_ID\/XERO_CLIENT_SECRET/);
  });

  it("never echoes an error field that is not a plain OAuth code", async () => {
    const text = await errorFor(400, {
      error: "SENTINEL client_secret=offline-test-secret",
    });
    assert.match(text, /HTTP 400/);
    assert.doesNotMatch(text, SECRET_MARKERS);
  });

  it("never echoes the body of a non-JSON error", async () => {
    const text = await errorFor(500, "SENTINEL access_token=abc");
    assert.match(text, /HTTP 500/);
    assert.doesNotMatch(text, SECRET_MARKERS);
  });
});

describe("receipt entity types are gated when receipts are disabled", () => {
  it("returns a clear error for entityType receipts", () => {
    assert.match(receiptsDisabledError("receipts", {}), /XERO_ENABLE_RECEIPTS=1/);
    assert.equal(receiptsDisabledError("receipts", { XERO_ENABLE_RECEIPTS: "1" }), null);
    assert.equal(receiptsDisabledError("invoices", {}), null);
  });

  it("list_attachments refuses receipts before authenticating", async () => {
    const { default: listAttachmentsFactory } = await import(
      "../dist/tools/list/list-attachments.tool.js"
    );
    const endpoint = await startRejectingTokenEndpoint(xeroClient);
    try {
      const res = await listAttachmentsFactory().handler({
        entityType: "receipts",
        entityId: "11111111-2222-3333-4444-555555555555",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /Receipts are disabled/);
      assert.equal(endpoint.requests.length, 0);
    } finally {
      await endpoint.stop();
    }
  });
});
