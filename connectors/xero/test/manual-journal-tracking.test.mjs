/**
 * Manual journals: tracking categories on lines, and date/order filtering
 * on list_manual_journals.
 *
 *  - create_manual_journal / update_manual_journal accept up to two tracking
 *    categories per line (shared schema), the handlers put them on the wire,
 *    and create/get/list render them back;
 *  - create_manual_journal's response renders each line as text (it used to
 *    print "[object Object]" per line);
 *  - list_manual_journals gains dateFrom/dateTo (inclusive journal date) and
 *    an allowlisted `order`, validated before any token exchange, applied to
 *    the main page and to the excluded-count probes, and with the default
 *    wire request unchanged when they are not used.
 *
 * Fully offline: authenticate/getShortCode are stubbed and accountingApi is
 * replaced with a recorder. Run via `npm test` after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

const { default: createManualJournalFactory } = await import(
  "../dist/tools/create/create-manual-journal.tool.js"
);
const { default: updateManualJournalFactory } = await import(
  "../dist/tools/update/update-manual-journal.tool.js"
);
const listManualJournalsModule = await import(
  "../dist/tools/list/list-manual-journals.tool.js"
);
const { default: getManualJournalFactory } = await import(
  "../dist/tools/get/get-manual-journal.tool.js"
);
const { listXeroManualJournals, MANUAL_JOURNAL_ORDERS } = await import(
  "../dist/handlers/list-xero-manual-journals.handler.js"
);
const { formatManualJournalLineTracking } = await import(
  "../dist/helpers/format-manual-journal-line.js"
);
const { xeroClient } = await import("../dist/clients/xero-client.js");

const schemaOf = (factory) => z.object(factory().schema);

const CATEGORY_ID = "e0a1b2c3-0000-4000-8000-000000000006";
const OPTION_ID = "e0a1b2c3-0000-4000-8000-000000000007";
const MJ_ID = "e0a1b2c3-0000-4000-8000-000000000005";

const REGION = { name: "Region", option: "North" };
const DEPT = {
  name: "Department",
  option: "Sales",
  trackingCategoryID: CATEGORY_ID,
  trackingOptionID: OPTION_ID,
};

const lines = (tracking) => [
  { lineAmount: 100, accountCode: "400", description: "Dr", ...(tracking ? { tracking } : {}) },
  { lineAmount: -100, accountCode: "200", description: "Cr" },
];

// --- offline stubbing ------------------------------------------------------

let authCalls;
let calls;

const journalFromPayload = (payload) => ({
  ...payload.manualJournals[0],
  manualJournalID: MJ_ID,
  status: payload.manualJournals[0].status ?? "DRAFT",
  showOnCashBasisReports: true,
  journalLines: payload.manualJournals[0].journalLines.map((l) => ({
    ...l,
    taxAmount: 0,
  })),
});

function installApi({ listPage = [], deletedCount = 2, voidedCount = 3 } = {}) {
  const api = {
    createManualJournals: async (tenantId, payload) => {
      calls.push({ method: "createManualJournals", payload });
      return { body: { manualJournals: [journalFromPayload(payload)] } };
    },
    updateManualJournal: async (tenantId, id, payload) => {
      calls.push({ method: "updateManualJournal", id, payload });
      return { body: { manualJournals: [journalFromPayload(payload)] } };
    },
    getManualJournals: async (_t, _since, where, order, page, pageSize) => {
      calls.push({ method: "getManualJournals", where, order, page, pageSize });
      if (pageSize === 1) {
        const itemCount = where.startsWith('Status=="DELETED"') ? deletedCount : voidedCount;
        return { body: { manualJournals: [], pagination: { itemCount } } };
      }
      return {
        body: {
          manualJournals: listPage,
          pagination: { page, pageSize, pageCount: 1, itemCount: listPage.length },
        },
      };
    },
    getManualJournal: async (_t, id) => {
      calls.push({ method: "getManualJournal", id });
      return { body: { manualJournals: listPage.slice(0, 1) } };
    },
  };
  Object.defineProperty(xeroClient, "accountingApi", { value: api, configurable: true });
}

beforeEach(() => {
  authCalls = 0;
  calls = [];
  xeroClient.authenticate = async () => {
    authCalls += 1;
  };
  xeroClient.getShortCode = async () => "!abc12";
  xeroClient.tenantId = "tenant-offline";
  installApi();
});

const trackedJournal = {
  manualJournalID: MJ_ID,
  narration: "Accrual",
  date: "2026-03-31",
  status: "POSTED",
  journalLines: [
    { lineAmount: 100, accountCode: "400", taxAmount: 0, tracking: [REGION, DEPT] },
    { lineAmount: -100, accountCode: "200", taxAmount: 0 },
  ],
};

// --- schemas ---------------------------------------------------------------

for (const [toolName, factory, base] of [
  ["create_manual_journal", createManualJournalFactory, { narration: "n" }],
  ["update_manual_journal", updateManualJournalFactory, { narration: "n", manualJournalID: MJ_ID }],
]) {
  describe(`${toolName} schema: line tracking`, () => {
    const schema = schemaOf(factory);
    const parse = (tracking) =>
      schema.safeParse({ ...base, manualJournalLines: lines(tracking) });

    it("still accepts lines without tracking", () => {
      assert.equal(parse(undefined).success, true);
    });

    it("accepts name/option tracking, with or without IDs, up to two categories", () => {
      assert.equal(parse([REGION]).success, true);
      assert.equal(parse([REGION, DEPT]).success, true);
    });

    it("rejects a third tracking category", () => {
      const res = parse([REGION, DEPT, { name: "Project", option: "X" }]);
      assert.equal(res.success, false);
      assert.match(res.error.issues[0].message, /at most 2 tracking categories/);
    });

    it("rejects the same category twice on one line", () => {
      const res = parse([REGION, { name: " region ", option: "South" }]);
      assert.equal(res.success, false);
      assert.match(res.error.issues[0].message, /only once per manual journal line/);
    });

    it("rejects the same category ID twice under different names", () => {
      const res = parse([
        { name: "Dept", option: "A", trackingCategoryID: CATEGORY_ID },
        { name: "Department", option: "B", trackingCategoryID: CATEGORY_ID.toUpperCase() },
      ]);
      assert.equal(res.success, false);
      assert.match(res.error.issues[0].message, /only once per manual journal line/);
    });

    it("rejects missing/empty option and non-GUID ids", () => {
      assert.equal(parse([{ name: "Region" }]).success, false);
      assert.equal(parse([{ name: "Region", option: "" }]).success, false);
      assert.equal(
        parse([{ ...REGION, trackingCategoryID: 'x") OR 1==1' }]).success,
        false,
      );
      assert.equal(parse([{ ...REGION, trackingOptionID: "nope" }]).success, false);
    });
  });
}

// --- wire + rendering --------------------------------------------------------

describe("create_manual_journal: tracking on the wire and in the response", () => {
  it("sends each line's tracking and omits it for untracked lines", async () => {
    const tool = createManualJournalFactory();
    const res = await tool.handler({ narration: "Accrual", manualJournalLines: lines([REGION, DEPT]) });
    assert.notEqual(res.isError, true);

    const [call] = calls.filter((c) => c.method === "createManualJournals");
    const [tracked, untracked] = call.payload.manualJournals[0].journalLines;
    assert.deepEqual(tracked.tracking, [
      { name: "Region", option: "North", trackingCategoryID: undefined, trackingOptionID: undefined },
      { name: "Department", option: "Sales", trackingCategoryID: CATEGORY_ID, trackingOptionID: OPTION_ID },
    ]);
    assert.equal(untracked.tracking, undefined);
  });

  it("renders every line as text, with Dr/Cr and tracking — never [object Object]", async () => {
    const tool = createManualJournalFactory();
    const res = await tool.handler({ narration: "Accrual", manualJournalLines: lines([REGION, DEPT]) });
    const text = res.content[0].text;
    assert.doesNotMatch(text, /\[object Object\]/);
    assert.match(text, /Line Amount: 100 \(Dr:100 Cr:0\)/);
    assert.match(text, /Line Amount: -100 \(Dr:0 Cr:100\)/);
    assert.match(text, /Tracking: Region: North, Department: Sales/);
    assert.equal((text.match(/Tracking:/g) ?? []).length, 1, "untracked line shows no Tracking row");
  });
});

describe("update_manual_journal: replace-lines semantics are spelled out for tracking", () => {
  it("tells the model to re-supply existing tracking (omitting it clears it)", () => {
    const tool = updateManualJournalFactory();
    assert.match(tool.description, /replaced wholesale/);
    assert.match(tool.description, /existing tracking/);
    assert.match(tool.description, /loses any tracking it had/);
    const trackingDescription =
      tool.schema.manualJournalLines.element.shape.tracking.description;
    assert.match(trackingDescription, /preserve tracking the line already has/);
  });
});

describe("update_manual_journal: tracking on the wire", () => {
  it("sends each line's tracking", async () => {
    const tool = updateManualJournalFactory();
    const res = await tool.handler({
      narration: "Accrual",
      manualJournalID: MJ_ID,
      manualJournalLines: lines([DEPT]),
    });
    assert.notEqual(res.isError, true);
    const [call] = calls.filter((c) => c.method === "updateManualJournal");
    assert.equal(call.id, MJ_ID);
    assert.deepEqual(call.payload.manualJournals[0].journalLines[0].tracking, [DEPT]);
    assert.equal(call.payload.manualJournals[0].journalLines[1].tracking, undefined);
  });
});

describe("reading tracking back", () => {
  it("formatManualJournalLineTracking renders name: option pairs or null", () => {
    assert.equal(formatManualJournalLineTracking({ tracking: [REGION, DEPT] }), "Region: North, Department: Sales");
    assert.equal(formatManualJournalLineTracking({ tracking: [] }), null);
    assert.equal(formatManualJournalLineTracking({}), null);
  });

  it("list_manual_journals renders line tracking", () => {
    const text = listManualJournalsModule.formatManualJournal(trackedJournal);
    assert.match(text, /Tracking: Region: North, Department: Sales/);
    assert.equal((text.match(/Tracking:/g) ?? []).length, 1);
  });

  it("get_manual_journal renders line tracking", async () => {
    installApi({ listPage: [trackedJournal] });
    // get_manual_journal's handler calls accountingApi.getManualJournal.
    const res = await getManualJournalFactory().handler({ manualJournalId: MJ_ID });
    assert.notEqual(res.isError, true);
    assert.match(res.content[0].text, /Tax Type: N\/A, Tracking: Region: North, Department: Sales/);
  });
});

// --- list_manual_journals: date range + order --------------------------------

const DEFAULT_STATUS_OR = 'Status=="DRAFT" OR Status=="POSTED" OR Status=="ARCHIVED"';

describe("list_manual_journals schema: dateFrom/dateTo/order", () => {
  const schema = schemaOf(listManualJournalsModule.default);

  it("accepts YYYY-MM-DD dates and every allowlisted order", () => {
    assert.equal(schema.safeParse({ dateFrom: "2026-01-01", dateTo: "2026-03-31" }).success, true);
    for (const order of MANUAL_JOURNAL_ORDERS) {
      assert.equal(schema.safeParse({ order }).success, true, order);
    }
  });

  it("rejects malformed dates and free-text orders", () => {
    for (const bad of ["2026-1-1", "01/02/2026", "2026-01-01T00:00", "2026-01-01) OR (1==1"]) {
      assert.equal(schema.safeParse({ dateFrom: bad }).success, false, bad);
      assert.equal(schema.safeParse({ dateTo: bad }).success, false, bad);
    }
    for (const bad of ["Narration ASC", "Date DESC, Status", "UpdatedDateUTC desc"]) {
      assert.equal(schema.safeParse({ order: bad }).success, false, bad);
    }
  });
});

describe("list_manual_journals handler: date range + order on the wire", () => {
  it("leaves the default wire request unchanged when no filter is given", async () => {
    await listXeroManualJournals(1);
    assert.equal(calls[0].where, DEFAULT_STATUS_OR);
    assert.equal(calls[0].order, "UpdatedDateUTC DESC");
  });

  it("ANDs an inclusive date range onto a parenthesised status group, main page and probes alike", async () => {
    await listXeroManualJournals(1, undefined, undefined, undefined, {
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
      order: "Date ASC",
    });
    const range = "Date>=DateTime(2026, 1, 1) AND Date<=DateTime(2026, 3, 31)";
    assert.deepEqual(
      calls.map((c) => [c.where, c.order, c.pageSize]),
      [
        [`(${DEFAULT_STATUS_OR}) AND ${range}`, "Date ASC", 10],
        [`Status=="DELETED" AND ${range}`, "Date ASC", 1],
        [`Status=="VOIDED" AND ${range}`, "Date ASC", 1],
      ],
    );
  });

  it("supports a single bound and a single explicit status", async () => {
    await listXeroManualJournals(1, undefined, undefined, ["POSTED"], { dateTo: "2026-12-31" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].where, 'Status=="POSTED" AND Date<=DateTime(2026, 12, 31)');
  });

  for (const [label, filters, message] of [
    ["an impossible calendar date", { dateFrom: "2026-02-30" }, /dateFrom must be a valid date/],
    ["an injection payload", { dateTo: "2026-01-01) OR (1==1" }, /dateTo must be a valid date/],
    ["dateFrom after dateTo", { dateFrom: "2026-04-01", dateTo: "2026-03-31" }, /dateFrom must be on or before dateTo/],
    ["a free-text order", { order: "Narration ASC" }, /Invalid manual journal order/],
  ]) {
    it(`rejects ${label} before authenticating or calling Xero`, async () => {
      const res = await listXeroManualJournals(1, undefined, undefined, undefined, filters);
      assert.equal(res.isError, true);
      assert.match(res.error, message);
      assert.equal(authCalls, 0);
      assert.equal(calls.length, 0);
    });
  }

  it("reports the active date range and order in the tool header", async () => {
    installApi({ listPage: [trackedJournal] });
    const res = await listManualJournalsModule.default().handler({
      page: 1,
      dateFrom: "2026-01-01",
      order: "Date DESC",
    });
    const header = res.content[0].text;
    assert.match(header, /Journal date filter: 2026-01-01 to any \(inclusive\)\./);
    assert.match(header, /Sorted by Date DESC\./);
  });
});
