import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Regression tests for check_monitors output accuracy:
//  - Drata's static failedTestDescription is emitted only on failing/error
//    monitors (as failureDetails); PASSED monitors carry no failure prose.
//  - TESTING checkStatus is a transient re-evaluation state, not disabled;
//    genuinely DISABLED monitors surface disabledMessage.
//  - Compact-by-default entries (static `description` template is opt-in via
//    fields[]), leading counts, and size/page pagination with hasMore.

let server;
let baseUrl;

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function makeInstance(id, ftd) {
  return {
    id,
    checkResultStatus: "N/A",
    checkFrequency: "DAILY",
    autopilotTaskType: "X",
    failedTestDescription: ftd,
    evidenceCollectionDescription: "",
    monitorInstanceCheckTypes: [],
  };
}

const MONITORS = [
  {
    id: 1,
    name: "Disk encryption",
    description: "All endpoints encrypt at rest",
    checkResultStatus: "PASSED",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "HIGH",
    lastCheck: "2026-07-29T12:00:00Z",
    monitorInstances: [makeInstance(11, "Some endpoints do not encrypt at rest.")],
  },
  {
    id: 2,
    name: "MFA enforced",
    description: "All admin accounts have MFA",
    checkResultStatus: "FAILED",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "HIGH",
    lastCheck: "2026-07-29T12:00:00Z",
    monitorInstances: [makeInstance(21, "2 admin accounts without MFA")],
  },
  {
    id: 3,
    name: "Vulnerability scanner",
    description: "No open critical vulnerabilities",
    checkResultStatus: "ERROR",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "NORMAL",
    lastCheck: "2026-07-29T12:00:00Z",
    monitorInstances: [makeInstance(31, "No vulnerability scanner connected.")],
  },
  {
    id: 4,
    name: "Sweep re-test",
    description: "Buckets are versioned",
    checkResultStatus: "PASSED",
    checkStatus: "TESTING",
    disabledMessage: null,
    priority: "LOW",
    lastCheck: "2026-07-29T12:00:00Z",
    monitorInstances: [makeInstance(41, "Buckets are not versioned.")],
  },
  {
    id: 5,
    name: "Old backups",
    description: "Daily backups run",
    checkResultStatus: "FAILED",
    checkStatus: "DISABLED",
    disabledMessage: "Customer disabled 2026-01-01",
    priority: "MEDIUM",
    lastCheck: "2026-06-01T12:00:00Z",
    monitorInstances: [makeInstance(51, "Backups are failing.")],
  },
  {
    id: 6,
    name: "Legacy agent",
    description: "Agent reports in",
    checkResultStatus: "READY",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "LOW",
    lastCheck: "2026-07-29T12:00:00Z",
    monitorInstances: [],
  },
];

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/public/monitors") {
      return json(res, {
        data: MONITORS,
        page: 1,
        limit: 50,
        total: MONITORS.length,
      });
    }
    return json(res, { data: [], page: 1, limit: 50, total: 0 });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = baseUrl;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("static failure template only on failing/error monitors", () => {
  it("PASSED/READY monitors carry no failure prose (no failureDetails, no failedReason)", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors("passing");
    assert.equal(res.isError, false);
    assert.deepEqual(res.result.monitors.map((m) => m.id).sort((a, b) => a - b), [1, 4, 6]);
    for (const m of res.result.monitors) {
      assert.equal("failureDetails" in m, false, `passing monitor ${m.id} leaked failureDetails`);
      assert.equal("failedReason" in m, false, `passing monitor ${m.id} still has failedReason`);
    }
  });

  it("failing monitors expose failureDetails", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors("failing");
    assert.deepEqual(res.result.monitors.map((m) => m.id).sort((a, b) => a - b), [2, 3]);
    const m2 = res.result.monitors.find((m) => m.id === 2);
    assert.equal(m2.failureDetails, "2 admin accounts without MFA");
    const m3 = res.result.monitors.find((m) => m.id === 3);
    assert.equal(m3.failureDetails, "No vulnerability scanner connected.");
    for (const m of res.result.monitors) {
      assert.equal("failedReason" in m, false);
    }
  });

  it("failureDetails stays absent on passing monitors even when requested via fields[]", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors(undefined, { fields: ["id", "status", "failureDetails"] });
    const m1 = res.result.monitors.find((m) => m.id === 1);
    assert.equal("failureDetails" in m1, false);
    const m2 = res.result.monitors.find((m) => m.id === 2);
    assert.equal(m2.failureDetails, "2 admin accounts without MFA");
  });
});

describe("TESTING is transient, not disabled; DISABLED surfaces disabledMessage", () => {
  it("statusCounts buckets TESTING and DISABLED separately and sums to totalMonitors", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors();
    assert.deepEqual(res.result.statusCounts, {
      passing: 3,
      failing: 2,
      error: 1,
      testing: 1,
      disabled: 1,
    });
    const { passing, failing, disabled } = res.result.statusCounts;
    assert.equal(passing + failing + disabled, res.result.totalMonitors);
  });

  it("filter=disabled returns only genuinely DISABLED monitors, with disabledMessage", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors("disabled");
    assert.deepEqual(res.result.monitors.map((m) => m.id), [5]);
    const m5 = res.result.monitors[0];
    assert.equal(m5.checkStatus, "DISABLED");
    assert.equal(m5.disabledMessage, "Customer disabled 2026-01-01");
    // Stale last result of a disabled monitor must not carry failure prose.
    assert.equal("failureDetails" in m5, false);
  });

  it("filter=testing isolates TESTING monitors; they also count in passing by last result", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const testing = await checkMonitors("testing");
    assert.deepEqual(testing.result.monitors.map((m) => m.id), [4]);
    assert.equal(testing.result.monitors[0].checkStatus, "TESTING");
    const passing = await checkMonitors("passing");
    assert.ok(passing.result.monitors.some((m) => m.id === 4));
    const disabled = await checkMonitors("disabled");
    assert.equal(disabled.result.monitors.some((m) => m.id === 4), false);
  });

  it("monitor-status helpers classify TESTING as not disabled", async () => {
    const helpers = await import("../dist/helpers/monitor-status.js");
    const testing = { checkStatus: "TESTING", checkResultStatus: "PASSED" };
    assert.equal(helpers.isMonitorDisabled(testing), false);
    assert.equal(helpers.isMonitorTesting(testing), true);
    assert.equal(helpers.isMonitorPassing(testing), true);
    const disabled = { checkStatus: "DISABLED", checkResultStatus: "FAILED" };
    assert.equal(helpers.isMonitorDisabled(disabled), true);
    assert.equal(helpers.isMonitorFailing(disabled), false);
    const legacy = { checkStatus: "ENABLED", checkResultStatus: "READY" };
    assert.equal(helpers.isMonitorPassing(legacy), true);
  });
});

describe("compact-by-default entries with leading counts", () => {
  it("default entries omit the static description and ENABLED checkStatus", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors();
    for (const m of res.result.monitors) {
      assert.equal("description" in m, false, `monitor ${m.id} leaked static description`);
    }
    const m1 = res.result.monitors.find((m) => m.id === 1);
    assert.equal("checkStatus" in m1, false, "ENABLED checkStatus should be elided");
    const m4 = res.result.monitors.find((m) => m.id === 4);
    assert.equal(m4.checkStatus, "TESTING", "non-ENABLED checkStatus must pass through");
  });

  it("description is opt-in via fields[]", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors(undefined, { fields: ["id", "description"] });
    const m1 = res.result.monitors.find((m) => m.id === 1);
    assert.equal(m1.description, "All endpoints encrypt at rest");
    assert.deepEqual(Object.keys(m1).sort(), ["description", "id"]);
  });

  it("counts, pagination and note precede the monitors array", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors();
    const keys = Object.keys(res.result);
    assert.equal(keys[keys.length - 1], "monitors");
    for (const k of ["totalMonitors", "matched", "returned", "hasMore", "statusCounts", "note"]) {
      assert.ok(keys.indexOf(k) < keys.indexOf("monitors"), `${k} must precede monitors`);
    }
    assert.match(res.result.note, /not a live diagnostic/);
  });
});

describe("pagination", () => {
  it("size/page slice the filtered list with an accurate hasMore", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const p1 = await checkMonitors(undefined, { size: 2, page: 1 });
    assert.equal(p1.result.totalMonitors, 6);
    assert.equal(p1.result.matched, 6);
    assert.equal(p1.result.returned, 2);
    assert.equal(p1.result.hasMore, true);
    const p3 = await checkMonitors(undefined, { size: 2, page: 3 });
    assert.equal(p3.result.returned, 2);
    assert.equal(p3.result.hasMore, false);
    const p4 = await checkMonitors(undefined, { size: 2, page: 4 });
    assert.equal(p4.result.returned, 0);
    assert.equal(p4.result.hasMore, false);
  });

  it("statusCounts stay tenant-wide on filtered, paginated calls", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const res = await checkMonitors("failing", { size: 1, page: 2 });
    assert.equal(res.result.matched, 2);
    assert.equal(res.result.returned, 1);
    assert.deepEqual(res.result.statusCounts, {
      passing: 3,
      failing: 2,
      error: 1,
      testing: 1,
      disabled: 1,
    });
  });
});

describe("tool schema", () => {
  it("advertises testing filter, fields, size, and page", async () => {
    const { default: tool } = await import("../dist/tools/check/check-monitors.tool.js");
    const zodModule = await import("zod");
    const z = zodModule.z ?? zodModule.default;
    const wrapped = z.object(tool().schema);
    assert.equal(
      wrapped.safeParse({ filter: "testing", fields: ["id"], size: 10, page: 2 }).success,
      true,
    );
    assert.equal(wrapped.safeParse({ filter: "bogus" }).success, false);
  });
});
