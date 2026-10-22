/**
 * Regression tests for check_control_status output accuracy: slim-by-default
 * output, compact serialization, and unmatchedCodes instead of a bare
 * zero-summary when the requested codes match nothing.
 *
 * Own mock Drata V2 API; no live calls. Run: node --test test/fix-checkcontrols.test.js
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, unlinkSync } from "node:fs";

const STATE_PATH = `/tmp/drata-fix-checkcontrols-state-${process.pid}.json`;

function emptyEvidenceIds() {
  return {
    validExternalEvidenceIds: [],
    invalidExternalEvidenceIds: [],
    validReportIds: [],
    invalidReportIds: [],
  };
}
function emptyTestIds() {
  return { passing: [], failing: [], monitored: [] };
}

// Same semantic mix as the e2e fixture: monitor-only evidence (narrow flag
// false), policy-only, external, evidence-free, and one archived control.
const SMALL_CONTROLS = [
  {
    id: 26,
    code: "DCF-26",
    name: "Policy acknowledgement",
    archivedAt: null,
    flags: {
      hasEvidence: false,
      hasPolicy: false,
      hasTicket: false,
      isReady: false,
      isMonitored: true,
      hasOwner: true,
    },
    evidenceIds: emptyEvidenceIds(),
    testIds: { passing: [9001], failing: [], monitored: [9001] },
    frameworkTags: ["SOC_2"],
  },
  {
    id: 21,
    code: "DCF-21",
    name: "Architecture review",
    archivedAt: null,
    flags: {
      hasEvidence: false,
      hasPolicy: true,
      hasTicket: false,
      isReady: true,
      isMonitored: false,
      hasOwner: true,
    },
    evidenceIds: emptyEvidenceIds(),
    testIds: emptyTestIds(),
    frameworkTags: ["SOC_2"],
  },
  {
    id: 33,
    code: "DCF-33",
    name: "Vendor management",
    archivedAt: null,
    flags: {
      hasEvidence: true,
      hasPolicy: false,
      hasTicket: false,
      isReady: true,
      isMonitored: false,
      hasOwner: false,
    },
    evidenceIds: { ...emptyEvidenceIds(), validExternalEvidenceIds: [7001] },
    testIds: emptyTestIds(),
    frameworkTags: ["SOC_2", "ISO_27001"],
  },
  {
    id: 44,
    code: "DCF-44",
    name: "Tabletop exercise",
    archivedAt: null,
    flags: {
      hasEvidence: false,
      hasPolicy: false,
      hasTicket: false,
      isReady: false,
      isMonitored: false,
      hasOwner: false,
    },
    evidenceIds: emptyEvidenceIds(),
    testIds: emptyTestIds(),
    frameworkTags: ["SOC_2"],
  },
  {
    id: 55,
    code: "DCF-55",
    name: "Retired control",
    archivedAt: "2025-11-30T00:00:00.000Z",
    flags: {
      hasEvidence: false,
      hasPolicy: false,
      hasTicket: false,
      isReady: false,
      isMonitored: false,
      hasOwner: true,
    },
    evidenceIds: emptyEvidenceIds(),
    testIds: emptyTestIds(),
    frameworkTags: ["SOC_2"],
  },
];

// Realistic-scale tenant (185 in-scope controls with verbose names, about the
// size of a typical SOC 2 workspace) for the serialized-size regression test.
function makeLargeControls(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 1000 + i,
    code: `DCF-${100 + i}`,
    name: `Continuous monitoring of production ${i}`,
    archivedAt: null,
    flags: {
      hasEvidence: i % 4 === 0,
      hasPolicy: i % 3 === 0,
      hasTicket: false,
      isReady: i % 2 === 0,
      isMonitored: i % 2 === 1,
      hasOwner: i % 5 !== 0,
    },
    evidenceIds: {
      ...emptyEvidenceIds(),
      validExternalEvidenceIds: i % 4 === 0 ? [7000 + i] : [],
    },
    testIds:
      i % 2 === 1
        ? { passing: [9000 + i], failing: [], monitored: [9000 + i] }
        : emptyTestIds(),
    frameworkTags: ["SOC_2"],
  }));
}

let server;
let controlsPayload = SMALL_CONTROLS;
let checkControls;
let toolDef;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (
      req.method === "GET" &&
      /^\/public\/v2\/workspaces\/\d+\/controls$/.test(url.pathname)
    ) {
      res.setHeader("content-type", "application/json");
      return res.end(
        JSON.stringify({ data: controlsPayload, pagination: { cursor: null } }),
      );
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: `unexpected ${req.method} ${url.pathname}` }));
  });
  await new Promise((resolve) => server.listen(0, resolve));

  process.env.DRATA_API_KEY = "test-key-12345";
  process.env.DRATA_BASE_URL = `http://localhost:${server.address().port}`;
  process.env.DRATA_MCP_STATE_PATH = STATE_PATH;
  process.env.DRATA_WORKSPACE_ID = "1";

  ({ checkControls } = await import("../dist/handlers/check-controls.handler.js"));
  const toolMod = await import("../dist/tools/check/check-control-status.tool.js");
  toolDef = toolMod.default();
});

after(() => {
  server.close();
  delete process.env.DRATA_WORKSPACE_ID;
  if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);
});

describe("check_control_status slim-by-default output", () => {
  it("defaults each control to the slim projection, evidence semantics intact", async () => {
    controlsPayload = SMALL_CONTROLS;
    const res = await checkControls("all", undefined, {});
    assert.equal(res.isError, false, res.error);

    assert.equal(res.result.summary.totalControls, 4);
    assert.equal(res.result.summary.controlsWithAnyEvidence, 3);
    for (const c of res.result.controls) {
      assert.deepEqual(Object.keys(c), [
        "id",
        "code",
        "name",
        "isReady",
        "isMonitored",
        "hasEvidence",
        "hasOwner",
      ]);
    }
    // hasEvidence still means ANY kind: monitor-test-only DCF-26 is true.
    const dcf26 = res.result.controls.find((c) => c.code === "DCF-26");
    assert.equal(dcf26.hasEvidence, true);
    // The detail opt-in is signposted, and the verified-good leading keys
    // stay first (serialization order = insertion order).
    assert.match(res.result.projectionNote, /fields/);
    assert.deepEqual(Object.keys(res.result), [
      "filter",
      "count",
      "summary",
      "semanticsNote",
      "projectionNote",
      "controls",
    ]);
  });

  it("fields[] opts back into the per-source evidence breakdown", async () => {
    controlsPayload = SMALL_CONTROLS;
    const res = await checkControls("all", undefined, {
      fields: ["code", "evidence"],
    });
    assert.equal(res.isError, false, res.error);
    const dcf26 = res.result.controls.find((c) => c.code === "DCF-26");
    assert.equal(dcf26.evidence.monitorTestCount, 1);
    assert.equal(dcf26.evidence.drataHasEvidenceFlag, false);
    const dcf21 = res.result.controls.find((c) => c.code === "DCF-21");
    assert.equal(dcf21.evidence.hasMappedPolicy, true);
    assert.equal(res.result.projectionNote, undefined);
  });

  it("archived controls stay recognizable under includeArchived", async () => {
    controlsPayload = SMALL_CONTROLS;
    const res = await checkControls("all", undefined, { includeArchived: true });
    assert.equal(res.isError, false, res.error);
    const archived = res.result.controls.find((c) => c.code === "DCF-55");
    assert.equal(archived.archivedAt, "2025-11-30T00:00:00.000Z");
    const live = res.result.controls.find((c) => c.code === "DCF-26");
    assert.ok(!("archivedAt" in live), "live controls carry no archivedAt in slim rows");
  });
});

describe("check_control_status unmatchedCodes", () => {
  it("reports codes that match nothing instead of a bare zero-summary", async () => {
    controlsPayload = SMALL_CONTROLS;
    const res = await checkControls("all", undefined, {
      codes: ["dcf-26", "DCF-9999"],
    });
    assert.equal(res.isError, false, res.error);
    assert.deepEqual(res.result.unmatchedCodes, ["DCF-9999"]);
    assert.match(res.result.unmatchedCodesNote, /match no control/);
    assert.equal(res.result.count, 1);
    assert.equal(res.result.controls[0].code, "DCF-26");
    // unmatchedCodes leads, before count/summary.
    const keys = Object.keys(res.result);
    assert.ok(keys.indexOf("unmatchedCodes") < keys.indexOf("count"));
    assert.equal(keys[0], "filter");
  });

  it("all-miss returns count 0 WITH the unmatched signal", async () => {
    controlsPayload = SMALL_CONTROLS;
    const res = await checkControls("all", undefined, { codes: ["DCF-9999"] });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.count, 0);
    assert.equal(res.result.summary.totalControls, 0);
    assert.deepEqual(res.result.unmatchedCodes, ["DCF-9999"]);
    assert.ok(res.result.unmatchedCodesNote);
  });

  it("all-match reports an explicit empty unmatchedCodes and no note", async () => {
    controlsPayload = SMALL_CONTROLS;
    const res = await checkControls("all", undefined, { codes: ["DCF-26"] });
    assert.equal(res.isError, false, res.error);
    assert.deepEqual(res.result.unmatchedCodes, []);
    assert.equal(res.result.unmatchedCodesNote, undefined);
    assert.equal(res.result.count, 1);
  });

  it("a code that exists but is archived is NOT unmatched — archivedControlsExcluded explains the zero", async () => {
    controlsPayload = SMALL_CONTROLS;
    const res = await checkControls("all", undefined, { codes: ["DCF-55"] });
    assert.equal(res.isError, false, res.error);
    assert.deepEqual(res.result.unmatchedCodes, []);
    assert.equal(res.result.count, 0);
    assert.equal(res.result.summary.archivedControlsExcluded, 1);
  });

  it("no codes requested → no unmatchedCodes key at all", async () => {
    controlsPayload = SMALL_CONTROLS;
    const res = await checkControls("all", undefined, {});
    assert.ok(!("unmatchedCodes" in res.result));
  });
});

describe("check_control_status tool serialization", () => {
  it("pretty header + one compact line per control, round-trippable JSON", async () => {
    controlsPayload = SMALL_CONTROLS;
    const out = await toolDef.handler({ filter: "all" });
    const text = out.content[0].text;
    assert.ok(text.includes('  "filter": "all"'), "header stays pretty-printed");
    assert.match(text, /\n {4}\{"id":26,"code":"DCF-26"/, "controls rows are compact");
    const parsed = JSON.parse(text);
    assert.equal(parsed.count, 4);
    assert.equal(parsed.controls.length, 4);
    // Exactly one line per control row.
    const rowLines = text.split("\n").filter((l) => l.startsWith('    {"id":'));
    assert.equal(rowLines.length, 4);
  });

  it("empty result serializes cleanly", async () => {
    controlsPayload = SMALL_CONTROLS;
    const out = await toolDef.handler({ filter: "all", codes: ["DCF-9999"] });
    const parsed = JSON.parse(out.content[0].text);
    assert.deepEqual(parsed.controls, []);
    assert.deepEqual(parsed.unmatchedCodes, ["DCF-9999"]);
  });

  it('filter:"all" on a 185-control tenant stays under 35k chars', async () => {
    controlsPayload = makeLargeControls(185);
    try {
      const out = await toolDef.handler({ filter: "all" });
      const text = out.content[0].text;
      const parsed = JSON.parse(text);
      assert.equal(parsed.count, 185);
      assert.ok(
        text.length < 35000,
        `filter:"all" serialized to ${text.length} chars (target < 35000)`,
      );
    } finally {
      controlsPayload = SMALL_CONTROLS;
    }
  });
});
