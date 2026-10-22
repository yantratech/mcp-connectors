/**
 * Offline tests for the manual-journal and organisation-details tools:
 *
 *  - list_manual_journals excludes DELETED/VOIDED by default (where-clause on
 *    the wire), reports the excluded counts in the header, and takes a
 *    `statuses` param to opt back in — mirroring list_invoices;
 *  - the list header carries explicit pagination ("page N of M; T total") from
 *    Xero's pagination metadata instead of a bare "Found 10 manual journals:";
 *  - manual-journal line amounts render an explicit Dr:/Cr: split
 *    (positive = debit, negative = credit), matching list_journals;
 *  - list_organisation_details never prints a literal "undefined" — empty
 *    PaymentTerms says "No payment terms available.", set terms render
 *    day/type (never "[object Object]"), external links degrade gracefully.
 *
 * Everything runs against compiled dist/ with the Xero accounting API stubbed
 * at the client singleton — no network, no live API. The stubs capture the
 * outgoing wire request (where/order/page/pageSize) so the request shape is
 * pinned alongside the rendered output.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Dynamic imports so the env assignments above run first (static imports
// are hoisted ahead of them).
const { xeroClient } = await import("../dist/clients/xero-client.js");
const manualJournalsModule = await import(
  "../dist/tools/list/list-manual-journals.tool.js"
);
const { listXeroManualJournals } = await import(
  "../dist/handlers/list-xero-manual-journals.handler.js"
);
const { default: getManualJournalFactory } = await import(
  "../dist/tools/get/get-manual-journal.tool.js"
);
const { default: listOrganisationDetailsFactory } = await import(
  "../dist/tools/list/list-organisation-details.tool.js"
);
const { formatManualJournalLineDrCr } = await import(
  "../dist/helpers/format-manual-journal-line.js"
);

const schemaOf = (factory) => z.object(factory().schema);

// ---------------------------------------------------------------------------
// Client stubbing: no network. authenticate() is a no-op and accountingApi is
// replaced per-test with a fake that records every outgoing request.
// ---------------------------------------------------------------------------
xeroClient.authenticate = async () => {};
xeroClient.tenantId = "tenant-offline";

const installApi = (api) =>
  Object.defineProperty(xeroClient, "accountingApi", {
    value: api,
    configurable: true,
  });

const DEFAULT_WHERE = 'Status=="DRAFT" OR Status=="POSTED" OR Status=="ARCHIVED"';

// Fixture shaped like a signed-amount journal (account 495 debited, account
// 135 credited): without an explicit Dr/Cr split, the signed amounts are
// easy to misread.
const mtmJournal = {
  manualJournalID: "e0a1b2c3-0000-4000-8000-000000000005",
  narration: "Example revaluation",
  date: "2026-01-31",
  status: "POSTED",
  lineAmountTypes: "NoTax",
  journalLines: [
    {
      lineAmount: 1000.5,
      accountCode: "495",
      description: "Example revaluation",
      taxType: "NONE",
      taxAmount: 0,
    },
    {
      lineAmount: -1000.5,
      accountCode: "135",
      description: "Example revaluation",
      taxType: "NONE",
      taxAmount: 0,
    },
  ],
};

const draftJournal = {
  manualJournalID: "mj-draft-1",
  narration: "Draft accrual",
  date: "2026-07-01",
  status: "DRAFT",
  journalLines: [
    { lineAmount: 100, accountCode: "400", taxAmount: 0 },
    { lineAmount: -100, accountCode: "800", taxAmount: 0 },
  ],
};

function makeManualJournalsApi({
  pagination = { page: 1, pageSize: 10, pageCount: 3, itemCount: 25 },
  deletedCount = 12,
  voidedCount = 13,
  failProbes = false,
} = {}) {
  const calls = [];
  const api = {
    getManualJournals: async (
      _tenantId,
      _ifModifiedSince,
      where,
      order,
      page,
      pageSize,
    ) => {
      calls.push({ method: "getManualJournals", where, order, page, pageSize });
      if (pageSize === 1) {
        // Excluded-count probe.
        if (failProbes) throw new Error("probe failed");
        const itemCount =
          where === 'Status=="DELETED"' ? deletedCount : voidedCount;
        return { body: { manualJournals: [], pagination: { itemCount } } };
      }
      return {
        body: {
          manualJournals: [mtmJournal, draftJournal],
          ...(pagination ? { pagination } : {}),
        },
      };
    },
    getManualJournal: async (_tenantId, manualJournalId) => {
      calls.push({ method: "getManualJournal", manualJournalId });
      return { body: { manualJournals: [mtmJournal] } };
    },
  };
  return { api, calls };
}

describe("list_manual_journals default status filter (wire request + header)", () => {
  it("excludes DELETED/VOIDED on the wire by default and reports counts", async () => {
    const { api, calls } = makeManualJournalsApi();
    installApi(api);

    const tool = manualJournalsModule.default();
    const res = await tool.handler({ page: 1 }, {});
    assert.notEqual(res.isError, true);

    // Wire: main page filtered to the default statuses, invoice-style.
    assert.equal(calls[0].where, DEFAULT_WHERE);
    assert.equal(calls[0].order, "UpdatedDateUTC DESC");
    assert.equal(calls[0].pageSize, 10);
    // Wire: one pageSize-1 count probe per hidden status, page 1 only.
    const probes = calls.slice(1);
    assert.deepEqual(
      probes.map((c) => [c.where, c.pageSize]),
      [
        ['Status=="DELETED"', 1],
        ['Status=="VOIDED"', 1],
      ],
    );

    const header = res.content[0].text;
    assert.match(
      header,
      /Found 2 manual journals \(page 1 of 3; 25 total matching\)\./,
    );
    assert.match(
      header,
      /Excluded by default: 12 DELETED and 13 VOIDED manual journals/,
    );
    assert.match(header, /pass statuses/);
    // Regression guard: no bare count-only header.
    assert.doesNotMatch(header, /^Found \d+ manual journals:$/m);
  });

  it("honours an explicit statuses override and skips the probes", async () => {
    const { api, calls } = makeManualJournalsApi();
    installApi(api);

    const tool = manualJournalsModule.default();
    const res = await tool.handler({ page: 1, statuses: ["VOIDED"] }, {});

    assert.equal(calls.length, 1);
    assert.equal(calls[0].where, 'Status=="VOIDED"');
    assert.doesNotMatch(res.content[0].text, /Excluded by default/);
  });

  it("skips the count probes beyond page 1 but still notes the exclusion", async () => {
    const { api, calls } = makeManualJournalsApi();
    installApi(api);

    const tool = manualJournalsModule.default();
    const res = await tool.handler({ page: 2 }, {});

    assert.equal(calls.length, 1);
    assert.equal(calls[0].page, 2);
    assert.match(
      res.content[0].text,
      /DELETED and VOIDED manual journals are excluded by default \(counts reported on page 1\)/,
    );
  });

  it("survives a failed count probe (best-effort) and still notes the exclusion", async () => {
    const { api } = makeManualJournalsApi({ failProbes: true });
    installApi(api);

    const tool = manualJournalsModule.default();
    const res = await tool.handler({ page: 1 }, {});

    assert.notEqual(res.isError, true);
    assert.equal(res.content.length, 3); // header + 2 journals
    assert.match(
      res.content[0].text,
      /DELETED and VOIDED manual journals are excluded by default/,
    );
  });

  it("falls back to an explicit more-pages-may-exist marker without pagination metadata", async () => {
    const { api } = makeManualJournalsApi({ pagination: null });
    installApi(api);

    const tool = manualJournalsModule.default();
    const res = await tool.handler({ page: 1 }, {});
    assert.match(
      res.content[0].text,
      /page 1; 10 per page — if 10 were returned, more pages may exist/,
    );
  });

  it("rejects a free-text status before anything reaches the wire (defense-in-depth on the exported handler)", async () => {
    const { api, calls } = makeManualJournalsApi();
    installApi(api);

    const response = await listXeroManualJournals(1, undefined, undefined, [
      'x" OR Status=="DELETED',
    ]);

    assert.equal(response.isError, true);
    assert.match(response.error, /Invalid manual journal status/);
    assert.equal(calls.length, 0);
  });

  it("fetches by ID without status filtering and says so", async () => {
    const { api, calls } = makeManualJournalsApi();
    installApi(api);

    const tool = manualJournalsModule.default();
    const res = await tool.handler(
      { page: 1, manualJournalId: mtmJournal.manualJournalID },
      {},
    );

    assert.deepEqual(
      calls.map((c) => c.method),
      ["getManualJournal"],
    );
    assert.match(res.content[0].text, /Found 1 manual journals \(fetched by ID\)\./);
  });
});

describe("manual-journal Dr/Cr rendering (positive = debit, negative = credit)", () => {
  it("formatManualJournal labels each signed line amount with a Dr:/Cr: split", () => {
    const text = manualJournalsModule.formatManualJournal(mtmJournal);
    assert.match(text, /Line Amount: 1000\.5 \(Dr:1000\.5 Cr:0\)/);
    assert.match(text, /Line Amount: -1000\.5 \(Dr:0 Cr:1000\.5\)/);
    // Per-row status stays.
    assert.match(text, /Status: POSTED/);
    // Regression guard: no bare unlabelled amount line.
    for (const line of text.split("\n")) {
      if (line.startsWith("Line Amount:")) {
        assert.match(line, /\(Dr:[\d.]+ Cr:[\d.]+\)/, line);
      }
    }
  });

  it("rendered debits equal rendered credits across a balanced journal", () => {
    const text = manualJournalsModule.formatManualJournal(mtmJournal);
    const drs = [...text.matchAll(/Dr:([\d.]+)/g)].map((m) => Number(m[1]));
    const crs = [...text.matchAll(/Cr:([\d.]+)/g)].map((m) => Number(m[1]));
    assert.equal(
      drs.reduce((a, b) => a + b, 0),
      crs.reduce((a, b) => a + b, 0),
    );
  });

  it("formatManualJournalLineDrCr never prints 'undefined' for an absent amount", () => {
    const text = formatManualJournalLineDrCr({});
    assert.doesNotMatch(text, /undefined/);
    assert.equal(text, "Dr:0 Cr:0");
  });

  it("get_manual_journal renders the same Dr:/Cr: split with an inline legend", async () => {
    const { api } = makeManualJournalsApi();
    installApi(api);

    const tool = getManualJournalFactory();
    const res = await tool.handler(
      { manualJournalId: mtmJournal.manualJournalID },
      {},
    );
    const text = res.content[0].text;
    assert.match(text, /Journal Lines \(positive = debit, negative = credit\):/);
    assert.match(text, /Amount: 1000\.5 \(Dr:1000\.5 Cr:0\)/);
    assert.match(text, /Amount: -1000\.5 \(Dr:0 Cr:1000\.5\)/);
  });
});

describe("manual-journal descriptions and schema (exclusion, pagination, sign legend)", () => {
  it("list_manual_journals no longer claims a 'complete overview' and documents the default exclusion", () => {
    const tool = manualJournalsModule.default();
    assert.doesNotMatch(tool.description, /complete overview/i);
    assert.match(tool.description, /DELETED and VOIDED journals[\s\S]*EXCLUDED/);
    assert.match(tool.description, /page N of M; T total/);
    assert.match(tool.description, /positive = debit, negative =\s*credit/);
  });

  it("get_manual_journal documents the sign convention", () => {
    const tool = getManualJournalFactory();
    assert.match(tool.description, /positive = debit, negative = credit/);
  });

  it("statuses enum accepts DELETED/VOIDED opt-in and rejects garbage; page defaults to 1", () => {
    const s = schemaOf(manualJournalsModule.default);
    assert.equal(s.parse({}).page, 1);
    assert.equal(s.safeParse({ statuses: ["DELETED", "VOIDED"] }).success, true);
    assert.equal(s.safeParse({ statuses: ["BOGUS"] }).success, false);
  });

  it("touched tools stay read-only annotated", () => {
    for (const factory of [
      manualJournalsModule.default,
      getManualJournalFactory,
      listOrganisationDetailsFactory,
    ]) {
      const tool = factory();
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    }
  });
});

describe("list_organisation_details rendering (no literal 'undefined')", () => {
  const runWithOrganisation = async (organisation) => {
    installApi({
      getOrganisations: async () => ({
        body: { organisations: [organisation] },
      }),
    });
    const tool = listOrganisationDetailsFactory();
    const res = await tool.handler({}, {});
    assert.notEqual(res.isError, true);
    return res.content[1].text;
  };

  it("says no payment terms are available when upstream PaymentTerms is empty", async () => {
    const text = await runWithOrganisation({
      name: "Test Org",
      // The SDK deserialises "PaymentTerms": {} into an object whose keys
      // exist but are undefined — the shape that used to render
      // "1. bills: undefined".
      paymentTerms: { bills: undefined, sales: undefined },
    });
    // Same 'No X available.' empty-state convention as the rest of the tool.
    assert.match(text, /Payment Terms:\nNo payment terms available\./);
    assert.doesNotMatch(text, /bills: undefined/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("renders configured payment terms by day/type, never '[object Object]'", async () => {
    const text = await runWithOrganisation({
      name: "Test Org",
      paymentTerms: {
        bills: { day: 20, type: "OFFOLLOWINGMONTH" },
        sales: undefined,
      },
    });
    assert.match(text, /1\. bills: day 20, type OFFOLLOWINGMONTH/);
    assert.doesNotMatch(text, /\[object Object\]/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("degrades external links gracefully instead of printing 'undefined'", async () => {
    const text = await runWithOrganisation({
      name: "Test Org",
      externalLinks: [{ linkType: "Website" }],
      paymentTerms: {},
    });
    assert.match(text, /1\. Website: No URL/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("labels an empty external-links section instead of leaving it blank", async () => {
    const text = await runWithOrganisation({
      name: "Test Org",
      externalLinks: [],
      paymentTerms: {},
    });
    assert.match(text, /External Links:\nNo external links available\./);
  });
});
