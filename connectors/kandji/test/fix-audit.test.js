/**
 * Regression tests for response shapes and write-argument handling.
 *
 * Same pattern as e2e.test.js: a local mock of the Kandji API, singleton
 * client pointed at it via env vars, handlers driven from dist/. Fully
 * offline — never touches a live tenant.
 *
 * Run: node --test test/fix-audit.test.js   (requires `npm run build` first)
 *
 * Read paths: Prism and audit-log truncation signals, list truncation
 * markers, device activity and app caps, empty-result existence warnings,
 * blueprint template counts, the OTA profile's base64 round-trip, mixed
 * device-status vocabulary, custom-profile XML omission, and tool
 * descriptions.
 *
 * Write paths: update_device clear semantics, strict tool schemas,
 * create_custom_profile device families, the create_blueprint clone guard,
 * prism_request_export parameter precedence, and nullable clears on the
 * other update tools. Upstream contract for clears (verified against the
 * live API): PATCH /devices/{id} clears user and asset_tag with an explicit
 * JSON null and clears tags with []; omitted keys are unchanged. These tests
 * pin the connector to that contract.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// ── Fixtures ────────────────────────────────────────────────────

const DEVICES = [
  { device_id: "dev-1", device_name: "Mac One", platform: "Mac", last_check_in: "2026-07-30T10:00:00Z" },
  { device_id: "dev-2", device_name: "Mac Two", platform: "Mac", last_check_in: "2026-07-30T11:00:00Z" },
  { device_id: "dev-3", device_name: "Win One", platform: "Windows", last_check_in: "2026-07-30T12:00:00Z" },
];

const USERS = [
  { id: "u1", email: "a@example.com", name: "A", active: true, archived: false, device_count: 1 },
  { id: "u2", email: "b@example.com", name: "B", active: true, archived: false, device_count: 1 },
  { id: "u3", email: "c@example.com", name: "C", active: false, archived: true, device_count: 0 },
  { id: "u4", email: "d@example.com", name: "D", active: true, archived: false, device_count: 2 },
];

// 60 prism apps rows across 2 devices — enough to exercise the 20-row
// fan-out default cap and the cap+1 truncation probe.
function prismRows() {
  const rows = [];
  for (const dev of ["dev-1", "dev-2"]) {
    for (let i = 0; i < 30; i++) {
      rows.push({
        device_id: dev,
        device_name: dev === "dev-1" ? "Mac One" : "Mac Two",
        serial_number: dev === "dev-1" ? "AAA" : "BBB",
        bundle_name: `app-${i}`,
        bundle_id: `com.example.${i}`,
        version: `1.${i}`,
      });
    }
  }
  return rows;
}

const FULL_APPS = Array.from({ length: 8 }, (_, i) => ({
  app_id: `${i}`,
  app_name: `App ${i}`,
  bundle_id: `com.example.app${i}`,
  bundle_size: "104857600",
  app_store_vendable: "no",
  device_based_vpp: "no",
  source: "Kandji Agent",
  process: `app${i}`,
  signature: `Signed by Example Corp (ABCDEF${i}), Developer ID Certification Authority, Apple Root CA`,
  creation_date: "2026-07-01T00:00:00Z",
  modification_date: "2026-07-02T00:00:00Z",
  path: `/Applications/App ${i}.app`,
  version: `2.${i}`,
}));

const AUDIT_EVENTS = Array.from({ length: 120 }, (_, i) => ({
  id: `ev-${i}`,
  action: "update",
  occurred_at: `2026-07-30T00:${String(i % 60).padStart(2, "0")}:00Z`,
  actor_id: "admin",
  event_type: "library.updated",
}));

const ACTIVITY = Array.from({ length: 10 }, (_, i) => ({
  id: `act-${i}`,
  action: "checkin",
  occurred: `2026-07-30T0${i % 10}:00:00Z`,
}));

// Binary CMS-like blob: DER SEQUENCE header + bytes that are NOT valid
// UTF-8, so a text decode would corrupt it (the failure base64 prevents).
const OTA_BINARY = Buffer.from([
  0x30, 0x82, 0x16, 0xfb, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d,
  0xff, 0xfe, 0x00, 0x80, 0x81, 0x82, 0x83, 0xc0, 0xc1,
]);

const CUSTOM_PROFILES = [
  {
    id: "cp-1",
    name: "WiFi",
    active: true,
    mdm_identifier: "com.kandji.profile.custom.cp-1",
    runs_on_mac: true,
    profile: `<?xml version="1.0"?><plist>${"x".repeat(3000)}</plist>`,
  },
  {
    id: "cp-2",
    name: "FileVault",
    active: true,
    mdm_identifier: "com.kandji.profile.custom.cp-2",
    runs_on_mac: true,
    profile: `<?xml version="1.0"?><plist>${"y".repeat(3000)}</plist>`,
  },
];

const TEMPLATE_GROUPS = [
  {
    id: 2,
    name: "CIS",
    weight: 20,
    templates: [
      { id: 16, name: "CIS Level 1", description: "d", params: { big: "z".repeat(1800) } },
      { id: 17, name: "CIS Level 2", description: "d", params: { big: "z".repeat(1800) } },
    ],
  },
  {
    id: 5,
    name: "Compliance",
    weight: 30,
    templates: [
      { id: 42, name: "SOC 2", description: "d", params: { big: "z".repeat(1800) } },
    ],
  },
];

const ZERO = "00000000-0000-0000-0000-000000000000";

// ── Mock server ─────────────────────────────────────────────────

let server;
let handlers;
let tools;

// Captured outgoing write bodies. assert.deepEqual against these
// distinguishes an explicit null from an omitted key — the falsy-filter
// failure mode these tests guard against. Tests null the slot, act, then
// assert.
const state = {
  lastDeviceUpdate: null,   // { id, body }  ← PATCH /devices/{id}
  lastBlueprintUpdate: null, // { id, body } ← PATCH /blueprints/{id}
  lastBlueprintCreate: null, // raw form-urlencoded string ← POST /blueprints
  lastCustomAppUpdate: null, // { id, body } ← PATCH /library/custom-apps/{id}
  lastProfileCreate: null,   // raw multipart string ← POST /library/custom-profiles
  lastPrismExport: null,     // parsed JSON body ← POST /prism/export
};

before(async () => {
  // The request handler buffers the body first: write-route captures need it,
  // and JSON.parse of the raw bytes preserves explicit nulls verbatim.
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => route(req, res, body));
  });

  const route = (req, res, body) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    const limit = parseInt(q.limit ?? "300", 10);
    const offset = parseInt(q.offset ?? "0", 10);
    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(typeof payload === "string" || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
    };

    // ── Write routes: capture the outgoing body, reply 200 ──

    const devPatch = path.match(/^\/devices\/([^/]+)$/);
    if (devPatch && req.method === "PATCH") {
      state.lastDeviceUpdate = { id: devPatch[1], body: body ? JSON.parse(body) : {} };
      return send(200, { device_id: devPatch[1], ...state.lastDeviceUpdate.body });
    }

    const bpPatch = path.match(/^\/blueprints\/([^/]+)$/);
    if (bpPatch && req.method === "PATCH") {
      state.lastBlueprintUpdate = { id: bpPatch[1], body: body ? JSON.parse(body) : {} };
      return send(200, { id: bpPatch[1], ...state.lastBlueprintUpdate.body });
    }

    if (path === "/blueprints" && req.method === "POST") {
      state.lastBlueprintCreate = body; // form-urlencoded — parse in the test
      return send(201, { id: "bp-new", name: "created" });
    }

    const caPatch = path.match(/^\/library\/custom-apps\/([^/]+)$/);
    if (caPatch && req.method === "PATCH") {
      state.lastCustomAppUpdate = { id: caPatch[1], body: body ? JSON.parse(body) : {} };
      return send(200, { id: caPatch[1], ...state.lastCustomAppUpdate.body });
    }

    if (path === "/library/custom-profiles" && req.method === "POST") {
      state.lastProfileCreate = body; // raw multipart — regex-assert in the test
      return send(201, { id: "cp-new", name: "created" });
    }

    // Must precede the generic /prism/:category matcher — "export" would
    // otherwise be swallowed by the read route.
    if (path === "/prism/export" && req.method === "POST") {
      state.lastPrismExport = body ? JSON.parse(body) : {};
      return send(200, { id: "exp-1", status: "pending" });
    }

    // Prism: live envelope shape — total present but NULL (observed 2026-07-30).
    const prismMatch = path.match(/^\/prism\/([a-z_]+)$/);
    if (prismMatch) {
      const rows = prismMatch[1] === "filevault"
        ? [
            { device_id: "dev-1", device_name: "Mac One", filevault_enabled: true },
            { device_id: "dev-2", device_name: "Mac Two", filevault_enabled: true },
          ]
        : prismRows();
      return send(200, {
        offset,
        limit,
        total: null,
        data: rows.slice(offset, offset + limit),
        cursor: null,
      });
    }

    // Audit events: live envelope has next/previous but NO count.
    if (path === "/audit/events") {
      const slice = AUDIT_EVENTS.slice(offset, offset + limit);
      return send(200, {
        results: slice,
        previous: offset > 0 ? "prev" : null,
        next: offset + slice.length < AUDIT_EVENTS.length ? "next-url" : null,
      });
    }

    // Devices list: bare array, honors platform filter.
    if (path === "/devices") {
      let rows = DEVICES;
      if (q.platform) rows = rows.filter((d) => d.platform === q.platform);
      return send(200, rows.slice(offset, offset + limit));
    }

    // Device activity: 200-empties for unknown ids (live-confirmed quirk).
    const actMatch = path.match(/^\/devices\/([^/]+)\/activity$/);
    if (actMatch) {
      const rows = actMatch[1] === ZERO ? [] : ACTIVITY;
      const slice = rows.slice(offset, offset + limit);
      return send(200, {
        device_id: actMatch[1],
        activity: {
          count: rows.length,
          next: offset + slice.length < rows.length ? "next" : null,
          previous: null,
          results: slice,
        },
      });
    }

    // Device notes: bare array; 200-empty for unknown ids.
    const notesMatch = path.match(/^\/devices\/([^/]+)\/notes$/);
    if (notesMatch) {
      return send(
        200,
        notesMatch[1] === ZERO ? [] : [{ note_id: "n1", content: "ticket ref" }],
      );
    }

    // Device apps
    const appsMatch = path.match(/^\/devices\/([^/]+)\/apps$/);
    if (appsMatch) {
      return send(200, { apps: FULL_APPS });
    }

    // Device status: mixed vocabulary, as observed fleet-wide.
    const statusMatch = path.match(/^\/devices\/([^/]+)\/status$/);
    if (statusMatch) {
      return send(200, {
        device_id: statusMatch[1],
        library_items: [
          { name: "Profile A", status: "success" },
          { name: "Profile B", status: "PASS" },
          { name: "Profile C", status: "PENDING" },
        ],
        parameters: [],
      });
    }

    // Library-item drill-downs: 200-empty for unknown ids.
    const liMatch = path.match(/^\/library\/library-items\/([^/]+)\/(status|activity)$/);
    if (liMatch) {
      const rows =
        liMatch[1] === ZERO
          ? []
          : [{ device_id: "dev-1", status: "PASS", last_audit_run: "2026-07-30" }];
      return send(200, {
        count: rows.length,
        next: null,
        previous: null,
        results: rows.slice(offset, offset + limit),
      });
    }

    if (path === "/library/custom-profiles") {
      return send(200, {
        count: CUSTOM_PROFILES.length,
        next: null,
        previous: null,
        results: CUSTOM_PROFILES.slice(offset, offset + limit),
      });
    }

    if (path === "/blueprints/templates/") {
      return send(200, {
        count: TEMPLATE_GROUPS.length,
        next: null,
        previous: null,
        results: TEMPLATE_GROUPS.slice(offset, offset + limit),
      });
    }

    const otaMatch = path.match(/^\/blueprints\/([^/]+)\/ota-enrollment-profile$/);
    if (otaMatch) {
      res.writeHead(200, { "content-type": "application/x-apple-aspen-config" });
      res.end(OTA_BINARY);
      return;
    }

    if (path === "/users") {
      let rows = USERS;
      if (q.email) rows = rows.filter((u) => u.email === q.email);
      return send(200, {
        results: rows.slice(offset, offset + limit),
        next: null,
        previous: null,
      });
    }

    send(404, { detail: `unmocked: ${req.method} ${path}` });
  };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  process.env.KANDJI_API_TOKEN = "test-token";
  process.env.KANDJI_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.KANDJI_ALLOW_INSECURE = "1";

  handlers = {
    prism: await import("../dist/handlers/prism.handler.js"),
    audit: await import("../dist/handlers/get-audit-events.handler.js"),
    listDevices: await import("../dist/handlers/list-devices.handler.js"),
    listUsers: await import("../dist/handlers/list-users.handler.js"),
    deviceActivity: await import("../dist/handlers/get-device-activity.handler.js"),
    deviceNotes: await import("../dist/handlers/list-device-notes.handler.js"),
    deviceApps: await import("../dist/handlers/get-device-apps.handler.js"),
    deviceStatus: await import("../dist/handlers/get-device-status.handler.js"),
    library: await import("../dist/handlers/library.handler.js"),
    blueprints: await import("../dist/handlers/list-blueprints.handler.js"),
    getBlueprint: await import("../dist/handlers/get-blueprint.handler.js"),
  };
  tools = {
    listDevices: (await import("../dist/tools/devices/list-devices.tool.js")).default(),
    listUsers: (await import("../dist/tools/users/list-users.tool.js")).default(),
    getUser: (await import("../dist/tools/users/get-user.tool.js")).default(),
    getDeviceDetails: (await import("../dist/tools/devices/get-device-details.tool.js")).default(),
    auditEvents: (await import("../dist/tools/audit/get-audit-events.tool.js")).default(),
    prismApps: (await import("../dist/tools/prism/prism-apps.tool.js")).default(),
    updateDevice: (await import("../dist/tools/devices/update-device.tool.js")).default(),
    updateBlueprint: (await import("../dist/tools/blueprints/update-blueprint.tool.js")).default(),
    createBlueprint: (await import("../dist/tools/blueprints/create-blueprint.tool.js")).default(),
    updateCustomApp: (await import("../dist/tools/library/update-custom-app.tool.js")).default(),
    updateCustomScript: (await import("../dist/tools/library/update-custom-script.tool.js")).default(),
    updateInHouseApp: (await import("../dist/tools/library/update-in-house-app.tool.js")).default(),
    createCustomProfile: (await import("../dist/tools/library/create-custom-profile.tool.js")).default(),
    prismRequestExport: (await import("../dist/tools/prism/prism-request-export.tool.js")).default(),
  };
});

after(() => server?.close());

// ── Prism truncation signals ───────────────────────────────────

describe("prism truncation signals", () => {
  it("default fan-out call: truncation signals lead, `returned` is not presented as the universe", async () => {
    const res = await handlers.prism.getPrismData("apps");
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.returned, 20);
    assert.equal(res.result.count, undefined, "the ambiguous bare `count` key must be absent");
    assert.equal(res.result.truncated, true);
    assert.equal(res.result.total_available, null, "live Prism envelope total is null");
    assert.equal(res.result.default_cap_applied, 20);
    assert.match(res.result.note, /prism_count/);
    assert.equal(typeof res.result.devices_in_slice, "number");
    // Signals must serialize BEFORE the rows array.
    const text = JSON.stringify(res.result);
    assert.ok(text.indexOf('"truncated"') < text.indexOf('"rows"'));
    assert.ok(text.indexOf('"returned"') < text.indexOf('"devices"'));
  });

  it("summary mode carries the SAME truncation signals (not a silently capped count)", async () => {
    const res = await handlers.prism.getPrismData("apps", { summary: true });
    assert.equal(res.isError, false);
    assert.equal(res.result.returned, 20);
    assert.equal(res.result.truncated, true);
    assert.equal(res.result.default_cap_applied, 20);
    assert.match(res.result.note, /ONLY the 20 fetched rows/);
    assert.ok(res.result.by_device);
    assert.equal(res.result.sample.length, 3);
    const text = JSON.stringify(res.result);
    assert.ok(text.indexOf('"truncated"') < text.indexOf('"by_device"'));
  });

  it("un-truncated category reports truncated: false", async () => {
    const res = await handlers.prism.getPrismData("filevault");
    assert.equal(res.isError, false);
    assert.equal(res.result.returned, 2);
    assert.equal(res.result.truncated, false);
    assert.equal(res.result.note, undefined);
  });

  it("explicit max_results that truncates is still flagged (no default_cap_applied)", async () => {
    const res = await handlers.prism.getPrismData("apps", { maxResults: 5 });
    assert.equal(res.isError, false);
    assert.equal(res.result.returned, 5);
    assert.equal(res.result.truncated, true);
    assert.equal(res.result.default_cap_applied, undefined);
  });

  it("prism tool serializes compact and its shared note states the cap", async () => {
    assert.match(tools.prismApps.description, /CAPPED 20-ROW SLICE/);
    assert.match(tools.prismApps.description, /`returned` is the row count of THIS response only/);
    const out = await tools.prismApps.handler({}, {});
    assert.equal(out.content[0].type, "text");
    assert.ok(!out.content[0].text.includes("\n  "), "prism output should be compact JSON");
  });
});

// ── Audit events ───────────────────────────────────────────────

describe("audit events default cap + paging", () => {
  it("default args fetch ONE capped page (50), flagged truncated with a resume cursor", async () => {
    const res = await handlers.audit.getAuditEvents();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.returned, 50);
    assert.equal(res.result.truncated, true);
    assert.equal(res.result.default_cap_applied, 50);
    assert.equal(res.result.next_offset, 50);
    assert.match(res.result.note, /start_offset/);
    const text = JSON.stringify(res.result);
    assert.ok(text.indexOf('"truncated"') < text.indexOf('"events"'));
  });

  it("start_offset resumes the walk and the final page reports truncated: false", async () => {
    const p2 = await handlers.audit.getAuditEvents({}, 50, 50);
    assert.equal(p2.result.returned, 50);
    assert.equal(p2.result.truncated, true);
    assert.equal(p2.result.next_offset, 100);
    const p3 = await handlers.audit.getAuditEvents({}, 50, 100);
    assert.equal(p3.result.returned, 20);
    assert.equal(p3.result.truncated, false);
    assert.equal(p3.result.next_offset, undefined);
    // Pages don't overlap.
    const ids2 = p2.result.events.map((e) => e.id);
    const ids3 = p3.result.events.map((e) => e.id);
    assert.equal(new Set([...ids2, ...ids3]).size, 70);
  });

  it("full walk is opt-in via explicit max_results", async () => {
    const res = await handlers.audit.getAuditEvents({}, 500);
    assert.equal(res.result.returned, 120);
    assert.equal(res.result.truncated, false);
    assert.equal(res.result.default_cap_applied, undefined);
  });

  it("tool declares the one-page default and exposes start_offset", async () => {
    assert.match(tools.auditEvents.description, /DEFAULT IS ONE 50-EVENT PAGE/);
    assert.ok(tools.auditEvents.schema.start_offset);
    const out = await tools.auditEvents.handler({ max_results: 5 }, {});
    assert.ok(!out.content[0].text.includes("\n  "), "audit output should be compact JSON");
  });
});

// ── List truncation, platform filter, archived breakdown ───────

describe("list truncation markers", () => {
  it("list_devices capped below the fleet flags truncated (not byte-identical to a small fleet)", async () => {
    const res = await handlers.listDevices.listDevices({}, 2);
    assert.equal(res.isError, false);
    assert.equal(res.result.count, 2);
    assert.equal(res.result.truncated, true);
    assert.match(res.result.note, /NOT the fleet size/);
  });

  it("list_devices uncapped (or cap >= fleet) has no truncation flag", async () => {
    const res = await handlers.listDevices.listDevices();
    assert.equal(res.result.count, 3);
    assert.equal(res.result.truncated, undefined);
    const capped = await handlers.listDevices.listDevices({}, 10);
    assert.equal(capped.result.count, 3);
    assert.equal(capped.result.truncated, undefined);
  });

  it("platform enum accepts Windows (tenant fleets can contain Windows devices)", () => {
    assert.equal(tools.listDevices.schema.platform.safeParse("Windows").success, true);
    assert.equal(tools.listDevices.schema.platform.safeParse("Mac").success, true);
    assert.equal(tools.listDevices.schema.platform.safeParse("windows").success, false);
  });

  it("list_users leads with an active/archived breakdown", async () => {
    const res = await handlers.listUsers.listUsers();
    assert.equal(res.isError, false);
    assert.equal(res.result.count, 4);
    assert.equal(res.result.active_count, 3);
    assert.equal(res.result.archived_count, 1);
    assert.match(res.result.note, /archived/);
    const text = JSON.stringify(res.result);
    assert.ok(text.indexOf('"archived_count"') < text.indexOf('"users"'));
  });

  it("list_users capped flags truncated", async () => {
    const res = await handlers.listUsers.listUsers({}, 2);
    assert.equal(res.result.count, 2);
    assert.equal(res.result.truncated, true);
  });
});

// ── Device activity ────────────────────────────────────────────

describe("device activity", () => {
  it("default call caps at 50 and reports the true total from the envelope", async () => {
    const res = await handlers.deviceActivity.getDeviceActivity("dev-1");
    assert.equal(res.isError, false);
    assert.equal(res.result.returned, 10);
    assert.equal(res.result.total_available, 10);
    assert.equal(res.result.truncated, false);
    assert.equal(res.result.default_cap_applied, 50);
  });

  it("capped call flags truncated with the full universe count", async () => {
    const res = await handlers.deviceActivity.getDeviceActivity("dev-1", 4);
    assert.equal(res.result.returned, 4);
    assert.equal(res.result.total_available, 10);
    assert.equal(res.result.truncated, true);
    assert.match(res.result.note, /first 4 of 10/);
  });

  it("nonexistent device id: 200-empty carries the existence warning", async () => {
    const res = await handlers.deviceActivity.getDeviceActivity(ZERO);
    assert.equal(res.isError, false);
    assert.equal(res.result.returned, 0);
    assert.match(res.result.note, /does NOT confirm the device exists/);
    assert.match(res.result.note, /get_device/);
  });
});

// ── Silent-empty notes ─────────────────────────────────────────

describe("silent-empty notes", () => {
  it("list_device_notes on a bogus id warns instead of clean-empty", async () => {
    const res = await handlers.deviceNotes.listDeviceNotes(ZERO);
    assert.equal(res.isError, false);
    assert.equal(res.result.count, 0);
    assert.match(res.result.note, /does NOT confirm the device exists/);
  });

  it("list_device_notes on a real id has no warning", async () => {
    const res = await handlers.deviceNotes.listDeviceNotes("dev-1");
    assert.equal(res.result.count, 1);
    assert.equal(res.result.note, undefined);
  });

  it("get_library_item_status / activity on a bogus id warn instead of clean-empty", async () => {
    const s = await handlers.library.getLibraryItemStatus(ZERO);
    assert.equal(s.isError, false);
    assert.equal(s.result.count, 0);
    assert.match(s.result.note, /does NOT confirm the item exists/);
    const a = await handlers.library.getLibraryItemActivity(ZERO);
    assert.equal(a.result.count, 0);
    assert.match(a.result.note, /does NOT confirm the item exists/);
  });

  it("get_library_item_status on a real id has no warning", async () => {
    const res = await handlers.library.getLibraryItemStatus("li-1");
    assert.equal(res.result.count, 1);
    assert.equal(res.result.note, undefined);
  });
});

// ── Device apps ────────────────────────────────────────────────

describe("device apps compaction + cap", () => {
  it("default rows are trimmed to key fields; count is the device total", async () => {
    const res = await handlers.deviceApps.getDeviceApps("dev-1");
    assert.equal(res.isError, false);
    assert.equal(res.result.count, 8);
    assert.equal(res.result.returned, 8);
    assert.ok(Array.isArray(res.result.fields_returned));
    const app = res.result.apps[0];
    assert.equal(app.app_name, "App 0");
    assert.equal(app.version, "2.0");
    assert.equal(app.bundle_id, "com.example.app0");
    assert.equal(app.signature, undefined, "bulky fields must be dropped by default");
    assert.equal(app.bundle_size, undefined);
  });

  it("detail: true returns full records", async () => {
    const res = await handlers.deviceApps.getDeviceApps("dev-1", { detail: true });
    assert.equal(res.result.fields_returned, undefined);
    assert.ok(res.result.apps[0].signature.includes("Developer ID"));
  });

  it("max_results caps rows while count still reports the device total", async () => {
    const res = await handlers.deviceApps.getDeviceApps("dev-1", { maxResults: 3 });
    assert.equal(res.result.count, 8);
    assert.equal(res.result.returned, 3);
    assert.equal(res.result.truncated, true);
    assert.match(res.result.note, /first 3 of 8/);
  });
});

// ── Blueprint templates ────────────────────────────────────────

describe("blueprint template counts", () => {
  it("leads with both category_count and template_count (no bare count of groups)", async () => {
    const res = await handlers.blueprints.listBlueprintTemplates();
    assert.equal(res.isError, false);
    assert.equal(res.result.count, undefined, "ambiguous `count` must be absent");
    assert.equal(res.result.category_count, 2);
    assert.equal(res.result.template_count, 3);
    assert.match(res.result.note, /3 templates across 2 category groups/);
  });

  it("params blobs are omitted by default and restored with detail: true", async () => {
    const res = await handlers.blueprints.listBlueprintTemplates();
    for (const group of res.result.templates) {
      for (const leaf of group.templates) {
        assert.equal(leaf.params, undefined, `params leaked on ${leaf.name}`);
        assert.ok(leaf.id, "leaf id must survive for create_blueprint cloning");
      }
    }
    const detailed = await handlers.blueprints.listBlueprintTemplates(undefined, true);
    assert.ok(detailed.result.templates[0].templates[0].params);
  });
});

// ── OTA enrollment profile ─────────────────────────────────────

describe("OTA enrollment profile base64", () => {
  it("binary CMS blob round-trips losslessly through base64", async () => {
    const res = await handlers.getBlueprint.getBlueprintOtaEnrollmentProfile("bp-1");
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.encoding, "base64");
    assert.equal(res.result.mobileconfig, undefined, "raw text field must be absent");
    assert.match(res.result.note, /BINARY/);
    const decoded = Buffer.from(res.result.mobileconfig_base64, "base64");
    assert.ok(decoded.equals(OTA_BINARY), "decoded bytes must equal the upstream blob exactly");
  });
});

// ── Device status vocabulary ───────────────────────────────────

describe("device status mixed vocabulary", () => {
  it("response leads with the vocabulary warning and preserves the payload", async () => {
    const res = await handlers.deviceStatus.getDeviceStatus("dev-1");
    assert.equal(res.isError, false);
    assert.match(res.result.note, /'success' and uppercase 'PASS'/);
    assert.equal(res.result.library_items.length, 3);
    const text = JSON.stringify(res.result);
    assert.ok(text.indexOf('"note"') < text.indexOf('"library_items"'));
  });
});

// ── Custom profiles ────────────────────────────────────────────

describe("custom profiles XML behind detail flag", () => {
  it("profile XML is stripped by default with a leading flag", async () => {
    const res = await handlers.library.listCustomProfiles();
    assert.equal(res.isError, false);
    assert.equal(res.result.count, 2);
    assert.equal(res.result.profile_xml_omitted, true);
    assert.match(res.result.note, /detail: true/);
    for (const item of res.result.results) {
      assert.equal(item.profile, undefined);
      assert.ok(item.mdm_identifier, "metadata must survive");
    }
  });

  it("detail: true includes the XML and drops the omission flag", async () => {
    const res = await handlers.library.listCustomProfiles(undefined, true);
    assert.equal(res.result.profile_xml_omitted, undefined);
    assert.match(res.result.results[0].profile, /^<\?xml/);
  });
});

// ── Tool descriptions ──────────────────────────────────────────

describe("tool descriptions match the API", () => {
  it("get_user does not promise a device list", () => {
    assert.ok(!tools.getUser.description.includes("including their assigned devices"));
    assert.match(tools.getUser.description, /device_count/);
    assert.match(tools.getUser.description, /list_devices/);
  });

  it("list_users does not promise group memberships", () => {
    assert.ok(
      !tools.listUsers.description.includes("name, and group memberships"),
      "must not promise group memberships",
    );
    assert.match(tools.listUsers.description, /does NOT expose group memberships/);
  });

  it("the two check-in clocks are labeled distinctly", () => {
    assert.match(tools.listDevices.description, /AGENT/);
    assert.match(tools.listDevices.description, /mdm\.last_check_in/);
    assert.match(tools.getDeviceDetails.description, /TWO distinct check-in clocks/);
  });
});

// ── update_device clear semantics ──────────────────────────────

describe("update_device clear semantics", () => {
  // NOTE: the user/asset_tag null wire tests pin the HANDLER passthrough
  // only (direct handler invocation bypasses MCP validation). The validation
  // layer — a plain z.string() would reject null — is pinned by the
  // safeParse test below and the MCP-layer round-trips under "strict tool
  // schemas".
  it("user: null reaches the wire as an explicit JSON null", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler({ device_id: "dev-1", user: null }, {});
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { user: null });
  });

  it("clear_user: true sends {user: null}", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler({ device_id: "dev-1", clear_user: true }, {});
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { user: null });
  });

  it("asset_tag: null / clear_asset_tag both send {asset_tag: null}", async () => {
    state.lastDeviceUpdate = null;
    await tools.updateDevice.handler({ device_id: "dev-1", asset_tag: null }, {});
    assert.deepEqual(state.lastDeviceUpdate.body, { asset_tag: null });
    state.lastDeviceUpdate = null;
    await tools.updateDevice.handler({ device_id: "dev-1", clear_asset_tag: true }, {});
    assert.deepEqual(state.lastDeviceUpdate.body, { asset_tag: null });
  });

  it("tags: [] reaches the wire and clears; a list replaces wholesale", async () => {
    state.lastDeviceUpdate = null;
    await tools.updateDevice.handler({ device_id: "dev-1", tags: [] }, {});
    assert.deepEqual(state.lastDeviceUpdate.body, { tags: [] });
    state.lastDeviceUpdate = null;
    await tools.updateDevice.handler({ device_id: "dev-1", tags: ["eng", "laptop"] }, {});
    assert.deepEqual(state.lastDeviceUpdate.body, { tags: ["eng", "laptop"] });
    state.lastDeviceUpdate = null;
    await tools.updateDevice.handler({ device_id: "dev-1", clear_tags: true }, {});
    assert.deepEqual(state.lastDeviceUpdate.body, { tags: [] });
  });

  it("clears combine with normal sets in one PATCH", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler(
      { device_id: "dev-1", user: null, asset_tag: "A-100" },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { user: null, asset_tag: "A-100" });
  });

  it("schema round-trips null for user and asset_tag; tags accepts []", () => {
    assert.equal(tools.updateDevice.schema.user.safeParse(null).success, true);
    assert.equal(tools.updateDevice.schema.user.safeParse("00000000-0000-4000-8000-0000000000a1").success, true);
    assert.equal(tools.updateDevice.schema.asset_tag.safeParse(null).success, true);
    assert.equal(tools.updateDevice.schema.tags.safeParse([]).success, true);
    assert.equal(tools.updateDevice.schema.clear_user.safeParse(true).success, true);
  });

  it("sentinel strings for user are rejected loudly and NEVER sent", async () => {
    for (const sentinel of ["null", "NONE", "", "0", "nil", "undefined"]) {
      state.lastDeviceUpdate = null;
      const out = await tools.updateDevice.handler({ device_id: "dev-1", user: sentinel }, {});
      assert.equal(out.isError, true, `user=${JSON.stringify(sentinel)} must be rejected`);
      assert.match(out.content[0].text, /clear_user|user: null/i);
      assert.equal(state.lastDeviceUpdate, null, "sentinel must not reach the wire");
    }
  });

  it("non-ID user strings (emails, names) are rejected with guidance", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler(
      { device_id: "dev-1", user: "bot@example.com" },
      {},
    );
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /list_users/);
    assert.match(out.content[0].text, /UUID|integer/i);
    assert.equal(state.lastDeviceUpdate, null);
  });

  it("legacy integer user IDs still pass", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler({ device_id: "dev-1", user: "12345" }, {});
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { user: "12345" });
  });

  it("sentinel asset_tag strings are rejected loudly and NEVER sent", async () => {
    for (const sentinel of ["null", "NONE", "", "0", "nil", "undefined"]) {
      state.lastDeviceUpdate = null;
      const out = await tools.updateDevice.handler({ device_id: "dev-1", asset_tag: sentinel }, {});
      assert.equal(out.isError, true, `asset_tag=${JSON.stringify(sentinel)} must be rejected`);
      assert.match(out.content[0].text, /clear_asset_tag|asset_tag: null/i);
      assert.equal(state.lastDeviceUpdate, null, "sentinel must not reach the wire");
    }
  });

  it("the nil UUID is treated as a clear sentinel for user, not forwarded", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler(
      { device_id: "dev-1", user: "00000000-0000-0000-0000-000000000000" },
      {},
    );
    assert.equal(out.isError, true, "nil UUID must not be forwarded (API would 404 confusingly)");
    assert.match(out.content[0].text, /clear_user|user: null/i);
    assert.equal(state.lastDeviceUpdate, null);
  });

  it("blueprint_id sentinels are rejected — blueprints cannot be cleared", async () => {
    for (const sentinel of ["null", "NONE", "0"]) {
      state.lastDeviceUpdate = null;
      const out = await tools.updateDevice.handler(
        { device_id: "dev-1", blueprint_id: sentinel },
        {},
      );
      assert.equal(out.isError, true, `blueprint_id=${JSON.stringify(sentinel)} must be rejected`);
      assert.match(out.content[0].text, /cannot be cleared|always belong/i);
      assert.equal(state.lastDeviceUpdate, null);
    }
  });

  it("tags: [] + clear_tags: true is NOT a conflict (same intent)", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler(
      { device_id: "dev-1", tags: [], clear_tags: true },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { tags: [] });
  });

  it("conflicting value + clear_* flag is rejected, nothing sent", async () => {
    const conflicts = [
      { user: "12345", clear_user: true },
      { asset_tag: "A-1", clear_asset_tag: true },
      { tags: ["a"], clear_tags: true },
    ];
    for (const extra of conflicts) {
      state.lastDeviceUpdate = null;
      const out = await tools.updateDevice.handler({ device_id: "dev-1", ...extra }, {});
      assert.equal(out.isError, true, `${JSON.stringify(extra)} must conflict`);
      assert.match(out.content[0].text, /conflicting/i);
      assert.equal(state.lastDeviceUpdate, null);
    }
  });

  it("null value + matching clear_* flag is NOT a conflict (same intent)", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler(
      { device_id: "dev-1", user: null, clear_user: true },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { user: null });
  });

  it("empty update is rejected before any HTTP call", async () => {
    state.lastDeviceUpdate = null;
    const out = await tools.updateDevice.handler({ device_id: "dev-1" }, {});
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /nothing to update|at least one/i);
    assert.equal(state.lastDeviceUpdate, null);
  });
});

// ── Strict tool schemas via the real MCP layer ─────────────────

// Device and library-item IDs are validated as UUIDs at the MCP layer, so
// calls made through the real tool schemas need UUID-shaped IDs.
const MCP_DEVICE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const MCP_LIBRARY_ITEM_ID = "b5d21f9e-9999-4444-3333-c292b3c2ccad";

describe("strict tool schemas", () => {
  let client;
  let mcpServer;

  before(async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { ToolFactory } = await import("../dist/tools/tool-factory.js");
    mcpServer = new McpServer({ name: "strict-schema-test", version: "0.0.0" });
    ToolFactory(mcpServer);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "strict-schema-test-client", version: "0.0.0" });
    await Promise.all([client.connect(ct), mcpServer.connect(st)]);
  });

  after(async () => {
    await client?.close();
    await mcpServer?.close();
  });

  it("unknown argument keys are rejected loudly, not silently stripped", async () => {
    state.lastDeviceUpdate = null;
    const res = await client
      .callTool({
        name: "update_device",
        arguments: { device_id: MCP_DEVICE_ID, asset_tag: "A-1", tagz: ["typo"] },
      })
      .catch((err) => ({ isError: true, content: [{ type: "text", text: err.message }] }));
    assert.equal(res.isError, true, "typo'd key must not be silently dropped");
    assert.match(res.content[0].text, /unrecognized|invalid arguments/i);
    assert.equal(state.lastDeviceUpdate, null, "rejected call must not reach the wire");
  });

  it("explicit user: null survives the full MCP validation layer to the wire", async () => {
    state.lastDeviceUpdate = null;
    const res = await client.callTool({
      name: "update_device",
      arguments: { device_id: MCP_DEVICE_ID, user: null },
    });
    assert.notEqual(res.isError, true, res.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { user: null });
  });

  it("asset_tag: null and tags: [] also survive the MCP layer to the wire", async () => {
    state.lastDeviceUpdate = null;
    let res = await client.callTool({
      name: "update_device",
      arguments: { device_id: MCP_DEVICE_ID, asset_tag: null },
    });
    assert.notEqual(res.isError, true, res.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { asset_tag: null });

    state.lastDeviceUpdate = null;
    res = await client.callTool({
      name: "update_device",
      arguments: { device_id: MCP_DEVICE_ID, tags: [] },
    });
    assert.notEqual(res.isError, true, res.content?.[0]?.text);
    assert.deepEqual(state.lastDeviceUpdate.body, { tags: [] });
  });

  it("a nullable clear survives the MCP layer too (update_custom_app)", async () => {
    // Pins the VALIDATION layer for nullable clears — the wire tests under
    // "nullable clears" alone would not catch a schema regression (direct
    // handler calls forward null regardless of schema).
    state.lastCustomAppUpdate = null;
    const res = await client.callTool({
      name: "update_custom_app",
      arguments: { library_item_id: MCP_LIBRARY_ITEM_ID, audit_script: null },
    });
    assert.notEqual(res.isError, true, res.content?.[0]?.text);
    assert.deepEqual(state.lastCustomAppUpdate.body, { audit_script: null });
  });
});

// ── create_custom_profile device-family flags ──────────────────

describe("custom profile device families", () => {
  it("explicit runs_on_mac: false is NOT silently inverted to true", async () => {
    state.lastProfileCreate = null;
    const out = await tools.createCustomProfile.handler(
      { name: "P", mobileconfig: "<?xml?>", runs_on_mac: false },
      {},
    );
    assert.equal(out.isError, true, "all-false flags must be a loud error, not a mac profile");
    assert.match(out.content[0].text, /at least one runs_on_/);
    assert.equal(state.lastProfileCreate, null, "nothing may be created");
  });

  it("a non-mac family passes through without forcing runs_on_mac", async () => {
    state.lastProfileCreate = null;
    const out = await tools.createCustomProfile.handler(
      { name: "P", mobileconfig: "<?xml?>", runs_on_iphone: true },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.match(state.lastProfileCreate, /name="runs_on_iphone"[\r\n]+[\r\n]+true/);
    assert.ok(
      !/name="runs_on_mac"/.test(state.lastProfileCreate),
      "runs_on_mac must not be injected when another family was specified",
    );
  });

  it("no flags at all still defaults to runs_on_mac: true (UI parity)", async () => {
    state.lastProfileCreate = null;
    const out = await tools.createCustomProfile.handler(
      { name: "P", mobileconfig: "<?xml?>" },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.match(state.lastProfileCreate, /name="runs_on_mac"[\r\n]+[\r\n]+true/);
  });
});

// ── create_blueprint clone-source guard ────────────────────────

describe("blueprint clone guard", () => {
  it("source_type without source_id fails loudly instead of creating empty", async () => {
    state.lastBlueprintCreate = null;
    const out = await tools.createBlueprint.handler(
      { name: "BP", source_type: "template" },
      {},
    );
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /BOTH source_type and source_id/);
    assert.equal(state.lastBlueprintCreate, null, "no un-cloned blueprint may be created");
  });

  it("source_id without source_type fails loudly too", async () => {
    state.lastBlueprintCreate = null;
    const out = await tools.createBlueprint.handler({ name: "BP", source_id: 42 }, {});
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /BOTH source_type and source_id/);
    assert.equal(state.lastBlueprintCreate, null);
  });

  it("template_id shorthand still clones (source.type + source.id on the wire)", async () => {
    state.lastBlueprintCreate = null;
    const out = await tools.createBlueprint.handler({ name: "BP", template_id: 42 }, {});
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    const params = new URLSearchParams(state.lastBlueprintCreate);
    assert.equal(params.get("source.type"), "template");
    assert.equal(params.get("source.id"), "42");
  });

  it("template_id must NOT fill a half-specified source_* pair (wrong-source clone)", async () => {
    // source_type:'blueprint' + template_id would otherwise clone a
    // BLUEPRINT by the template's id — silent misdirection.
    for (const args of [
      { name: "BP", source_type: "blueprint", template_id: 42 },
      { name: "BP", source_id: 5, template_id: 42 },
    ]) {
      state.lastBlueprintCreate = null;
      const out = await tools.createBlueprint.handler(args, {});
      assert.equal(out.isError, true, `${JSON.stringify(args)} must be rejected`);
      assert.match(out.content[0].text, /BOTH source_type and source_id/);
      assert.equal(state.lastBlueprintCreate, null);
    }
  });

  it("a FULL source_* pair wins over template_id (documented precedence)", async () => {
    state.lastBlueprintCreate = null;
    const out = await tools.createBlueprint.handler(
      { name: "BP", source_type: "blueprint", source_id: 7, template_id: 42 },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    const params = new URLSearchParams(state.lastBlueprintCreate);
    assert.equal(params.get("source.type"), "blueprint");
    assert.equal(params.get("source.id"), "7");
  });
});

// ── prism_request_export parameter precedence ──────────────────

describe("prism export precedence", () => {
  it("reserved keys in filters are rejected loudly (no precedence guessing)", async () => {
    // Any silent precedence is wrong for someone: filters-wins bypasses
    // validation; params-win lets the blueprint_ids DEFAULT clobber an
    // explicit filters.blueprint_ids and widen a scoped export fleet-wide.
    for (const reserved of [
      { category: "filevault" },
      { device_families: ["iPhone"] },
      { blueprint_ids: ["bp-123"] },
    ]) {
      state.lastPrismExport = null;
      const out = await tools.prismRequestExport.handler(
        { category: "apps", device_families: ["Mac"], blueprint_ids: ["*"], filters: reserved },
        {},
      );
      assert.equal(out.isError, true, `${JSON.stringify(reserved)} must be rejected`);
      assert.match(out.content[0].text, /top-level parameter/);
      assert.equal(state.lastPrismExport, null, "collision must not reach the wire");
    }
  });

  it("benign filters still pass through alongside the validated params", async () => {
    state.lastPrismExport = null;
    const out = await tools.prismRequestExport.handler(
      {
        category: "apps",
        device_families: ["Mac"],
        blueprint_ids: ["*"],
        filters: { extra_filter: "kept" },
      },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.equal(state.lastPrismExport.category, "apps");
    assert.deepEqual(state.lastPrismExport.device_families, ["Mac"]);
    assert.deepEqual(state.lastPrismExport.blueprint_ids, ["*"]);
    assert.equal(state.lastPrismExport.extra_filter, "kept");
  });
});

// ── Nullable clears on the other update tools ──────────────────

describe("nullable clears", () => {
  it("update_blueprint description: null reaches the wire", async () => {
    state.lastBlueprintUpdate = null;
    const out = await tools.updateBlueprint.handler(
      { blueprint_id: "bp1", description: null },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.deepEqual(state.lastBlueprintUpdate.body, { description: null });
  });

  it("update_custom_app script/category nulls reach the wire", async () => {
    state.lastCustomAppUpdate = null;
    const out = await tools.updateCustomApp.handler(
      { library_item_id: "ca-1", audit_script: null, self_service_category_id: null },
      {},
    );
    assert.notEqual(out.isError, true, out.content?.[0]?.text);
    assert.deepEqual(state.lastCustomAppUpdate.body, {
      audit_script: null,
      self_service_category_id: null,
    });
  });

  it("the remaining nullable-on-the-API fields accept null at the schema layer", () => {
    assert.equal(tools.updateCustomApp.schema.audit_script.safeParse(null).success, true);
    assert.equal(tools.updateCustomApp.schema.preinstall_script.safeParse(null).success, true);
    assert.equal(tools.updateCustomApp.schema.postinstall_script.safeParse(null).success, true);
    assert.equal(tools.updateCustomApp.schema.self_service_category_id.safeParse(null).success, true);
    assert.equal(tools.updateCustomScript.schema.remediation_script.safeParse(null).success, true);
    assert.equal(tools.updateCustomScript.schema.self_service_category_id.safeParse(null).success, true);
    assert.equal(tools.updateInHouseApp.schema.self_service_category_id.safeParse(null).success, true);
    assert.equal(tools.updateBlueprint.schema.description.safeParse(null).success, true);
  });
});
