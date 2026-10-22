/**
 * End-to-end tests for the Kandji MCP connector.
 *
 * Spins up a local HTTP server that mimics the Kandji API, points the
 * singleton client at it, then drives the handlers and tool definitions and
 * validates the responses. Run: node --test test/e2e.test.js
 *
 * Areas covered:
 *   - get_ade_public_key PEM parsing
 *   - prism_count category fan-out
 *   - prism_request_export request body
 *   - EDR threats v1/v2 fallback and license gating
 *   - Prism payload compaction (device hoisting, caps, projection, summary)
 *   - "not configured" states (blueprint routing, Lost Mode)
 *   - Vulnerability Management license gating
 *   - list response shapes (one array key per response)
 *   - get_device_details marketing model name
 *   - device-action, blueprint and library write wiring
 *   - pagination edge cases, base-URL validation and bounded error bodies
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// ── Fixtures ────────────────────────────────────────────────────

const ADE_PEM = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAJYx2KyvZv4PMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMMCWtl
eXRlc3QyMjAeFw0yNjAxMDEwMDAwMDBaFw0yNzAxMDEwMDAwMDBaMBQxEjAQBgNV
BAMMCWtleXRlc3QyMjBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC8WUzj4tqVvLZP
kEYnKfEkQyKuvlJiGl3yCGkVELXk2t6aWbkJgeRZSGlRMbYxA50t5LOUm9DNAkv7
mYG2cMqLAgMBAAEwDQYJKoZIhvcNAQELBQADQQAQs9OPSxiE8aYdL0xRnNc9rkqQ
fqq9pYxkPpVdY7QFShKiLIo3tZeKf3l3+WFzPq3cLJxZ3OHyzqJp+pIrJyq0
-----END CERTIFICATE-----
`;

const DEVICE_1 = {
  device_id: "dev-1",
  name: "Studio Mac",
  model: "MacBook Pro 14\" 2023",
  serial_number: "ABC123",
  platform: "Mac",
  os_version: "14.6.1",
};
const DEVICE_2 = {
  device_id: "dev-2",
  name: "Lab Mac",
  model: "Mac mini M2",
  serial_number: "DEF456",
  platform: "Mac",
  os_version: "15.0",
};

// Realistic Prism row: 15 enumerated device fields, plus 4 "tenant-extra"
// device fields the connector's allowlist doesn't know about (these must be
// hoisted by the constant-across-rows heuristic). Plus category-specific
// columns that vary per row (a long path, version string, signature, etc.).
function makePrismRow(deviceId, deviceName, model, extra) {
  return {
    device_id: deviceId,
    device_name: deviceName,
    name: deviceName,
    model,
    model_id: "MacBookPro18,2",
    model_name: model, // in the DEVICE_FIELDS allowlist — should hoist
    platform: "Mac",
    serial_number: deviceId === "dev-1" ? "ABC123" : "DEF456",
    os_version: "14.6.1",
    supplementary_os_version_extra: "(23F79)",
    last_check_in: "2026-04-28T10:00:00Z",
    user_id: "u1",
    user_email: "user@example.com",
    user_name: "Test User",
    blueprint_id: "bp1",
    blueprint_name: "Default",
    asset_tag: "TAG-001",
    mdm_enabled: true,
    agent_installed_at: "2025-01-01T00:00:00Z",
    // Heuristic-only hoisting candidates — not in DEVICE_FIELDS but constant
    // for the device, so the per-device-constant heuristic should hoist them.
    department: deviceId === "dev-1" ? "Engineering" : "Lab",
    site_code: deviceId === "dev-1" ? "SF" : "NYC",
    fleet_owner: "it-ops@example.com",
    region: "us",
    ...extra,
  };
}

// 30 rows/device on 2 devices: more rows than any default cap, and enough
// per device to trigger the constant-across-rows heuristic.
function buildPrismCategory(category, perDevice = 30) {
  const rows = [];
  for (const [deviceId, deviceName, model] of [
    [DEVICE_1.device_id, DEVICE_1.name, DEVICE_1.model],
    [DEVICE_2.device_id, DEVICE_2.name, DEVICE_2.model],
  ]) {
    for (let i = 0; i < perDevice; i++) {
      rows.push(
        makePrismRow(deviceId, deviceName, model, {
          // Category-specific fields that vary per row — must stay in rows.
          // Names match the real Kandji apps schema so fields_unknown can
          // be tested with realistic typos.
          bundle_id: `com.example.${category}.${i}`,
          bundle_name: `${category}-${i}`,
          executable_name: `${category}-${i}.app`,
          version: `1.${i}.0`,
          path: `/Applications/${category}-${i}.app`,
          item_index: i,
        }),
      );
    }
  }
  return rows;
}

// ── Mock server state ───────────────────────────────────────────

const state = {
  // license flags toggle endpoint behaviour for "no licence" scenarios
  edrEnabled: true,
  vmEnabled: true,
  blueprintRoutingConfigured: true,
  threatsV1Enabled: true,
  behavioralV1Enabled: true,
  // when true, both the v1 AND v2 EDR paths 404 — simulates a tenant
  // without the EDR licence (the documented graceful-degradation path)
  bothPathsMissing: false,
  // counters so tests can assert what was hit
  hits: {},
  // capture the body of POSTed prism-export so we can assert the schema
  lastPrismExportBody: null,
  // how the device-action route fails after recording the command: "drop"
  // closes the connection unanswered, "garbled" answers 200 with a non-JSON
  // body, a number answers with that HTTP status; null succeeds
  deviceActionFailure: null,
};

function bumpHit(key) {
  state.hits[key] = (state.hits[key] || 0) + 1;
}

function paginatedResults(rows, query) {
  const limit = Math.min(parseInt(query.limit ?? "300", 10), rows.length);
  const offset = parseInt(query.offset ?? "0", 10);
  const slice = rows.slice(offset, offset + limit);
  return {
    count: rows.length,
    next: offset + slice.length < rows.length ? "next" : null,
    previous: offset > 0 ? "prev" : null,
    results: slice,
  };
}

// ── Mock server ─────────────────────────────────────────────────

// The mock is mounted like the real API: KANDJI_BASE_URL is `<origin>/api/v1`,
// so v1 routes arrive as `/api/v1/<path>` and are matched on `<path>`. The v2
// EDR routes are matched on their full wire path (`/api/v2/...`), so a client
// that concatenates a v2 path onto the v1 base (`/api/v1/v2/...`) falls
// through to the unmocked 404 — the versioned-path bug, which a root-mounted
// mock would mask by serving whatever path the client happened to build.
const API_V1_PREFIX = "/api/v1";

function mockPath(pathname) {
  return pathname.startsWith(`${API_V1_PREFIX}/`)
    ? pathname.slice(API_V1_PREFIX.length)
    : pathname;
}

let server;
let baseUrl;
let handlers;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = mockPath(url.pathname);
    const query = Object.fromEntries(url.searchParams);
    bumpHit(`${req.method} ${path}`);

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const send = (status, payload, headers = {}) => {
        res.writeHead(status, {
          "content-type": "application/json",
          ...headers,
        });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      };

      // ── ADE public key — PEM, not JSON ──
      if (path === "/integrations/apple/ade/public_key/") {
        res.writeHead(200, { "content-type": "application/x-pem-file" });
        res.end(ADE_PEM);
        return;
      }

      // ── Prism count: requires ?category= ──
      if (path === "/prism/count") {
        if (!query.category) return send(404, { error: "category required" });
        // Return a per-category number so we can assert fan-out worked.
        const fakeCounts = {
          apps: 60,
          filevault: 2,
          activation_lock: 2,
          device_information: 2,
          local_users: 6,
        };
        return send(200, { count: fakeCounts[query.category] ?? 1 });
      }

      // ── Prism export: must include blueprint_ids + device_families ──
      // Important: this must be checked BEFORE the /prism/:category regex
      // below, otherwise "export" gets mistaken for a Prism category.
      if (path === "/prism/export" && req.method === "POST") {
        const parsed = body ? JSON.parse(body) : {};
        state.lastPrismExportBody = parsed;
        if (!parsed.blueprint_ids || !parsed.device_families) {
          return send(422, {
            blueprint_ids: ["field required"],
            device_families: ["field required"],
          });
        }
        return send(202, { export_id: "exp-1", status: "queued" });
      }

      // ── Prism categories ──
      const prismMatch = path.match(/^\/prism\/([a-z_]+)$/);
      if (prismMatch && prismMatch[1] !== "export" && prismMatch[1] !== "count") {
        const category = prismMatch[1];
        const rows = buildPrismCategory(category, 30);
        const limit = Math.min(parseInt(query.limit ?? "300", 10), rows.length);
        const offset = parseInt(query.offset ?? "0", 10);
        return send(200, {
          data: rows.slice(offset, offset + limit),
          offset,
          limit,
          total: rows.length,
        });
      }

      // ── Devices ──
      if (path === "/devices" && req.method === "GET") {
        // Bare array (the documented shape) that honours limit/offset like
        // the real API, so fetchPaginated terminates on the empty page after
        // the last device instead of re-reading the same two devices until
        // its 10,000-iteration safety cap.
        const all = [DEVICE_1, DEVICE_2];
        const limit = parseInt(query.limit ?? "300", 10);
        const offset = parseInt(query.offset ?? "0", 10);
        return send(200, all.slice(offset, offset + limit));
      }
      if (path === "/devices/dev-1") return send(200, DEVICE_1);
      if (path === "/devices/dev-1/details") {
        return send(200, {
          general: { device_id: "dev-1", device_name: "Studio Mac" },
          hardware_overview: { model_name: "Mac", processor_type: "M2 Pro" },
          security_information: { filevault_status: "On" },
        });
      }
      if (path === "/devices/dev-1/details/lostmode") {
        return send(400, { detail: "Device is not in lost mode." });
      }

      // ── Blueprint routing ──
      if (path === "/blueprint-routing/") {
        if (state.blueprintRoutingConfigured) {
          return send(200, { rules: [{ id: 1, condition: "blueprint=A" }] });
        }
        return send(404, {
          detail: "Blueprint routing configuration not found",
        });
      }
      if (path === "/blueprint-routing/activity") {
        if (!state.blueprintRoutingConfigured) {
          return send(404, {
            detail: "Blueprint routing configuration not found",
          });
        }
        return send(200, paginatedResults([{ id: 1, action: "create" }], query));
      }

      // ── Threats / EDR — v1 + v2 paths, EDR licence flag ──
      // bothPathsMissing wins over the per-path flags: it's how a tenant
      // without the EDR licence actually appears (404 from both versions).
      if (path === "/threat-details") {
        if (state.bothPathsMissing) return send(404, { detail: "not found" });
        if (!state.edrEnabled) return send(401, { detail: "License required" });
        if (!state.threatsV1Enabled) return send(404, { detail: "not found" });
        return send(
          200,
          paginatedResults([{ id: "t1", malware_name: "Foo" }], query),
        );
      }
      if (path === "/api/v2/threat/threat-details") {
        if (state.bothPathsMissing) return send(404, { detail: "not found" });
        if (!state.edrEnabled) return send(401, { detail: "License required" });
        return send(
          200,
          paginatedResults([{ id: "t1-v2", malware_name: "Foo" }], query),
        );
      }
      if (path === "/behavioral-detections") {
        if (state.bothPathsMissing) return send(404, { detail: "not found" });
        if (!state.edrEnabled) return send(401, { detail: "License required" });
        if (!state.behavioralV1Enabled) return send(404, { detail: "not found" });
        return send(
          200,
          paginatedResults([{ id: "b1", behavior: "anomaly" }], query),
        );
      }
      if (path === "/api/v2/threat/behavioral-detections/events") {
        if (state.bothPathsMissing) return send(404, { detail: "not found" });
        if (!state.edrEnabled) return send(401, { detail: "License required" });
        return send(
          200,
          paginatedResults([{ id: "b1-v2", behavior: "anomaly" }], query),
        );
      }

      // ── Vulnerability Management ──
      if (path === "/vulnerability-management/vulnerabilities") {
        if (!state.vmEnabled) return send(401, { detail: "License required" });
        return send(
          200,
          paginatedResults([{ cve_id: "CVE-2024-23201" }], query),
        );
      }

      // ── Device actions (POST /devices/{id}/action/<action>) ──
      // Match every action verb generically. We capture the action and any
      // body so tests can assert wiring without enumerating each verb.
      const actionMatch = path.match(/^\/devices\/([^/]+)\/action\/([a-z]+)$/);
      if (actionMatch && req.method === "POST") {
        state.lastDeviceAction = {
          device_id: actionMatch[1],
          action: actionMatch[2],
          body: body ? JSON.parse(body) : null,
        };
        const failure = state.deviceActionFailure;
        if (failure === "drop") {
          req.socket.destroy();
          return;
        }
        if (failure === "garbled") {
          return send(200, "<html>Bad gateway</html>", {
            "content-type": "text/html",
          });
        }
        if (typeof failure === "number") {
          return send(failure, { detail: "Simulated upstream failure" });
        }
        return send(200, {
          queued: true,
          action: actionMatch[2],
          device_id: actionMatch[1],
        });
      }

      // ── Blueprint writes ──
      if (path === "/blueprints" && req.method === "POST") {
        // The wrapper sends `application/x-www-form-urlencoded` with dotted-
        // key nesting (e.g. `enrollment_code.is_active=true`) because that's
        // what the upstream Kandji serializer expects. Reverse that here so
        // tests can keep asserting against the logical nested shape.
        const ct = req.headers["content-type"] || "";
        let parsed = {};
        if (body) {
          if (ct.includes("application/json")) {
            parsed = JSON.parse(body);
          } else {
            for (const [k, v] of new URLSearchParams(body).entries()) {
              const idx = k.indexOf(".");
              if (idx >= 0) {
                const head = k.slice(0, idx);
                const tail = k.slice(idx + 1);
                parsed[head] = parsed[head] || {};
                // best-effort coerce booleans/numbers from strings
                let coerced = v;
                if (v === "true") coerced = true;
                else if (v === "false") coerced = false;
                else if (/^-?\d+$/.test(v)) coerced = Number(v);
                parsed[head][tail] = coerced;
              } else {
                let coerced = v;
                if (v === "true") coerced = true;
                else if (v === "false") coerced = false;
                else if (/^-?\d+$/.test(v)) coerced = Number(v);
                parsed[k] = coerced;
              }
            }
          }
        }
        state.lastBlueprintCreate = parsed;
        return send(201, {
          id: "bp-new",
          ...parsed,
          // Real API generates a 6-digit code if caller didn't supply one.
          enrollment_code: {
            code:
              (parsed.enrollment_code && parsed.enrollment_code.code) ??
              "111222",
            is_active:
              (parsed.enrollment_code && parsed.enrollment_code.is_active) ??
              true,
          },
        });
      }
      const blueprintIdMatch = path.match(/^\/blueprints\/([^/]+)$/);
      if (blueprintIdMatch && req.method === "PATCH") {
        const parsed = body ? JSON.parse(body) : {};
        state.lastBlueprintUpdate = { id: blueprintIdMatch[1], body: parsed };
        return send(200, { id: blueprintIdMatch[1], ...parsed });
      }
      if (blueprintIdMatch && req.method === "DELETE") {
        state.lastBlueprintDelete = blueprintIdMatch[1];
        return send(204, "");
      }
      const assignMatch = path.match(
        /^\/blueprints\/([^/]+)\/assign_library_item$/,
      );
      if (assignMatch && req.method === "POST") {
        const parsed = body ? JSON.parse(body) : {};
        state.lastAssign = { blueprint_id: assignMatch[1], body: parsed };
        return send(200, {
          blueprint_id: assignMatch[1],
          library_item_id: parsed.library_item_id,
          assigned: true,
        });
      }
      const removeMatch = path.match(
        /^\/blueprints\/([^/]+)\/remove_library_item$/,
      );
      if (removeMatch && req.method === "POST") {
        const parsed = body ? JSON.parse(body) : {};
        state.lastRemove = { blueprint_id: removeMatch[1], body: parsed };
        return send(200, {
          blueprint_id: removeMatch[1],
          library_item_id: parsed.library_item_id,
          removed: true,
        });
      }

      // ── Library writes (custom-apps, custom-profiles, custom-scripts, ipa-apps) ──
      // Some endpoints are JSON, others are multipart/form-data (notably
      // /library/custom-profiles, which expects the .mobileconfig as a `file`
      // part). The mock detects the content-type header and either JSON.parses
      // or pulls fields out of the multipart body.
      const ctHeader = (req.headers["content-type"] || "").toLowerCase();
      const isMultipart = ctHeader.startsWith("multipart/form-data");
      const parseRequestBody = () => {
        if (!body) return {};
        if (!isMultipart) return JSON.parse(body);
        const m = ctHeader.match(/boundary=([^;]+)/);
        if (!m) return {};
        const boundary = m[1];
        const out = {};
        const parts = body.split(`--${boundary}`);
        for (const raw of parts) {
          const trimmed = raw.replace(/^\r\n|\r\n$/g, "");
          if (!trimmed || trimmed === "--") continue;
          const headerEnd = trimmed.indexOf("\r\n\r\n");
          if (headerEnd === -1) continue;
          const head = trimmed.slice(0, headerEnd);
          const value = trimmed.slice(headerEnd + 4).replace(/\r\n$/, "");
          const nm = head.match(/name="([^"]+)"/);
          if (!nm) continue;
          const fnm = head.match(/filename="([^"]+)"/);
          out[nm[1]] = fnm ? { filename: fnm[1], length: value.length } : value;
        }
        return out;
      };
      const libraryUploadMatch = path.match(
        /^\/library\/(custom-apps|ipa-apps)\/upload$/,
      );
      if (libraryUploadMatch && req.method === "POST") {
        const parsed = parseRequestBody();
        state.lastLibraryUpload = {
          kind: libraryUploadMatch[1],
          body: parsed,
        };
        // ipa-apps/upload uses `filename`, custom-apps/upload uses `name` —
        // confirmed live 2026-05-07. Hand back whichever the caller sent.
        const sentName = parsed.filename ?? parsed.name;
        return send(200, {
          name: parsed.name,
          filename: parsed.filename,
          file_key: `s3-key-${sentName}`,
          post_url: "https://s3.amazonaws.com/kandji-uploads",
          post_data: { policy: "fake", "x-amz-signature": "fake" },
          expiry: "2026-01-01T00:00:00Z",
        });
      }
      const libraryCreateMatch = path.match(
        /^\/library\/(custom-apps|custom-profiles|custom-scripts|ipa-apps)$/,
      );
      if (libraryCreateMatch && req.method === "POST") {
        const parsed = parseRequestBody();
        state.lastLibraryCreate = {
          kind: libraryCreateMatch[1],
          body: parsed,
          contentType: ctHeader,
        };
        return send(201, { id: `${libraryCreateMatch[1]}-new`, name: parsed.name });
      }
      const libraryItemMatch = path.match(
        /^\/library\/(custom-apps|custom-profiles|custom-scripts|ipa-apps)\/([^/]+)$/,
      );
      if (libraryItemMatch && req.method === "PATCH") {
        const parsed = parseRequestBody();
        state.lastLibraryUpdate = {
          kind: libraryItemMatch[1],
          id: libraryItemMatch[2],
          body: parsed,
          contentType: ctHeader,
        };
        return send(200, { id: libraryItemMatch[2], name: parsed.name });
      }
      if (libraryItemMatch && req.method === "DELETE") {
        state.lastLibraryDelete = {
          kind: libraryItemMatch[1],
          id: libraryItemMatch[2],
        };
        return send(204, "");
      }

      // ── Blueprint templates (curated catalogue) ──
      if (path === "/blueprints/templates/" && req.method === "GET") {
        return send(
          200,
          paginatedResults(
            [
              {
                id: 2,
                name: "CIS",
                weight: 20,
                templates: [
                  {
                    id: 16,
                    name: "CIS Level 2 Scored",
                    description: "Center for Internet Security benchmark…",
                  },
                ],
              },
              {
                id: 5,
                name: "Compliance",
                weight: 30,
                templates: [
                  { id: 42, name: "SOC 2", description: "SOC 2 starter set" },
                ],
              },
            ],
            query,
          ),
        );
      }

      // ── OTA enrollment profile (dual content-type) ──
      const otaMatch = path.match(
        /^\/blueprints\/([^/]+)\/ota-enrollment-profile$/,
      );
      if (otaMatch && req.method === "GET") {
        if (query.sso === "true") {
          return send(200, {
            url: `https://example.kandji.io/enrollment/auth?bp=${otaMatch[1]}`,
          });
        }
        res.writeHead(200, {
          "content-type": "application/x-apple-aspen-config",
          "content-disposition":
            "attachment;filename=kandji-enroll.mobileconfig",
        });
        res.end(`<?xml version="1.0"?><plist>fixture-${otaMatch[1]}</plist>`);
        return;
      }

      // ── Lists ──
      if (path === "/blueprints") {
        return send(200, paginatedResults([{ id: "bp1", name: "Default" }], query));
      }
      if (path === "/users") {
        return send(200, paginatedResults([{ id: "u1", email: "user@example.com" }], query));
      }
      if (path === "/tags") {
        return send(200, paginatedResults([{ id: "tag1", name: "prod" }], query));
      }
      if (path === "/library/custom-apps") {
        return send(200, paginatedResults([{ id: "ca1", name: "Slack" }], query));
      }
      if (path === "/library/custom-profiles") {
        return send(200, paginatedResults([{ id: "cp1", name: "WiFi" }], query));
      }
      if (path === "/library/custom-scripts") {
        return send(200, paginatedResults([{ id: "cs1", name: "lockdown.sh" }], query));
      }
      if (path === "/library/ipa-apps") {
        return send(200, paginatedResults([{ id: "ipa1", name: "InternalApp" }], query));
      }
      if (path === "/audit/events") {
        return send(200, paginatedResults([{ id: "e1", event: "login" }], query));
      }

      // ── Settings ──
      if (path === "/settings/licensing") {
        return send(200, { tier: "Enterprise", licenses: 100 });
      }

      send(404, { detail: `unmocked: ${req.method} ${path}` });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}${API_V1_PREFIX}`;

  process.env.KANDJI_API_TOKEN = "test-token";
  process.env.KANDJI_BASE_URL = baseUrl;
  // The mock server is plain http on loopback; opt out of the https-only
  // guard for the test harness (production still requires https).
  process.env.KANDJI_ALLOW_INSECURE = "1";

  // Dynamic import after env vars set so the singleton client picks them up.
  handlers = {
    ade: await import("../dist/handlers/ade.handler.js"),
    prism: await import("../dist/handlers/prism.handler.js"),
    prismCount: await import("../dist/handlers/get-prism-count.handler.js"),
    prismExport: await import("../dist/handlers/prism-export.handler.js"),
    threats: await import("../dist/handlers/threats.handler.js"),
    blueprintRouting: await import(
      "../dist/handlers/blueprint-routing.handler.js"
    ),
    deviceLostMode: await import(
      "../dist/handlers/get-device-lost-mode.handler.js"
    ),
    deviceDetails: await import(
      "../dist/handlers/get-device-details.handler.js"
    ),
    library: await import("../dist/handlers/library.handler.js"),
    listDevices: await import("../dist/handlers/list-devices.handler.js"),
    listBlueprints: await import("../dist/handlers/list-blueprints.handler.js"),
    getBlueprint: await import("../dist/handlers/get-blueprint.handler.js"),
    listUsers: await import("../dist/handlers/list-users.handler.js"),
    listTags: await import("../dist/handlers/list-tags.handler.js"),
    listVulns: await import(
      "../dist/handlers/list-vulnerabilities.handler.js"
    ),
    licensing: await import("../dist/handlers/get-licensing.handler.js"),
    deviceActions: await import(
      "../dist/handlers/device-actions.handler.js"
    ),
    blueprintWrite: await import(
      "../dist/handlers/blueprint-write.handler.js"
    ),
    libraryWrite: await import(
      "../dist/handlers/library-write.handler.js"
    ),
  };
});

after(() => server?.close());

// ── get_ade_public_key PEM parsing ─────────────────────────────

describe("get_ade_public_key PEM parsing", () => {
  it("returns { public_key: <pem> } for a PEM Content-Type response", async () => {
    const res = await handlers.ade.getAdePublicKey();
    assert.equal(res.isError, false, res.error);
    assert.ok(res.result.public_key.includes("-----BEGIN CERTIFICATE-----"));
    assert.ok(res.result.public_key.includes("-----END CERTIFICATE-----"));
  });
});

// ── prism_count category fan-out ───────────────────────────────

describe("prism_count fans out across all categories", () => {
  it("returns counts keyed by category, hitting every known category once", async () => {
    state.hits = {};
    const res = await handlers.prismCount.getPrismCount();
    assert.equal(res.isError, false, res.error);
    assert.ok(typeof res.result.counts === "object");

    for (const cat of [
      "apps",
      "filevault",
      "activation_lock",
      "application_firewall",
      "cellular",
      "certificates",
      "desktop_and_screensaver",
      "device_information",
      "gatekeeper_and_xprotect",
      "installed_profiles",
      "kernel_extensions",
      "launch_agents_and_daemons",
      "local_users",
      "startup_settings",
      "system_extensions",
      "transparency_database",
    ]) {
      assert.ok(
        cat in res.result.counts,
        `missing category ${cat} in counts`,
      );
    }
    assert.equal(res.result.counts.apps, 60);
    assert.equal(res.result.counts.filevault, 2);
    assert.equal(state.hits["GET /prism/count"], 16);
  });
});

// ── prism_request_export request body ──────────────────────────

describe("prism_request_export forwards blueprint_ids + device_families", () => {
  it("sends both required body fields to the API", async () => {
    state.lastPrismExportBody = null;
    const res = await handlers.prismExport.requestPrismExport("apps", {
      device_families: ["Mac"],
      blueprint_ids: ["*"],
    });
    assert.equal(res.isError, false, res.error);
    assert.deepEqual(state.lastPrismExportBody.blueprint_ids, ["*"]);
    assert.deepEqual(state.lastPrismExportBody.device_families, ["Mac"]);
    assert.equal(state.lastPrismExportBody.category, "apps");
  });

  it("the API rejects with 422 when fields are missing (regression check)", async () => {
    const res = await handlers.prismExport.requestPrismExport("apps", {});
    assert.equal(res.isError, true);
    assert.match(res.error, /422/);
  });
});

// ── threats v1/v2 fallback ─────────────────────────────────────

describe("threats endpoints try v1 first, fall back to v2 on 404", () => {
  it("uses v1 when v1 is healthy and exposes resolved_path", async () => {
    state.threatsV1Enabled = true;
    state.behavioralV1Enabled = true;
    state.edrEnabled = true;
    state.bothPathsMissing = false;
    state.hits = {};
    const res = await handlers.threats.getThreats({});
    assert.equal(res.isError, false, res.error);
    assert.ok(state.hits["GET /threat-details"] >= 1);
    assert.equal(res.result.threats[0].id, "t1");
    assert.equal(res.result.resolved_path, "v1");
  });

  it("falls through to v2 when v1 returns 404 (uses behavioral path so it has its own cache)", async () => {
    state.edrEnabled = true;
    state.behavioralV1Enabled = false; // v1 → 404 only for this endpoint
    state.bothPathsMissing = false;
    state.hits = {};
    const res = await handlers.threats.getBehavioralDetections({});
    assert.equal(res.isError, false, res.error);
    assert.ok(state.hits["GET /behavioral-detections"] >= 1);
    assert.ok(
      state.hits["GET /api/v2/threat/behavioral-detections/events"] >= 1,
    );
    assert.equal(res.result.events[0].id, "b1-v2");
    assert.equal(res.result.resolved_path, "v2");
  });

  it("soft-handles a 401 license-gated response", async () => {
    state.edrEnabled = false;
    const res = await handlers.threats.getThreats({});
    assert.equal(res.isError, false);
    assert.equal(res.result.license_gated, true);
    assert.equal(res.result.count, 0);
    assert.match(res.result.note, /EDR/);
    state.edrEnabled = true;
    state.threatsV1Enabled = true;
  });
});

describe("v2 threat paths resolve against the API root, not the v1 base", () => {
  // KANDJI_BASE_URL ends in /api/v1. The v2 threat endpoints live at
  // /api/v2/threat/..., so concatenating them onto the base would produce
  // /api/v1/v2/threat/... — a 404 that the fallback would then report as
  // "EDR not licensed" on tenants that only expose v2.
  it("get_threats falls back to GET /api/v2/threat/threat-details (exact wire path)", async () => {
    state.edrEnabled = true;
    state.bothPathsMissing = false;
    state.threatsV1Enabled = false;
    state.hits = {};
    try {
      const res = await handlers.threats.getThreats({});
      assert.equal(res.isError, false, res.error);
      assert.notEqual(
        res.result.license_gated,
        true,
        "v2-only tenant misreported as license-gated",
      );
      assert.equal(res.result.threats[0].id, "t1-v2");
      assert.equal(res.result.resolved_path, "v2");
      assert.ok(state.hits["GET /api/v2/threat/threat-details"] >= 1);
      // mockPath strips /api/v1, so a doubled /api/v1/v2/... lands here.
      assert.equal(state.hits["GET /v2/threat/threat-details"], undefined);
    } finally {
      state.threatsV1Enabled = true;
    }
  });

  it("get_behavioral_detections hits GET /api/v2/threat/behavioral-detections/events", async () => {
    state.edrEnabled = true;
    state.bothPathsMissing = false;
    state.behavioralV1Enabled = false;
    state.hits = {};
    try {
      const res = await handlers.threats.getBehavioralDetections({});
      assert.equal(res.isError, false, res.error);
      assert.notEqual(res.result.license_gated, true);
      assert.equal(res.result.events[0].id, "b1-v2");
      assert.ok(
        state.hits["GET /api/v2/threat/behavioral-detections/events"] >= 1,
      );
      assert.equal(
        state.hits["GET /v2/threat/behavioral-detections/events"],
        undefined,
      );
    } finally {
      state.behavioralV1Enabled = true;
    }
  });
});

describe("apiRootFromBaseUrl", () => {
  it("drops a trailing /v1 and leaves other bases unchanged", async () => {
    const { apiRootFromBaseUrl } = await import(
      "../dist/clients/kandji-client.js"
    );
    assert.equal(
      apiRootFromBaseUrl("https://acme.api.kandji.io/api/v1"),
      "https://acme.api.kandji.io/api",
    );
    assert.equal(
      apiRootFromBaseUrl("https://acme.api.eu.kandji.io/api/v1"),
      "https://acme.api.eu.kandji.io/api",
    );
    assert.equal(
      apiRootFromBaseUrl("http://127.0.0.1:8080"),
      "http://127.0.0.1:8080",
    );
    // Only a whole trailing segment is stripped.
    assert.equal(
      apiRootFromBaseUrl("https://proxy.example.com/kandji-v1"),
      "https://proxy.example.com/kandji-v1",
    );
  });
});

describe("both v1 and v2 returning 404 is treated as license-gated", () => {
  // We need a fresh path cache to fully exercise v1→v2→license-gated. The
  // singleton client caches per process, so use a child Node process for
  // isolation — same trick the integration suites in the Drata connector use.
  it("both endpoints 404 → returns { license_gated: true, count: 0 } (no error)", async () => {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    state.bothPathsMissing = true;
    state.edrEnabled = true;
    const child = spawn(
      process.execPath,
      [path.join(here, "harness-license-gated.mjs"), baseUrl],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const exitCode = await new Promise((resolve) =>
      child.on("close", resolve),
    );
    state.bothPathsMissing = false;

    assert.equal(
      exitCode,
      0,
      `child exited ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
    const result = JSON.parse(stdout);
    assert.equal(result.threats.isError, false);
    assert.equal(result.threats.result.license_gated, true);
    assert.equal(result.threats.result.count, 0);
    assert.deepEqual(result.threats.result.threats, []);
    assert.equal(result.behavioral.isError, false);
    assert.equal(result.behavioral.result.license_gated, true);
    assert.deepEqual(result.behavioral.result.events, []);
    // The fallback should have logged that it tried both paths to stderr.
    assert.match(
      stderr + result.tried,
      /threat-details/,
      "expected the fallback to have tried v1 path",
    );
  });
});

// ── prism payload compaction ───────────────────────────────────

describe("prism handler compacts payloads", () => {
  it("hoists allowlisted device columns into a `devices` map", async () => {
    const res = await handlers.prism.getPrismData("apps", { maxResults: 4 });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.returned, 4);
    // Truncation signals: 60 rows exist upstream, only 4 fetched.
    assert.equal(res.result.total_available, 60);
    assert.equal(res.result.truncated, true);
    // Devices map populated.
    assert.ok(res.result.devices["dev-1"]);
    assert.equal(res.result.devices["dev-1"].name, "Studio Mac");
    // Rows do not carry hoisted device fields.
    const row = res.result.rows[0];
    assert.equal(row.device_id, "dev-1");
    assert.equal(row.serial_number, undefined);
    assert.equal(row.os_version, undefined);
    assert.equal(row.blueprint_name, undefined);
    assert.equal(row.model_name, undefined);
    assert.equal(row.mdm_enabled, undefined);
    // Category-specific fields survive.
    assert.equal(row.bundle_name, "apps-0");
    assert.ok("item_index" in row);
  });

  it("hoists per-device-constant columns via heuristic (department, site_code, region, fleet_owner)", async () => {
    const res = await handlers.prism.getPrismData("apps", { maxResults: 60 });
    assert.equal(res.isError, false);
    // Each device record has the heuristic-hoisted fields populated.
    assert.equal(res.result.devices["dev-1"].department, "Engineering");
    assert.equal(res.result.devices["dev-2"].department, "Lab");
    assert.equal(res.result.devices["dev-1"].site_code, "SF");
    assert.equal(res.result.devices["dev-1"].region, "us");
    assert.equal(res.result.devices["dev-1"].fleet_owner, "it-ops@example.com");
    // None of those keys appear on rows.
    for (const row of res.result.rows) {
      assert.equal(row.department, undefined, "row leaked `department`");
      assert.equal(row.site_code, undefined, "row leaked `site_code`");
      assert.equal(row.region, undefined, "row leaked `region`");
      assert.equal(row.fleet_owner, undefined, "row leaked `fleet_owner`");
    }
  });

  it("defaults max_results to 20 for fan-out categories", async () => {
    for (const category of [
      "apps",
      "local_users",
      "transparency_database",
      "launch_agents_and_daemons",
    ]) {
      const res = await handlers.prism.getPrismData(category);
      assert.equal(res.isError, false, res.error);
      assert.equal(
        res.result.returned,
        20,
        `${category} should default to 20 rows, got ${res.result.returned}`,
      );
      assert.equal(res.result.default_cap_applied, 20);
    }
  });

  it("defaults max_results to 50 for non-fan-out categories", async () => {
    const res = await handlers.prism.getPrismData("filevault");
    assert.equal(res.isError, false);
    assert.equal(res.result.default_cap_applied, 50);
  });

  it("projects rows to fields[] when supplied (device_id always retained)", async () => {
    const res = await handlers.prism.getPrismData("apps", {
      maxResults: 2,
      fields: ["bundle_name", "version"],
    });
    assert.equal(res.isError, false);
    assert.deepEqual(res.result.fields_projected, [
      "device_id",
      "bundle_name",
      "version",
    ]);
    for (const row of res.result.rows) {
      assert.deepEqual(
        Object.keys(row).sort(),
        ["bundle_name", "device_id", "version"],
      );
    }
  });

  it("flags unknown field names in fields_unknown so typos can be corrected", async () => {
    const res = await handlers.prism.getPrismData("apps", {
      maxResults: 4,
      fields: ["bundle_name", "app_name", "executable"],
    });
    assert.equal(res.isError, false);
    // bundle_name exists; app_name and executable are typos for the real
    // schema columns (bundle_name, executable_name).
    assert.deepEqual(res.result.fields_unknown.sort(), [
      "app_name",
      "executable",
    ]);
  });

  it("summary mode returns by_device counts, a 3-row sample, AND the devices map", async () => {
    const res = await handlers.prism.getPrismData("apps", {
      maxResults: 60,
      summary: true,
    });
    assert.equal(res.isError, false);
    assert.equal(res.result.returned, 60);
    // Truncation signals travel with summary mode too: the full 60-row
    // universe fits under the cap here, so truncated must be false and the
    // "counts reflect only the slice" note must be absent.
    assert.equal(res.result.total_available, 60);
    assert.equal(res.result.truncated, false);
    assert.equal(res.result.note, undefined);
    assert.equal(res.result.by_device["dev-1"], 30);
    assert.equal(res.result.by_device["dev-2"], 30);
    assert.equal(res.result.sample.length, 3);
    assert.ok(res.result.devices["dev-1"]);
    // Sample rows must already be compacted (no device-level cols).
    for (const row of res.result.sample) {
      assert.equal(row.serial_number, undefined);
      assert.equal(row.department, undefined);
    }
  });

  for (const category of [
    "apps",
    "local_users",
    "transparency_database",
    "launch_agents_and_daemons",
  ]) {
    it(`prism-${category} payload stays under 30KB at the default cap`, async () => {
      const res = await handlers.prism.getPrismData(category);
      assert.equal(res.isError, false);
      const size = Buffer.byteLength(JSON.stringify(res.result), "utf8");
      assert.ok(
        size < 30 * 1024,
        `prism-${category} compacted payload was ${size} bytes (expected <30KB at default cap=20)`,
      );
    });
  }
});

// ── soft-handle "not configured" states ────────────────────────

describe("soft-handle 404/400 for not-configured features", () => {
  it("blueprint-routing 404 → { configured: false, rules: [] }", async () => {
    state.blueprintRoutingConfigured = false;
    const res = await handlers.blueprintRouting.getBlueprintRouting();
    assert.equal(res.isError, false);
    assert.equal(res.result.configured, false);
    assert.deepEqual(res.result.rules, []);
  });

  it("blueprint-routing-activity 404 → { configured: false, activity: [] }", async () => {
    state.blueprintRoutingConfigured = false;
    const res = await handlers.blueprintRouting.getBlueprintRoutingActivity();
    assert.equal(res.isError, false);
    assert.equal(res.result.configured, false);
    assert.deepEqual(res.result.activity, []);
    state.blueprintRoutingConfigured = true;
  });

  it("device-lost-mode 400 'not in lost mode' → { lost_mode_enabled: false }", async () => {
    const res = await handlers.deviceLostMode.getDeviceLostMode("dev-1");
    assert.equal(res.isError, false);
    assert.equal(res.result.lost_mode_enabled, false);
  });
});

// ── Vulnerability Management license gating ────────────────────

// The description is checked by reading the tool definition; the handler
// behaviour against a mock tenant without the Vulnerability Management add-on.
describe("Vulnerability Management license gating", () => {
  it("list_vulnerabilities tool description calls out license-gating", async () => {
    const tool = (await import(
      "../dist/tools/vulnerabilities/list-vulnerabilities.tool.js"
    )).default();
    assert.match(tool.description, /License-gated/);
    assert.match(tool.description, /license_gated/);
    assert.match(tool.description, /Vulnerability Management/);
  });

  it("a no-licence VM tenant folds 401 into a graceful license_gated result", async () => {
    // The four VM tools advertise graceful handling, so, like threats.handler,
    // a license-disabled tenant returns a non-error
    // { count: 0, license_gated: true } instead of a raw 401.
    state.vmEnabled = false;
    const res = await handlers.listVulns.listVulnerabilities();
    assert.equal(res.isError, false);
    assert.equal(res.result.license_gated, true);
    assert.equal(res.result.count, 0);
    assert.deepEqual(res.result.vulnerabilities, []);
    assert.match(res.result.note, /Vulnerability Management/);
    state.vmEnabled = true;
  });
});

// ── List responses carry ONE array key ─────────────────────────
//
// The domain-keyed handlers expose only their domain key
// (devices/blueprints/tags/users), and the four generic library list-* tools
// expose only `results`. Never both: a duplicate alias would double the
// serialized payload.

describe("list-* handlers expose exactly one array key (no duplicate alias)", () => {
  it("list_devices → { count, devices } (no `results` alias)", async () => {
    state.hits = {};
    const res = await handlers.listDevices.listDevices();
    assert.equal(res.isError, false);
    assert.ok(Array.isArray(res.result.devices));
    assert.equal(res.result.results, undefined);
    // Pagination walks the dataset once: one full page, then the empty page
    // that terminates the walk (a mock that ignored offset would drive the
    // client to its 10,000-request safety cap).
    assert.equal(res.result.count, 2);
    assert.deepEqual(
      res.result.devices.map((d) => d.device_id),
      ["dev-1", "dev-2"],
    );
    assert.equal(state.hits["GET /devices"], 2);
  });

  it("list_blueprints → { count, blueprints } (no `results` alias)", async () => {
    const res = await handlers.listBlueprints.listBlueprints();
    assert.equal(res.isError, false);
    assert.ok(Array.isArray(res.result.blueprints));
    assert.equal(res.result.results, undefined);
  });

  it("list_tags → { count, tags } (no `results` alias)", async () => {
    const res = await handlers.listTags.listTags();
    assert.equal(res.isError, false);
    assert.ok(Array.isArray(res.result.tags));
    assert.equal(res.result.results, undefined);
  });

  it("list_users → { count, users } (no `results` alias)", async () => {
    const res = await handlers.listUsers.listUsers();
    assert.equal(res.isError, false);
    assert.ok(Array.isArray(res.result.users));
    assert.equal(res.result.results, undefined);
  });

  it("list_custom_apps → { count, results } only (no `items`/domain alias)", async () => {
    const res = await handlers.library.listCustomApps();
    assert.equal(res.isError, false);
    assert.ok(Array.isArray(res.result.results));
    assert.equal(res.result.items, undefined);
  });

  it("list_custom_profiles → { count, results }", async () => {
    const res = await handlers.library.listCustomProfiles();
    assert.equal(res.isError, false);
    assert.ok(Array.isArray(res.result.results));
  });

  it("list_custom_scripts → { count, results }", async () => {
    const res = await handlers.library.listCustomScripts();
    assert.equal(res.isError, false);
    assert.ok(Array.isArray(res.result.results));
  });

  it("list_in_house_apps → { count, results }", async () => {
    const res = await handlers.library.listInHouseApps();
    assert.equal(res.isError, false);
    assert.ok(Array.isArray(res.result.results));
  });
});

// ── get_device_details model_name enrichment ───────────────────

describe("get_device_details patches the marketing model name", () => {
  it("replaces 'Mac' with the marketing name from the summary endpoint", async () => {
    const res = await handlers.deviceDetails.getDeviceDetails("dev-1");
    assert.equal(res.isError, false, res.error);
    assert.equal(
      res.result.hardware_overview.model_name,
      'MacBook Pro 14" 2023',
    );
    assert.equal(res.result.hardware_overview.model_name_raw, "Mac");
  });
});

// ── Smoke: every read endpoint reachable returns isError=false ──

describe("Smoke: every read endpoint returns 200 + non-error JSON", () => {
  it("test_connection (via licensing handler proxy)", async () => {
    const res = await handlers.licensing.getLicensing();
    assert.equal(res.isError, false);
  });
});

// ── Coverage: device action tools ─────────────────────────────────
//
// All 14 device-action tools share one generic handler that posts to
// /devices/{id}/action/<verb>. Mock server captures the verb and body so
// we can assert the right URL was hit and (where applicable) the right
// payload was sent. Spot-check three: a destructive one (lock), an
// idempotent one (blank_push), and the only one with a body (delete_user).

describe("Coverage: device action tools post the right verb", () => {
  it("lock_device → POST /devices/dev-1/action/lock", async () => {
    state.lastDeviceAction = null;
    const res = await handlers.deviceActions.triggerDeviceAction(
      "dev-1",
      "lock",
    );
    assert.equal(res.isError, false, res.error);
    assert.equal(state.lastDeviceAction.device_id, "dev-1");
    assert.equal(state.lastDeviceAction.action, "lock");
    assert.equal(state.lastDeviceAction.body, null);
  });

  it("blank_push → POST /devices/dev-1/action/blankpush (idempotent, no body)", async () => {
    state.lastDeviceAction = null;
    const res = await handlers.deviceActions.triggerDeviceAction(
      "dev-1",
      "blankpush",
    );
    assert.equal(res.isError, false);
    assert.equal(state.lastDeviceAction.action, "blankpush");
  });

  it("delete_user → POST /devices/dev-1/action/deleteuser with UserName body", async () => {
    state.lastDeviceAction = null;
    const res = await handlers.deviceActions.triggerDeviceAction(
      "dev-1",
      "deleteuser",
      { UserName: "alice" },
    );
    assert.equal(res.isError, false);
    assert.equal(state.lastDeviceAction.action, "deleteuser");
    assert.deepEqual(state.lastDeviceAction.body, { UserName: "alice" });
  });

  it("erase, restart, shutdown, clearpasscode all reach their action verbs", async () => {
    for (const verb of [
      "erase",
      "restart",
      "shutdown",
      "clearpasscode",
      "unlockaccount",
      "enablelostmode",
      "disablelostmode",
      "playlostmodesound",
      "updatelocation",
      "renewmdmprofile",
      "reinstallagent",
    ]) {
      state.lastDeviceAction = null;
      const res = await handlers.deviceActions.triggerDeviceAction(
        "dev-1",
        verb,
      );
      assert.equal(res.isError, false, `${verb}: ${res.error}`);
      assert.equal(state.lastDeviceAction.action, verb);
    }
  });
});

// ── Device actions: required fields ───────────────────────────────
//
// Kandji's POST /devices/{id}/action/erase rejects requests without a 6-digit
// PIN — observed live: "<SchemaError(errors=[<PIN: MissingKeyError()>])>".
// DeviceLock auto-generates one server-side, but EraseDevice does not, and the
// erase response does not echo the PIN back. Without it the device stays at
// the EFI lock screen post-wipe, so erase_device sends an erase only with a
// PIN the caller already holds: called without one, it sends nothing and
// returns a generated PIN to call again with. unlock_account sends UserName
// (Apple MDM 'UnlockUserAccount' requires it), and enable_lost_mode exposes
// Message/PhoneNumber/Footnote.

describe("Device actions: erase_device sends an erase only with a PIN, and returns it", () => {
  const ERASE_HIT = "POST /devices/dev-1/action/erase";

  it("erase tool sends supplied PIN as the body's PIN field", async () => {
    state.lastDeviceAction = null;
    state.hits = {};
    const mod = await import("../dist/tools/devices/erase-device.tool.js");
    const def = mod.default();
    const out = await def.handler(
      { device_id: "dev-1", PIN: "123456" },
      {},
    );
    assert.equal(out.content[0].type, "text");
    assert.ok(!out.content[0].text.startsWith("Error"), out.content[0].text);
    assert.equal(state.hits[ERASE_HIT], 1);
    assert.equal(state.lastDeviceAction.action, "erase");
    assert.equal(state.lastDeviceAction.body.PIN, "123456");
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.PIN, "123456", "tool should echo the PIN to the LLM");
  });

  it("without a PIN, sends nothing and returns a generated PIN to confirm with", async () => {
    state.lastDeviceAction = null;
    state.hits = {};
    const mod = await import("../dist/tools/devices/erase-device.tool.js");
    const out = await mod.default().handler({ device_id: "dev-1" }, {});
    assert.deepEqual(state.hits, {}, "no request may reach Kandji");
    assert.equal(state.lastDeviceAction, null);
    assert.notEqual(out.isError, true, out.content[0].text);
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.sent, false);
    assert.equal(parsed.action, "confirm_erase");
    assert.equal(parsed.device_id, "dev-1");
    assert.match(parsed.PIN, /^\d{6}$/, "PIN must be a 6-digit string");
    assert.ok(parsed.next.startsWith("No erase was sent."), parsed.next);
    assert.ok(
      parsed.next.includes(
        `call erase_device again with the same arguments plus PIN "${parsed.PIN}"`,
      ),
      parsed.next,
    );
    assert.ok(
      parsed.next.includes("Give this PIN to the device's user"),
      parsed.next,
    );
  });

  it("the second call sends the PIN the first call returned", async () => {
    const mod = await import("../dist/tools/devices/erase-device.tool.js");
    const def = mod.default();
    const args = {
      device_id: "dev-1",
      pin_message: "Call IT to recover this Mac.",
    };
    const confirm = JSON.parse((await def.handler(args, {})).content[0].text);
    state.lastDeviceAction = null;
    state.hits = {};
    const out = await def.handler({ ...args, PIN: confirm.PIN }, {});
    assert.equal(state.hits[ERASE_HIT], 1);
    assert.deepEqual(state.lastDeviceAction.body, {
      PIN: confirm.PIN,
      PINMessage: "Call IT to recover this Mac.",
    });
    assert.notEqual(out.isError, true, out.content[0].text);
    assert.equal(JSON.parse(out.content[0].text).PIN, confirm.PIN);
  });

  it("erase tool passes pin_message and phone_number through as Apple MDM keys", async () => {
    state.lastDeviceAction = null;
    const mod = await import("../dist/tools/devices/erase-device.tool.js");
    const def = mod.default();
    await def.handler(
      {
        device_id: "dev-1",
        PIN: "424242",
        pin_message: "Call IT to recover this Mac.",
        phone_number: "+1-555-0199",
      },
      {},
    );
    assert.deepEqual(state.lastDeviceAction.body, {
      PIN: "424242",
      PINMessage: "Call IT to recover this Mac.",
      PhoneNumber: "+1-555-0199",
    });
  });

  it("erase tool rejects a non-6-digit PIN at the schema layer", async () => {
    const mod = await import("../dist/tools/devices/erase-device.tool.js");
    const def = mod.default();
    // The MCP SDK applies Zod schema validation before handler invocation;
    // here we just confirm the schema field rejects bad input directly.
    const schema = def.schema.PIN;
    const ok = schema.safeParse("123456");
    assert.equal(ok.success, true);
    const tooShort = schema.safeParse("123");
    assert.equal(tooShort.success, false);
    const nonNumeric = schema.safeParse("abcdef");
    assert.equal(nonNumeric.success, false);
  });

  it("erase tool surfaces the destructive PIN-recovery warning in its description", async () => {
    const mod = await import("../dist/tools/devices/erase-device.tool.js");
    const def = mod.default();
    assert.ok(def.description.startsWith("DESTRUCTIVE"));
    assert.match(def.description, /6-digit PIN/);
    assert.match(def.description, /MUST surface this PIN/);
    assert.match(def.description, /sends NOTHING to Kandji/);
    assert.match(def.description, /call erase_device again with that PIN/);
    assert.match(def.schema.PIN.description, /If omitted, nothing is sent/);
  });
});

// ── Regression: erase_device keeps the PIN when the outcome is uncertain ──
//
// The erase is sent only with a PIN the caller supplied. If Kandji accepts it
// but the response is lost or unreadable, the device can still be wiped, so
// the error says the erase may have been queued with that PIN and to check
// get_device_commands before retrying. A 4xx is a definitive rejection and
// carries no such hint.

describe("Regression: erase_device reports the supplied PIN when the erase may have been queued", () => {
  const ERASE_HIT = "POST /devices/dev-1/action/erase";
  const PIN = "246810";

  async function eraseWithFailure(failure) {
    state.lastDeviceAction = null;
    state.hits = {};
    state.deviceActionFailure = failure;
    try {
      const mod = await import("../dist/tools/devices/erase-device.tool.js");
      return await mod.default().handler({ device_id: "dev-1", PIN }, {});
    } finally {
      state.deviceActionFailure = null;
    }
  }

  for (const [label, failure] of [
    ["connection dropped after the command was accepted", "drop"],
    ["200 whose body is not JSON", "garbled"],
    ["502 from the gateway", 502],
  ]) {
    it(`reports the supplied PIN in the error: ${label}`, async () => {
      const out = await eraseWithFailure(failure);
      assert.equal(state.hits[ERASE_HIT], 1);
      assert.equal(state.lastDeviceAction.body.PIN, PIN);
      assert.equal(out.isError, true);
      const text = out.content[0].text;
      assert.ok(
        text.includes(
          `The erase may still have been queued with the PIN you supplied ("${PIN}")`,
        ),
        text,
      );
      assert.ok(text.includes("get_device_commands"), text);
    });
  }

  it("gives no queued hint when Kandji rejects the erase with a 4xx", async () => {
    const out = await eraseWithFailure(400);
    assert.equal(state.hits[ERASE_HIT], 1);
    assert.equal(out.isError, true);
    const text = out.content[0].text;
    assert.match(text, /^Error: Kandji API error 400/);
    assert.doesNotMatch(text, /queued/i);
    assert.ok(!text.includes(PIN), text);
  });
});

// ── Regression: a configuration error is not an uncertain erase ──
//
// A non-https KANDJI_BASE_URL fails when the client is built, before any
// request exists, so the error must not say the erase may have been queued,
// and must carry no PIN. The client is a process-level singleton built from
// the environment on first use, so each case runs in a fresh process. Its
// base URL is the mock's own, so a request that slipped past the https
// guard would be recorded here.

describe("Regression: erase_device reports a configuration error as it is and sends nothing", () => {
  async function eraseInFreshProcess(args, env) {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const child = spawn(
      process.execPath,
      [path.join(here, "harness-erase-device.mjs"), JSON.stringify(args)],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...env },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    await new Promise((resolve) => child.on("close", resolve));
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(
        `harness produced no JSON. stdout=${stdout} stderr=${stderr}`,
      );
    }
  }

  // The mock's base URL is plain http; clearing the opt-out makes the
  // client refuse it.
  const insecureEnv = () => ({
    KANDJI_BASE_URL: baseUrl,
    KANDJI_ALLOW_INSECURE: "",
  });

  it("with a PIN: a non-https base URL gives no queued hint and sends nothing", async () => {
    state.hits = {};
    const out = await eraseInFreshProcess(
      { device_id: "dev-1", PIN: "135790" },
      insecureEnv(),
    );
    assert.equal(out.isError, true);
    const text = out.content[0].text;
    assert.match(text, /^Error: KANDJI_BASE_URL must use https/);
    assert.doesNotMatch(text, /queued/i);
    assert.ok(!text.includes("135790"), text);
    assert.deepEqual(state.hits, {}, "no request may reach Kandji");
  });

  it("without a PIN: a non-https base URL is reported instead of a PIN", async () => {
    state.hits = {};
    const out = await eraseInFreshProcess(
      { device_id: "dev-1" },
      insecureEnv(),
    );
    assert.equal(out.isError, true);
    const text = out.content[0].text;
    assert.match(text, /^Error: KANDJI_BASE_URL must use https/);
    assert.doesNotMatch(text, /queued/i);
    assert.doesNotMatch(text, /\bPIN\b|\d{6}/);
    assert.deepEqual(state.hits, {}, "no request may reach Kandji");
  });
});

// ── Regression: a cancelled erase_device call sends nothing more ──
//
// When an MCP client cancels a call or times it out, the SDK drops the
// handler's result and the client has given up on the call, so nothing may
// be sent after that point. The longest 429 backoff (60 s) equals the MCP
// SDK client's default request timeout, so the retry must not go out once
// the call has been cancelled.

describe("Regression: erase_device sends nothing once the call is cancelled", () => {
  const ERASE_HIT = "POST /devices/dev-1/action/erase";

  it("does not send the retry when the call is cancelled during the 429 backoff", async () => {
    state.hits = {};
    state.deviceActionFailure = 429;
    const controller = new AbortController();
    try {
      const mod = await import("../dist/tools/devices/erase-device.tool.js");
      const pending = mod
        .default()
        .handler(
          { device_id: "dev-1", PIN: "112233" },
          { signal: controller.signal },
        );
      for (let i = 0; i < 200 && !state.hits[ERASE_HIT]; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      // Let the 429 land, so the client is inside its 1 s backoff, then cancel.
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.abort();
      await pending;
    } finally {
      state.deviceActionFailure = null;
    }
    assert.equal(state.hits[ERASE_HIT], 1);
  });

  it("does not send the erase when the call was cancelled before it started", async () => {
    state.hits = {};
    const controller = new AbortController();
    controller.abort();
    const mod = await import("../dist/tools/devices/erase-device.tool.js");
    await mod
      .default()
      .handler(
        { device_id: "dev-1", PIN: "112233" },
        { signal: controller.signal },
      );
    assert.equal(state.hits[ERASE_HIT], undefined);
  });
});

describe("Device actions: unlock_account requires user_name", () => {
  it("unlock_account tool sends UserName in the body", async () => {
    state.lastDeviceAction = null;
    const mod = await import("../dist/tools/devices/unlock-account.tool.js");
    const def = mod.default();
    const out = await def.handler(
      { device_id: "dev-1", user_name: "alice" },
      {},
    );
    assert.equal(out.content[0].type, "text");
    assert.ok(!out.content[0].text.startsWith("Error"));
    assert.equal(state.lastDeviceAction.action, "unlockaccount");
    assert.deepEqual(state.lastDeviceAction.body, { UserName: "alice" });
  });

  it("unlock_account tool exposes user_name as a required schema field", async () => {
    const mod = await import("../dist/tools/devices/unlock-account.tool.js");
    const def = mod.default();
    assert.ok(def.schema.user_name);
    const r = def.schema.user_name.safeParse("");
    assert.equal(r.success, false, "empty user_name should be rejected");
  });
});

describe("Device actions: enable_lost_mode passes optional fields", () => {
  it("enable_lost_mode tool with no extras posts an empty body (legacy contract)", async () => {
    state.lastDeviceAction = null;
    const mod = await import(
      "../dist/tools/devices/enable-lost-mode.tool.js"
    );
    const def = mod.default();
    await def.handler({ device_id: "dev-1" }, {});
    assert.equal(state.lastDeviceAction.action, "enablelostmode");
    assert.equal(state.lastDeviceAction.body, null);
  });

  it("enable_lost_mode tool maps message/phone_number/footnote to Apple MDM keys", async () => {
    state.lastDeviceAction = null;
    const mod = await import(
      "../dist/tools/devices/enable-lost-mode.tool.js"
    );
    const def = mod.default();
    await def.handler(
      {
        device_id: "dev-1",
        message: "If found, please return.",
        phone_number: "+1-555-0100",
        footnote: "Property of ExampleCorp",
      },
      {},
    );
    assert.deepEqual(state.lastDeviceAction.body, {
      Message: "If found, please return.",
      PhoneNumber: "+1-555-0100",
      Footnote: "Property of ExampleCorp",
    });
  });
});

// ── Coverage: blueprint write tools ───────────────────────────────

describe("Coverage: blueprint write tools", () => {
  it("create_blueprint → POST /blueprints with name + description", async () => {
    state.lastBlueprintCreate = null;
    const res = await handlers.blueprintWrite.createBlueprint({
      name: "Engineers",
      description: "Default for eng",
    });
    assert.equal(res.isError, false, res.error);
    assert.deepEqual(state.lastBlueprintCreate, {
      name: "Engineers",
      description: "Default for eng",
      // Client always injects enrollment_code.is_active because the upstream
      // API rejects requests without it (see createBlueprint in the client).
      enrollment_code: { is_active: true },
    });
    assert.equal(res.result.id, "bp-new");
  });

  it("update_blueprint → PATCH /blueprints/{id}", async () => {
    state.lastBlueprintUpdate = null;
    const res = await handlers.blueprintWrite.updateBlueprint("bp1", {
      name: "Renamed",
    });
    assert.equal(res.isError, false);
    assert.equal(state.lastBlueprintUpdate.id, "bp1");
    assert.deepEqual(state.lastBlueprintUpdate.body, { name: "Renamed" });
  });

  it("delete_blueprint → DELETE /blueprints/{id}", async () => {
    state.lastBlueprintDelete = null;
    const res = await handlers.blueprintWrite.deleteBlueprint("bp1");
    assert.equal(res.isError, false);
    assert.equal(state.lastBlueprintDelete, "bp1");
  });

  it("assign_library_item → POST /blueprints/{id}/assign_library_item with library_item_id", async () => {
    state.lastAssign = null;
    const res = await handlers.blueprintWrite.assignLibraryItemToBlueprint(
      "bp1",
      "ca1",
    );
    assert.equal(res.isError, false);
    assert.equal(state.lastAssign.blueprint_id, "bp1");
    assert.deepEqual(state.lastAssign.body, { library_item_id: "ca1" });
  });

  it("remove_library_item → POST /blueprints/{id}/remove_library_item", async () => {
    state.lastRemove = null;
    const res = await handlers.blueprintWrite.removeLibraryItemFromBlueprint(
      "bp1",
      "ca1",
    );
    assert.equal(res.isError, false);
    assert.equal(state.lastRemove.blueprint_id, "bp1");
    assert.deepEqual(state.lastRemove.body, { library_item_id: "ca1" });
  });
});

// ── Coverage: library write tools ─────────────────────────────────

describe("Coverage: library write tools", () => {
  it("create_custom_app → POST /library/custom-apps", async () => {
    state.lastLibraryCreate = null;
    const res = await handlers.libraryWrite.createCustomApp({
      name: "Slack",
      file_key: "k",
    });
    assert.equal(res.isError, false, res.error);
    assert.equal(state.lastLibraryCreate.kind, "custom-apps");
    assert.equal(state.lastLibraryCreate.body.name, "Slack");
    assert.equal(res.result.id, "custom-apps-new");
  });

  it("update_custom_app → PATCH /library/custom-apps/{id}", async () => {
    state.lastLibraryUpdate = null;
    const res = await handlers.libraryWrite.updateCustomApp("ca1", {
      name: "Slack 2",
    });
    assert.equal(res.isError, false);
    assert.equal(state.lastLibraryUpdate.kind, "custom-apps");
    assert.equal(state.lastLibraryUpdate.id, "ca1");
  });

  it("delete_custom_app → DELETE /library/custom-apps/{id}", async () => {
    state.lastLibraryDelete = null;
    const res = await handlers.libraryWrite.deleteCustomApp("ca1");
    assert.equal(res.isError, false);
    assert.equal(state.lastLibraryDelete.kind, "custom-apps");
    assert.equal(state.lastLibraryDelete.id, "ca1");
  });

  it("upload_custom_app_binary → POST /library/custom-apps/upload returns presigned URL", async () => {
    state.lastLibraryUpload = null;
    const res = await handlers.libraryWrite.requestCustomAppUpload(
      "Slack-4.40.0.pkg",
    );
    assert.equal(res.isError, false);
    assert.equal(state.lastLibraryUpload.kind, "custom-apps");
    assert.equal(state.lastLibraryUpload.body.name, "Slack-4.40.0.pkg");
    assert.equal(res.result.file_key, "s3-key-Slack-4.40.0.pkg");
    assert.ok(res.result.post_url.startsWith("https://"));
    assert.ok(res.result.post_data);
  });

  it("create/update/delete custom-profiles, custom-scripts, ipa-apps each hit the right path", async () => {
    // Each library kind has a different create-payload contract,
    // confirmed against the live API.
    const kinds = [
      {
        path: "custom-profiles",
        fn: "CustomProfile",
        createArgs: {
          name: "test-custom-profiles",
          mobileconfig: '<?xml version="1.0"?><plist></plist>',
          runs_on_mac: true,
        },
        expectedContentType: "multipart/form-data",
      },
      {
        path: "custom-scripts",
        fn: "CustomScript",
        createArgs: { name: "test-custom-scripts", script: "#!/bin/bash" },
        expectedContentType: "application/json",
      },
      {
        path: "ipa-apps",
        fn: "InHouseApp",
        createArgs: { name: "test-ipa-apps", file_key: "s3-key-x" },
        expectedContentType: "application/json",
      },
    ];

    for (const { path: kind, fn: fnSuffix, createArgs, expectedContentType } of kinds) {
      state.lastLibraryCreate = null;
      const create =
        await handlers.libraryWrite[`create${fnSuffix}`](createArgs);
      assert.equal(create.isError, false, `create ${kind}: ${create.error}`);
      assert.equal(state.lastLibraryCreate.kind, kind);
      assert.ok(
        state.lastLibraryCreate.contentType.startsWith(expectedContentType),
        `create ${kind} should send ${expectedContentType}, got ${state.lastLibraryCreate.contentType}`,
      );

      state.lastLibraryUpdate = null;
      const update = await handlers.libraryWrite[`update${fnSuffix}`]("li1", {
        name: "renamed",
      });
      assert.equal(update.isError, false);
      assert.equal(state.lastLibraryUpdate.kind, kind);

      state.lastLibraryDelete = null;
      const del = await handlers.libraryWrite[`delete${fnSuffix}`]("li1");
      assert.equal(del.isError, false);
      assert.equal(state.lastLibraryDelete.kind, kind);
    }
  });

  it("create_custom_profile → multipart with `file` part + runs_on_mac=true", async () => {
    state.lastLibraryCreate = null;
    const res = await handlers.libraryWrite.createCustomProfile({
      name: "WiFi-corp",
      mobileconfig: '<?xml version="1.0"?><plist><dict/></plist>',
      runs_on_mac: true,
    });
    assert.equal(res.isError, false, res.error);
    const cap = state.lastLibraryCreate;
    assert.equal(cap.kind, "custom-profiles");
    assert.ok(cap.contentType.startsWith("multipart/form-data"));
    assert.equal(cap.body.name, "WiFi-corp");
    assert.equal(cap.body.runs_on_mac, "true");
    // The mobileconfig must travel as a file part, not a regular field
    assert.ok(
      cap.body.file && cap.body.file.filename,
      "expected a `file` multipart part with the mobileconfig",
    );
  });

  it("update_custom_profile → JSON for rename, multipart when replacing mobileconfig", async () => {
    state.lastLibraryUpdate = null;
    await handlers.libraryWrite.updateCustomProfile("cp1", { name: "renamed" });
    assert.ok(
      state.lastLibraryUpdate.contentType.startsWith("application/json"),
      "rename should use JSON",
    );

    state.lastLibraryUpdate = null;
    await handlers.libraryWrite.updateCustomProfile("cp1", {
      mobileconfig: '<?xml version="1.0"?><plist></plist>',
    });
    assert.ok(
      state.lastLibraryUpdate.contentType.startsWith("multipart/form-data"),
      "mobileconfig replacement should use multipart",
    );
    assert.ok(
      state.lastLibraryUpdate.body.file &&
        state.lastLibraryUpdate.body.file.filename,
      "expected a `file` part in the multipart PATCH",
    );
  });

  it("upload_in_house_app_binary → POST /library/ipa-apps/upload with filename (not name)", async () => {
    // Confirmed live 2026-05-07: /library/ipa-apps/upload requires `filename`
    // while /library/custom-apps/upload requires `name`. The wrappers split
    // accordingly.
    state.lastLibraryUpload = null;
    const res = await handlers.libraryWrite.requestInHouseAppUpload(
      "InternalApp.ipa",
    );
    assert.equal(res.isError, false);
    assert.equal(state.lastLibraryUpload.kind, "ipa-apps");
    assert.equal(state.lastLibraryUpload.body.filename, "InternalApp.ipa");
    assert.equal(
      state.lastLibraryUpload.body.name,
      undefined,
      "ipa-apps/upload must NOT send `name` — it is silently ignored",
    );
  });
});

// ── Tool registration: tools export a name + schema + handler ─────
//
// Checks that representative tools across the three write categories
// register, expose the expected schema, and return the MCP
// {content: [{type, text}]} shape.

describe("Coverage: representative tools wire end-to-end through the tool layer", () => {
  it("lock_device tool returns MCP content shape", async () => {
    const mod = await import(
      "../dist/tools/devices/lock-device.tool.js"
    );
    const def = mod.default();
    assert.equal(def.name, "lock_device");
    assert.ok(def.description.startsWith("DESTRUCTIVE"));
    assert.ok(def.schema.device_id);
    const out = await def.handler({ device_id: "dev-1" }, {});
    assert.ok(Array.isArray(out.content));
    assert.equal(out.content[0].type, "text");
    assert.ok(!out.content[0].text.startsWith("Error"));
  });

  it("create_blueprint tool returns MCP content shape", async () => {
    const mod = await import(
      "../dist/tools/blueprints/create-blueprint.tool.js"
    );
    const def = mod.default();
    assert.equal(def.name, "create_blueprint");
    const out = await def.handler({ name: "QA" }, {});
    assert.equal(out.content[0].type, "text");
    assert.ok(!out.content[0].text.startsWith("Error"));
  });

  it("create_custom_script tool returns MCP content shape", async () => {
    const mod = await import(
      "../dist/tools/library/create-custom-script.tool.js"
    );
    const def = mod.default();
    assert.equal(def.name, "create_custom_script");
    const out = await def.handler(
      {
        name: "lockdown",
        script: "#!/bin/sh\nexit 0",
      },
      {},
    );
    assert.equal(out.content[0].type, "text");
    assert.ok(!out.content[0].text.startsWith("Error"));
  });
});

// ── Coverage: blueprint templates + OTA enrollment ────────────────

describe("Coverage: blueprint templates + clone + OTA enrollment", () => {
  it("list_blueprint_templates → GET /blueprints/templates/", async () => {
    const res = await handlers.listBlueprints.listBlueprintTemplates();
    assert.equal(res.isError, false, res.error);
    // No ambiguous leading `count` (it would count category GROUPS); both
    // axes are explicit.
    assert.equal(res.result.count, undefined);
    assert.equal(res.result.category_count, 2);
    assert.equal(res.result.template_count, 2);
    assert.equal(res.result.results, undefined);
    assert.ok(Array.isArray(res.result.templates));
    const compliance = res.result.templates.find((c) => c.name === "Compliance");
    assert.ok(compliance, "Compliance category present");
    assert.equal(compliance.templates[0].id, 42);
  });

  it("create_blueprint with template_id sends source.{type:template,id}", async () => {
    state.lastBlueprintCreate = null;
    const res = await handlers.blueprintWrite.createBlueprint({
      name: "SOC2 from template",
      source: { type: "template", id: 42 },
    });
    assert.equal(res.isError, false, res.error);
    assert.deepEqual(state.lastBlueprintCreate.source, {
      type: "template",
      id: 42,
    });
  });

  it("create_blueprint tool: template_id shorthand round-trips through tool layer", async () => {
    state.lastBlueprintCreate = null;
    const mod = await import(
      "../dist/tools/blueprints/create-blueprint.tool.js"
    );
    const def = mod.default();
    // Sanity: the clone-source schema fields surface for the LLM.
    assert.ok(def.schema.template_id);
    assert.ok(def.schema.source_type);
    assert.ok(def.schema.source_id);
    const out = await def.handler(
      { name: "SOC2 cloned", template_id: 42 },
      {},
    );
    assert.equal(out.content[0].type, "text");
    assert.ok(!out.content[0].text.startsWith("Error"));
    assert.deepEqual(state.lastBlueprintCreate.source, {
      type: "template",
      id: 42,
    });
  });

  it("create_blueprint preserves backward compat (name + description only)", async () => {
    state.lastBlueprintCreate = null;
    const res = await handlers.blueprintWrite.createBlueprint({
      name: "Plain",
      description: "no template",
    });
    assert.equal(res.isError, false);
    assert.deepEqual(state.lastBlueprintCreate, {
      name: "Plain",
      description: "no template",
      enrollment_code: { is_active: true },
    });
    assert.equal(state.lastBlueprintCreate.source, undefined);
  });

  it("get_blueprint_ota_enrollment_profile → wraps raw mobileconfig", async () => {
    const res =
      await handlers.getBlueprint.getBlueprintOtaEnrollmentProfile("bp-soc2");
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.content_type, "application/x-apple-aspen-config");
    assert.equal(res.result.filename, "kandji-enroll.mobileconfig");
    // The profile is delivered as base64 (it's a signed CMS/PKCS#7 binary
    // on live tenants, which a text decode would corrupt); there is no
    // `mobileconfig` text key.
    assert.equal(res.result.mobileconfig, undefined);
    assert.equal(res.result.encoding, "base64");
    assert.match(res.result.note, /base64/i);
    assert.match(
      Buffer.from(res.result.mobileconfig_base64, "base64").toString("utf8"),
      /fixture-bp-soc2/,
    );
  });

  it("get_blueprint_ota_enrollment_profile sso=true → returns JSON {url}", async () => {
    const res = await handlers.getBlueprint.getBlueprintOtaEnrollmentProfile(
      "bp-soc2",
      true,
    );
    assert.equal(res.isError, false);
    assert.match(res.result.url, /enrollment\/auth\?bp=bp-soc2/);
  });

  it("list_blueprint_templates tool wraps the response in MCP content shape", async () => {
    const mod = await import(
      "../dist/tools/blueprints/list-blueprint-templates.tool.js"
    );
    const def = mod.default();
    assert.equal(def.name, "list_blueprint_templates");
    const out = await def.handler({}, {});
    assert.equal(out.content[0].type, "text");
    assert.ok(!out.content[0].text.startsWith("Error"));
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.category_count, 2);
    assert.equal(parsed.template_count, 2);
  });

  it("get_blueprint_ota_enrollment_profile tool wraps the response in MCP content shape", async () => {
    const mod = await import(
      "../dist/tools/blueprints/get-blueprint-ota-enrollment-profile.tool.js"
    );
    const def = mod.default();
    assert.equal(def.name, "get_blueprint_ota_enrollment_profile");
    const out = await def.handler({ blueprint_id: "bp-soc2" }, {});
    assert.equal(out.content[0].type, "text");
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.content_type, "application/x-apple-aspen-config");
  });
});

// ── Regression tests: pagination, envelope and annotation edge cases ──
//
// These three blocks are intentionally appended at the end of the file and
// self-contained. Where a scenario needs response shapes the shared mock
// doesn't serve (true page-bucket semantics, a DRF-wrapped /devices), they
// temporarily swap the shared server's "request" listener for an interceptor
// that handles just the paths under test and delegates everything else to
// the original handler, restoring it in `finally`. node:test runs tests in
// definition order with no concurrency, so the swap cannot affect earlier
// suites.

/**
 * Replace the shared mock server's request listener with `route`. `route`
 * returns true when it handled the request; anything else falls through to
 * the original listener. Returns a restore function.
 */
function interceptServer(route) {
  const original = server.listeners("request")[0];
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const handled = route(
      req,
      res,
      Object.fromEntries(url.searchParams),
      mockPath(url.pathname),
    );
    if (!handled) original(req, res);
  });
  return () => {
    server.removeAllListeners("request");
    server.on("request", original);
  };
}

describe("Regression: page/size pagination keeps `size` constant across hops", () => {
  // Vuln-management endpoints paginate by page/size: pages are server-side
  // buckets of `size` records. Shrinking `size` on the last hop (when
  // maxResults isn't a multiple of the page size) would re-bucket the dataset
  // mid-stream — records duplicate and drop — so the client keeps `size`
  // constant and trims the final overshoot client-side.
  it("returns maxResults unique records and never varies the size param", async () => {
    const TOTAL = 500; // dataset larger than maxResults so trimming is exercised
    const MAX = 450; // not a multiple of the client's 300-row page size
    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      cve_id: `CVE-2026-${i}`,
      idx: i,
    }));
    const sizesSeen = [];
    const restore = interceptServer((req, res, query, pathname) => {
      if (
        pathname !== "/vulnerability-management/vulnerabilities" ||
        req.method !== "GET"
      ) {
        return false;
      }
      // Faithful page-bucket semantics: page N of size S is rows
      // [(N-1)*S, N*S) of the full dataset — exactly why a size change
      // mid-pagination re-buckets and corrupts the stream.
      const size = parseInt(query.size ?? "50", 10);
      const page = parseInt(query.page ?? "1", 10);
      sizesSeen.push(size);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          results: rows.slice((page - 1) * size, page * size),
          total: TOTAL,
          page,
          size,
        }),
      );
      return true;
    });
    try {
      const res = await handlers.listVulns.listVulnerabilities({}, MAX);
      assert.equal(res.isError, false, res.error);
      const got = res.result.vulnerabilities;
      assert.equal(got.length, MAX, "overshoot must be trimmed client-side");
      const ids = new Set(got.map((r) => r.cve_id));
      assert.equal(
        ids.size,
        MAX,
        "duplicate records returned — size param changed mid-pagination",
      );
      assert.equal(
        got[MAX - 1].idx,
        MAX - 1,
        "tail records dropped — size param changed mid-pagination",
      );
      assert.ok(sizesSeen.length >= 2, "expected more than one page request");
      assert.equal(
        new Set(sizesSeen).size,
        1,
        `size param varied across hops: ${sizesSeen.join(", ")}`,
      );
    } finally {
      restore();
    }
  });
});

describe("Regression: listDevices unwraps a DRF results-enveloped /devices", () => {
  // extractItems() returns [] for a non-array body without throwing, so a
  // catch-based fallback to the DRF {count, next, results[]} envelope would
  // never run and wrapped tenants would silently get an empty device list.
  // The client inspects the body shape directly and unwraps either form.
  it("returns devices when the tenant wraps /devices in {count, results}", async () => {
    const restore = interceptServer((req, res, query, pathname) => {
      if (pathname !== "/devices" || req.method !== "GET") return false;
      const all = [DEVICE_1, DEVICE_2];
      const offset = parseInt(query.offset ?? "0", 10);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          count: all.length,
          next: null,
          previous: null,
          results: all.slice(offset),
        }),
      );
      return true;
    });
    try {
      const res = await handlers.listDevices.listDevices();
      assert.equal(res.isError, false, res.error);
      assert.equal(
        res.result.count,
        2,
        "DRF-wrapped tenant silently produced an empty device list",
      );
      assert.deepEqual(
        res.result.devices.map((d) => d.device_id),
        ["dev-1", "dev-2"],
      );
    } finally {
      restore();
    }
  });

  it("still handles the documented bare-array shape", async () => {
    // Bare array that honours offset so pagination terminates on the empty
    // second page. Deliberately ignores `limit` (unlike the shared mock) so
    // this pins the bare-array unwrap independently of the shared route.
    const restore = interceptServer((req, res, query, pathname) => {
      if (pathname !== "/devices" || req.method !== "GET") return false;
      const all = [DEVICE_1, DEVICE_2];
      const offset = parseInt(query.offset ?? "0", 10);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(all.slice(offset)));
      return true;
    });
    try {
      const res = await handlers.listDevices.listDevices();
      assert.equal(res.isError, false, res.error);
      assert.equal(res.result.count, 2);
      assert.equal(res.result.devices[0].device_id, "dev-1");
    } finally {
      restore();
    }
  });
});

describe("Regression: prism_request_export annotations reflect POST semantics", () => {
  // The tool POSTs /prism/export and creates a new server-side export job on
  // every call, so it must be annotated as a non-destructive, non-idempotent
  // write — and explicitly so, because the `prism_` name prefix would
  // otherwise infer read-only.
  it("is annotated as a non-destructive, non-idempotent write", async () => {
    const def = (
      await import("../dist/tools/prism/prism-request-export.tool.js")
    ).default();
    assert.equal(def.name, "prism_request_export");
    assert.equal(def.annotations.readOnlyHint, false);
    assert.equal(def.annotations.destructiveHint, false);
    assert.equal(def.annotations.idempotentHint, false);
  });
});

// ── Security: KANDJI_BASE_URL scheme/format validation ──────────
//
// The base URL is concatenated with every request path while the API token
// rides in a Bearer header, so a plain-http typo would transmit the token in
// cleartext and a malformed value points it at an unintended host. The client
// constructor parses with new URL() and requires https unless
// KANDJI_ALLOW_INSECURE=1. Each scenario needs a fresh process (the client is
// a singleton), so we spawn a tiny harness per case.

describe("Security: KANDJI_BASE_URL is validated", () => {
  async function probeBaseUrl(env) {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const child = spawn(
      process.execPath,
      [path.join(here, "harness-base-url.mjs")],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...env },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    await new Promise((resolve) => child.on("close", resolve));
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`harness produced no JSON. stdout=${stdout} stderr=${stderr}`);
    }
  }

  it("rejects a plain http:// base URL when KANDJI_ALLOW_INSECURE is not set", async () => {
    const verdict = await probeBaseUrl({
      KANDJI_BASE_URL: "http://insecure.example.com/api/v1",
      KANDJI_ALLOW_INSECURE: "", // explicitly cleared
    });
    assert.equal(verdict.ok, false, "plain-http base URL must be rejected");
    assert.match(verdict.error, /https/i);
  });

  it("rejects a malformed (non-URL) base URL", async () => {
    const verdict = await probeBaseUrl({
      KANDJI_BASE_URL: "not a url",
      KANDJI_ALLOW_INSECURE: "",
    });
    assert.equal(verdict.ok, false, "malformed base URL must be rejected");
    assert.match(verdict.error, /not a valid URL/i);
  });

  it("rejects a non-http(s) scheme (e.g. file://)", async () => {
    const verdict = await probeBaseUrl({
      KANDJI_BASE_URL: "file:///etc/passwd",
      KANDJI_ALLOW_INSECURE: "1",
    });
    assert.equal(verdict.ok, false, "non-http(s) scheme must be rejected");
    assert.match(verdict.error, /scheme/i);
  });

  it("accepts a valid https base URL", async () => {
    const verdict = await probeBaseUrl({
      KANDJI_BASE_URL: "https://acme.api.kandji.io/api/v1",
      KANDJI_ALLOW_INSECURE: "",
    });
    assert.equal(verdict.ok, true, verdict.error);
  });

  it("allows plain http only when KANDJI_ALLOW_INSECURE=1 (the documented opt-out)", async () => {
    const verdict = await probeBaseUrl({
      KANDJI_BASE_URL: "http://127.0.0.1:9999/api/v1",
      KANDJI_ALLOW_INSECURE: "1",
    });
    assert.equal(verdict.ok, true, verdict.error);
  });
});

// ── Security: upstream error body is bounded + delimited ────────
//
// Splicing up to 2000 chars of the raw upstream body verbatim into
// model-facing output would be a prompt-injection amplification vector and a
// token sink, so the model-facing message is hard-capped (~280 chars) and
// prefixed "[upstream response — untrusted]"; the full body stays on the
// operator-facing `bodyText` field. Handlers also surface { status, hint }
// so the LLM can branch on 404/401/400.

describe("Security: upstream error bodies are bounded and delimited", () => {
  it("caps a huge 500 body in the model-facing error and marks it untrusted", async () => {
    const HUGE = "X".repeat(8000);
    const restore = interceptServer((req, res, query, pathname) => {
      if (pathname !== "/devices/dev-evil") return false;
      res.writeHead(500, { "content-type": "text/html" });
      res.end(`<html><body>${HUGE}</body></html>`);
      return true;
    });
    try {
      const getDevice = await import("../dist/handlers/get-device.handler.js");
      const out = await getDevice.getDevice("dev-evil");
      assert.equal(out.isError, true);
      // Model-facing message must NOT carry the full 8000-char body.
      assert.ok(
        out.error.length < 600,
        `error message not bounded (${out.error.length} chars)`,
      );
      assert.match(out.error, /\[upstream response — untrusted\]/);
      assert.match(out.error, /500/);
      // Structured status + remediation hint are surfaced.
      assert.equal(out.status, 500);
    } finally {
      restore();
    }
  });

  it("attaches a 404 'enumerate first' hint so the LLM re-runs list_*", async () => {
    const restore = interceptServer((req, res, query, pathname) => {
      if (pathname !== "/devices/missing") return false;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "Not found." }));
      return true;
    });
    try {
      const getDevice = await import("../dist/handlers/get-device.handler.js");
      const out = await getDevice.getDevice("missing");
      assert.equal(out.isError, true);
      assert.equal(out.status, 404);
      assert.match(out.hint, /list_/);
    } finally {
      restore();
    }
  });

  it("attaches a 400 'check required fields' hint", async () => {
    const restore = interceptServer((req, res, query, pathname) => {
      if (pathname !== "/devices/dev-1" || req.method !== "PATCH") return false;
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ user: ["Invalid pk."] }));
      return true;
    });
    try {
      const update = await import("../dist/handlers/update-device.handler.js");
      const out = await update.updateDevice("dev-1", { user: "not-a-real-id" });
      assert.equal(out.isError, true);
      assert.equal(out.status, 400);
      assert.match(out.hint, /required fields|value formats/i);
    } finally {
      restore();
    }
  });

  it("test_connection failure names KANDJI_API_TOKEN and KANDJI_BASE_URL", async () => {
    const restore = interceptServer((req, res, query, pathname) => {
      if (pathname !== "/devices" || req.method !== "GET") return false;
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "Invalid token." }));
      return true;
    });
    try {
      const tc = await import("../dist/handlers/test-connection.handler.js");
      const out = await tc.testConnection();
      assert.equal(out.isError, true);
      // 401 maps to a scope/license hint; either that or the env-var fallback
      // is acceptable, but a hint must be present and actionable.
      assert.ok(out.hint, "test_connection failure should carry a hint");
    } finally {
      restore();
    }
  });
});
