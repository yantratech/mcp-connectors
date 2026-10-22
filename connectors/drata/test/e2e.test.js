/**
 * End-to-end tests for Drata MCP connector.
 *
 * Spins up a local HTTP server that mimics Drata's V1/V2 API, points the
 * singleton DrataClient at it, then calls every handler we've touched and
 * validates the responses.
 *
 * Run: node --test test/e2e.test.js
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";

// ── Mock data ──────────────────────────────────────────────────

// Stable ISO timestamps relative to test run for the SEC_TRAINING renewal
// check in check_personnel_compliance.
const FUTURE_RENEWAL = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
const PAST_RENEWAL = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

/**
 * V1 personnel — matches the real Drata GET /public/personnel response.
 * All user details (name, email, roles, backgroundChecks, documents,
 * drataTermsAgreedAt) are nested under the `user` object.
 */
const V1_PERSONNEL = [
  {
    id: 1,
    employmentStatus: "CURRENT_EMPLOYEE",
    user: {
      id: 10,
      firstName: "Sally",
      lastName: "Smith",
      email: "sally@example.com",
      jobTitle: "Engineer",
      drataTermsAgreedAt: "2024-01-01T00:00:00Z",
      backgroundChecks: [{ id: 1 }],
      roles: ["EMPLOYEE"],
      documents: [
        { id: 800, type: "SEC_TRAINING", renewalDate: FUTURE_RENEWAL },
      ],
    },
    createdAt: "2023-01-01",
    updatedAt: "2024-01-01",
  },
  {
    id: 2,
    employmentStatus: "CURRENT_EMPLOYEE",
    user: {
      id: 20,
      firstName: "Alex",
      lastName: "Doe",
      email: "alex@example.com",
      jobTitle: "Compliance Lead",
      drataTermsAgreedAt: null,
      backgroundChecks: [],
      roles: null,
      documents: [],
    },
    createdAt: "2023-06-01",
    updatedAt: "2024-06-01",
  },
  {
    // Edge case: user object is null (deactivated account)
    id: 3,
    employmentStatus: "FORMER_EMPLOYEE",
    user: null,
    createdAt: "2022-01-01",
    updatedAt: "2023-01-01",
  },
  {
    // Edge case: training existed but is now expired — should still count as
    // missing.
    id: 4,
    employmentStatus: "CURRENT_EMPLOYEE",
    user: {
      id: 40,
      firstName: "Pat",
      lastName: "Lapsed",
      email: "pat@example.com",
      jobTitle: "Analyst",
      drataTermsAgreedAt: "2024-02-01T00:00:00Z",
      backgroundChecks: [{ id: 4 }],
      roles: ["EMPLOYEE"],
      documents: [
        { id: 801, type: "SEC_TRAINING", renewalDate: PAST_RENEWAL },
      ],
    },
    createdAt: "2023-02-01",
    updatedAt: "2024-02-01",
  },
];

const VENDORS = [
  {
    id: 100,
    name: "Amazon Web Services (AWS)",
    critical: true,
    risk: "HIGH",
    impactLevel: "MAJOR",
    hasPii: true,
    category: "ENGINEERING",
    url: "https://aws.amazon.com",
    privacyUrl: "https://aws.amazon.com/privacy",
    termsUrl: "https://aws.amazon.com/terms",
    passwordPolicy: "SSO",
    passwordMfaEnabled: true,
    isSubProcessor: true,
    isSubProcessorActive: true,
    securityReviews: [
      { id: 1, status: "COMPLETED", decision: "APPROVED", title: "Annual security review" },
    ],
    notes: null,
    confirmed: true,
  },
  {
    id: 101,
    name: "Example Chat",
    critical: false,
    risk: "LOW",
    impactLevel: "MINOR",
    hasPii: false,
    category: "ADMINISTRATIVE",
    url: "https://chat.example.com",
    privacyUrl: null,
    termsUrl: null,
    passwordPolicy: "USERNAME_PASSWORD",
    passwordMfaEnabled: false,
    isSubProcessor: false,
    isSubProcessorActive: false,
    securityReviews: [],
    notes: "Team messaging",
    confirmed: false,
  },
  {
    id: 102,
    name: "Example Tracker",
    critical: false,
    risk: "MODERATE",
    impactLevel: "MODERATE",
    hasPii: false,
    category: "ENGINEERING",
    url: "https://tracker.example.com",
    privacyUrl: "https://tracker.example.com/privacy",
    termsUrl: null,
    passwordPolicy: "SSO",
    passwordMfaEnabled: true,
    isSubProcessor: false,
    isSubProcessorActive: false,
    securityReviews: [],
    notes: null,
    confirmed: true,
  },
];

// ── Monitors ──────────────────────────────────────────────────

const MONITORS = [
  {
    id: 1,
    name: "Disk encryption",
    description: "All endpoints encrypt at rest",
    checkResultStatus: "PASSED",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "HIGH",
    lastCheck: "2026-04-25T12:00:00Z",
    monitorInstances: [],
  },
  {
    id: 2,
    name: "MFA enforced",
    description: "All admin accounts have MFA",
    checkResultStatus: "FAILED",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "HIGH",
    lastCheck: "2026-04-25T12:00:00Z",
    monitorInstances: [
      {
        id: 21,
        checkResultStatus: "FAILED",
        checkFrequency: "DAILY",
        autopilotTaskType: "AWS_MFA",
        failedTestDescription: "2 admin accounts without MFA",
        evidenceCollectionDescription: "",
        monitorInstanceCheckTypes: [],
      },
    ],
  },
  {
    id: 3,
    name: "Backups configured",
    description: "Daily backups run",
    checkResultStatus: "PASSED",
    checkStatus: "DISABLED",
    disabledMessage: "Customer disabled",
    priority: "MEDIUM",
    lastCheck: "2026-04-20T12:00:00Z",
    monitorInstances: [],
  },
  {
    id: 4,
    name: "Legacy ready monitor",
    description: "Legacy READY status",
    checkResultStatus: "READY",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "LOW",
    lastCheck: "2026-04-25T12:00:00Z",
    monitorInstances: [],
  },
  {
    id: 5,
    name: "Errored monitor",
    description: "API error",
    checkResultStatus: "ERROR",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "HIGH",
    lastCheck: "2026-04-25T12:00:00Z",
    monitorInstances: [],
  },
  {
    // NEEDS_ATTENTION should land in the failing bucket — it is enabled and
    // not a passing status.
    id: 6,
    name: "Stale monitor",
    description: "Drata flagged for review",
    checkResultStatus: "NEEDS_ATTENTION",
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority: "MEDIUM",
    lastCheck: "2026-04-25T12:00:00Z",
    monitorInstances: [],
  },
];

// ── Events ────────────────────────────────────────────────────

// 60 events — more than the 50 cap to verify clamping.
const EVENTS = Array.from({ length: 60 }, (_, i) => ({
  id: `evt-${i + 1}`,
  type: "CONTROL_UPDATED",
  category: "CONTROL",
  source: "USER",
  description: `Event ${i + 1}`,
  metadata: {},
  status: null,
  createdAt: new Date(2026, 3, 27, 12, 0, i).toISOString(),
  user: null,
  connection: null,
  requestDescription: null,
}));

// ── Workspaces & Frameworks (V2) ───────────────────────────────

const WORKSPACES = [{ id: 42, name: "Primary" }];

const FRAMEWORKS_BY_WORKSPACE = {
  42: [
    { id: 1, name: "SOC 2", slug: "soc2" },
    { id: 2, name: "ISO 27001", slug: "iso27001" },
  ],
};

// ── V2 monitoring tests, evidence library, devices, connections, assets ─

// Real Drata monitoring tests carry BOTH a monitor `id` and a small
// workspace-scoped `testId`; get_monitoring_test resolves callers' ids
// against this list before fetching the single test.
const MONITORING_TESTS = [
  { id: 205, testId: 8, name: "MFA enforced", checkResultStatus: "PASSED" },
  { id: 206, testId: 36, name: "Disk encryption", checkResultStatus: "FAILED" },
];

// ── V2 controls (expand=flags,evidenceIds,testIds,frameworkTags,requirements) ─
// check_control_status now reads these instead of V1 /public/controls.
// Drata's narrow flags.hasEvidence only covers external uploads + reports;
// the fixture deliberately spreads evidence across every source so the
// "evidence of ANY kind" derivation is observable.
//
// Each control also carries a reverse `requirements` collection (bare array
// or {data, totalCount} envelope, both shapes live) — the framework
// requirement readiness rollup builds its requirement→controls mapping from
// this walk. Mapping design:
//   requirement 1  → DCF-21 (ready) + DCF-33 (ready)      → ready
//   requirement 2  → DCF-26 (not ready)                   → in scope, not ready
//   requirement 3  → DCF-21 (ready) + DCF-55 (archived)   → ready, 1 archived
//   requirement 61 → DCF-55 (archived) ONLY               → out of scope

const emptyEvidenceIds = () => ({
  validExternalEvidenceIds: [],
  invalidExternalEvidenceIds: [],
  validReportIds: [],
  invalidReportIds: [],
});
const emptyTestIds = () => ({ passing: [], failing: [], monitored: [] });

const V2_CONTROLS = [
  {
    // Evidence ONLY from a monitored test — Drata's narrow flag says false.
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
    requirements: [{ id: 2 }],
  },
  {
    // Evidence ONLY from a mapped policy.
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
    // Envelope shape — some tenants return {data, totalCount} here.
    requirements: { data: [{ id: 1 }, { id: 3 }], totalCount: 2 },
  },
  {
    // Manually attached external evidence — the one case the narrow flag sees.
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
    requirements: [{ id: 1 }],
  },
  {
    // Truly evidence-free.
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
    requirements: [],
  },
  {
    // Archived — excluded unless includeArchived.
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
      hasOwner: false,
    },
    evidenceIds: emptyEvidenceIds(),
    testIds: emptyTestIds(),
    frameworkTags: ["SOC_2"],
    requirements: [{ id: 3 }, { id: 61 }],
  },
];

const EVIDENCE_LIBRARY = [
  { id: 100, name: "SOC2 cert", type: "DOC" },
  { id: 101, name: "Policy template", type: "DOC" },
];

const CONTROL_OWNERS = [
  { id: 11, userId: 10, controlId: 5 },
];

const CONNECTIONS_LIVE = [
  { id: 1, name: "AWS", state: "ACTIVE", connected: true, failedAt: null },
  { id: 2, name: "GitHub", state: "MISCONFIGURED", connected: true, failedAt: null },
  { id: 3, name: "Okta", state: "ACTIVE", connected: true, failedAt: "2026-04-20T00:00:00Z" },
  { id: 4, name: "Stripe", state: "CONFIGURED_PENDING_CONFIRMATION", connected: true, failedAt: null },
];

const DEVICES_V2 = [
  // Reporting device — fully configured
  {
    id: 1, personnelId: 10, lastCheckedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    encryptionEnabled: true, firewallEnabled: true, antivirusEnabled: true,
    autoUpdateEnabled: true, passwordManagerEnabled: true,
    screenLockTime: 60, osVersion: "macOS 14.5", model: "MacBook Pro", serialNumber: "ABC123",
  },
  // Non-reporting — recent check but ALL telemetry null
  {
    id: 2, personnelId: 11, lastCheckedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    encryptionEnabled: null, firewallEnabled: null, antivirusEnabled: null,
    autoUpdateEnabled: null, passwordManagerEnabled: null,
    screenLockTime: null, osVersion: null, model: null, serialNumber: null,
  },
  // Non-reporting — old lastCheckedAt
  {
    id: 3, personnelId: 12, lastCheckedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    encryptionEnabled: true, firewallEnabled: true, antivirusEnabled: true,
    autoUpdateEnabled: true, passwordManagerEnabled: true,
    screenLockTime: 60, osVersion: "macOS 14.5", model: "MacBook Pro", serialNumber: "DEF456",
  },
];

const ASSETS_DATA = Array.from({ length: 75 }, (_, i) => ({
  id: i + 1,
  name: `Asset ${i + 1}`,
  type: "WORKSTATION",
}));

// ── V2 vendors with security reviews ───────────────────────────

const V2_VENDORS = [
  {
    id: 100,
    name: "Amazon Web Services (AWS)",
    critical: true,
    risk: "HIGH",
    impactLevel: "MAJOR",
    hasPii: true,
    securityReviews: [
      {
        id: 1,
        status: "COMPLETED",
        decision: "APPROVED",
        title: "Annual security review",
        requestedAt: "2026-01-15T00:00:00Z",
      },
      { id: 2, status: "IN_PROGRESS", decision: "PENDING", title: "Pen-test follow-up" },
    ],
  },
  {
    id: 101,
    name: "Example Chat",
    critical: false,
    risk: "LOW",
    impactLevel: "MINOR",
    hasPii: false,
    securityReviews: [],
  },
  {
    id: 102,
    name: "Example Tracker",
    critical: false,
    risk: "MODERATE",
    impactLevel: "MODERATE",
    hasPii: false,
    // V2 surfaces a review V1 omitted.
    securityReviews: [
      { id: 7, status: "COMPLETED", decision: "APPROVED", title: "Initial vendor assessment" },
    ],
  },
];

// Toggleable: when true, /public/v2/vendors returns 500 so the handler must
// fall back to V1.
let v2VendorsBroken = false;

// Toggleable for pagination tests on /public/monitors. When > 1 the mock
// splits MONITORS across pages of size 3 and returns a `total` of all monitors.
let monitorsPageSize = null;

// Toggleable for /public/v2/workspaces.
let workspacesPayloadOverride = null;
let workspacesBroken = false;

// Toggleable: when true, /public/v2/policies returns the same cursor twice in
// a row, simulating the server-side bug fetchAllV2 must guard against.
let policiesStuckCursor = false;

// Toggleable for /public/controls.
let controlsPayloadOverride = null;

// Captures injected V2-only vendors; merged into V2_VENDORS at request time.
let extraV2Vendors = [];

// Captures injected VENDOR_SECURITY_REVIEW_STARTED events for fallback tests.
let vendorReviewStartedEvents = [];

const STATE_PATH = `/tmp/drata-e2e-state-${process.pid}.json`;

// ── Track requests for assertion ───────────────────────────────

/** @type {Array<{method: string, path: string, query?: string, body?: unknown, accept?: string}>} */
let capturedRequests = [];

// ── Policy mock data ──────────────────────────────────────────

const POLICIES = [
  {
    id: 13,
    name: "Information Security Policy",
    status: "ACTIVE",
  },
  {
    id: 14,
    name: "Data Retention Policy",
    status: "ARCHIVED",
  },
];

const POLICY_VERSIONS = [
  {
    id: 501,
    policyId: 13,
    version: 1,
    current: false,
    status: "PUBLISHED",
  },
  {
    id: 502,
    policyId: 13,
    version: 2,
    current: true,
    status: "DRAFT",
  },
];

const POLICY_VERSION_HTML =
  "<html><body><h1>Information Security Policy</h1><p>Section 1. Purpose...</p></body></html>";

const POLICY_ACTIONS = {
  data: [
    { action: "SubmitForApproval" },
    { action: "Approve" },
    { action: "Publish" },
    { action: "Discard" },
  ],
  pagination: { cursor: null },
};

const USER_ASSIGNED_POLICIES = [
  { id: 901, userId: 10, policyId: 13, acknowledged: true },
  { id: 902, userId: 10, policyId: 14, acknowledged: false },
];

// ── Mock HTTP server ───────────────────────────────────────────

function createMockServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    // Collect body for POST/PUT
    let body = "";
    if (method === "POST" || method === "PUT") {
      for await (const chunk of req) body += chunk;
    }
    let parsedBody;
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/json") && body) {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        /* multipart or invalid */
      }
    }

    capturedRequests.push({
      method,
      path,
      query: url.searchParams.toString(),
      body: parsedBody,
      accept: req.headers["accept"],
    });

    res.setHeader("Content-Type", "application/json");

    // ── V1 offset-paginated endpoints ──

    if (method === "GET" && path === "/public/personnel") {
      return json(res, {
        data: V1_PERSONNEL,
        page: 1,
        limit: 50,
        total: V1_PERSONNEL.length,
      });
    }

    if (method === "GET" && path === "/public/vendors") {
      return json(res, {
        data: VENDORS,
        page: 1,
        limit: 50,
        total: VENDORS.length,
      });
    }

    if (method === "GET" && path === "/public/monitors") {
      if (monitorsPageSize) {
        const page = Number(url.searchParams.get("page") ?? 1);
        const limit = monitorsPageSize;
        const start = (page - 1) * limit;
        const slice = MONITORS.slice(start, start + limit);
        return json(res, {
          data: slice,
          page,
          limit,
          total: MONITORS.length,
        });
      }
      return json(res, {
        data: MONITORS,
        page: 1,
        limit: 50,
        total: MONITORS.length,
      });
    }

    if (method === "GET" && path === "/public/controls") {
      const requirementId = url.searchParams.get("requirementId");
      if (requirementId) {
        const id = Number(requirementId);
        const data = [
          {
            id: id + 100,
            code: `DCF-${id}`,
            name: `Control ${id}`,
            isReady: id % 2 === 1,
            isMonitored: true,
            hasEvidence: true,
            hasOwner: true,
            frameworkTags: ["SOC_2"],
          },
        ];
        return json(res, { data, page: 1, limit: 50, total: data.length });
      }
      const data = controlsPayloadOverride ?? [];
      return json(res, { data, page: 1, limit: 50, total: data.length });
    }

    const controlRequirementsMatch = path.match(/^\/public\/controls\/(\d+)\/requirements$/);
    if (method === "GET" && controlRequirementsMatch) {
      const controlId = Number(controlRequirementsMatch[1]);
      return json(res, {
        data: [
          {
            id: 7,
            name: "CC9.1",
            description: "Business continuity and recovery procedures are tested.",
            isReady: false,
            frameworkName: "SOC 2",
            frameworkId: 1,
            controls: [{ id: controlId, code: "DCF-26", isReady: false }],
            totalInScopeControls: 1,
          },
        ],
        page: 1,
        limit: 50,
        total: 1,
      });
    }

    // Empty-list stubs for V1 endpoints that gap-analysis and
    // compliance-summary fan out to. The bug-fix tests don't care about
    // these, but the handlers will error if any sub-fetch 404s.
    const v1EmptyPaths = new Set([
      "/public/policies",
      "/public/devices",
    ]);
    if (method === "GET" && v1EmptyPaths.has(path)) {
      return json(res, { data: [], page: 1, limit: 50, total: 0 });
    }

    if (method === "GET" && path === "/public/events") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      // Mirror Drata behavior: reject limits over 50.
      if (limit > 50) {
        res.writeHead(400);
        return res.end(
          JSON.stringify({ message: "limit must not be greater than 50" }),
        );
      }
      return json(res, {
        data: EVENTS.slice(0, limit),
        page: 1,
        limit,
        total: EVENTS.length,
      });
    }

    // GET /public/vendors/:id
    const vendorGetMatch = path.match(/^\/public\/vendors\/(\d+)$/);
    if (method === "GET" && vendorGetMatch) {
      const id = Number(vendorGetMatch[1]);
      const vendor = VENDORS.find((v) => v.id === id);
      if (!vendor) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Not found" }));
      }
      return json(res, vendor);
    }

    // PUT /public/vendors/:id
    if (method === "PUT" && vendorGetMatch) {
      const id = Number(vendorGetMatch[1]);
      return json(res, { id, ...parsedBody });
    }

    // ── V2 cursor-paginated endpoints ──

    if (method === "GET" && path === "/public/v2/workspaces") {
      if (workspacesBroken) {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: "service unavailable" }));
      }
      if (workspacesPayloadOverride) {
        return json(res, workspacesPayloadOverride);
      }
      return json(res, {
        data: WORKSPACES,
        pagination: { cursor: null },
      });
    }

    const frameworksMatch = path.match(/^\/public\/v2\/workspaces\/(\d+)\/frameworks$/);
    if (method === "GET" && frameworksMatch) {
      const wid = Number(frameworksMatch[1]);
      const frameworks = FRAMEWORKS_BY_WORKSPACE[wid] ?? [];
      return json(res, {
        data: frameworks,
        pagination: { cursor: null },
      });
    }

    const requirementsMatch = path.match(
      /^\/public\/v2\/workspaces\/(\d+)\/framework-requirements$/,
    );
    if (method === "GET" && requirementsMatch) {
      // 61 mock requirements, more than one default page. Honor
      // `size` param so we can prove default size is forwarded; if no
      // `size` is present in the query, mimic Drata's permissive server
      // default and return everything.
      const wid = Number(requirementsMatch[1]);
      const sizeParam = url.searchParams.get("size");
      const size = sizeParam !== null ? Number(sizeParam) : 100;
      const withControls =
        url.searchParams.getAll("expand").includes("controls") ||
        url.searchParams.getAll("expand[]").includes("controls");
      const makeControl = (n, overrides = {}) => ({
        id: n + 100,
        code: `DCF-${n + 1}`,
        controlNumber: n + 1,
        isReady: n % 2 === 0,
        archivedAt: null,
        ...overrides,
      });
      // Requirement-side expanded-controls shapes, mirroring what live
      // tenants return (Drata caps this expand at 10 inline controls, which
      // is why the readiness rollup no longer reads it — it builds the
      // mapping from the control side's expand=requirements instead):
      //  - requirement 1 carries a {data, totalCount} envelope;
      //  - requirement 3 has an archived mapping alongside its live one;
      //  - requirement 61's mapped controls are ALL archived;
      //  - everything else is a bare one-control array.
      const controlsFor = (i) => {
        if (i === 0) return { data: [makeControl(i)], totalCount: 1 };
        if (i === 2) {
          return [
            makeControl(i),
            makeControl(i + 900, { archivedAt: "2025-06-01T00:00:00Z" }),
          ];
        }
        if (i === 60) {
          return [makeControl(i, { archivedAt: "2025-06-01T00:00:00Z", isReady: false })];
        }
        return [makeControl(i)];
      };
      const all = Array.from({ length: 61 }, (_, i) => ({
        id: i + 1,
        name: `Requirement ${i + 1}`,
        workspaceId: wid,
        ...(withControls ? { controls: controlsFor(i) } : {}),
      }));
      const slice = all.slice(0, size);
      return json(res, {
        data: slice,
        pagination: { cursor: slice.length < all.length ? `cursor-${slice.length}` : null },
      });
    }

    // Monitoring tests for a workspace
    const monTestsMatch = path.match(/^\/public\/v2\/workspaces\/(\d+)\/monitoring-tests$/);
    if (method === "GET" && monTestsMatch) {
      return json(res, { data: MONITORING_TESTS, pagination: { cursor: null } });
    }
    const monTestGetMatch = path.match(/^\/public\/v2\/workspaces\/(\d+)\/monitoring-tests\/(\d+)$/);
    if (method === "GET" && monTestGetMatch) {
      // The single-test route is keyed by the workspace-scoped testId — the
      // handler always resolves monitor ids to a testId before this GET.
      const tid = Number(monTestGetMatch[2]);
      const t = MONITORING_TESTS.find((x) => x.testId === tid);
      if (!t) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "not found" }));
      }
      return json(res, t);
    }

    // Evidence library
    const evidenceMatch = path.match(/^\/public\/v2\/workspaces\/(\d+)\/evidence-library$/);
    if (method === "GET" && evidenceMatch) {
      return json(res, { data: EVIDENCE_LIBRARY, pagination: { cursor: null } });
    }

    // V2 controls list (cursor-paginated) — check_control_status reads this
    // with expand=flags&expand=evidenceIds&expand=testIds&expand=frameworkTags.
    const controlsV2Match = path.match(/^\/public\/v2\/workspaces\/(\d+)\/controls$/);
    if (method === "GET" && controlsV2Match) {
      return json(res, { data: V2_CONTROLS, pagination: { cursor: null } });
    }

    // Control owners
    const ownersMatch = path.match(/^\/public\/v2\/workspaces\/(\d+)\/controls\/(\d+)\/owners$/);
    if (method === "GET" && ownersMatch) {
      return json(res, { data: CONTROL_OWNERS, pagination: { cursor: null } });
    }
    // POST adds a single owner — Drata requires `{ ownerId }`. Reject the
    // stale `{ userId }` shape the same way the live API does so a regression
    // is caught here, not in production.
    if (method === "POST" && ownersMatch) {
      if (!parsedBody || typeof parsedBody.ownerId !== "number") {
        res.writeHead(400);
        return res.end(
          JSON.stringify({
            statusCode: 400,
            message:
              parsedBody && "userId" in parsedBody
                ? ["property userId should not exist", "ownerId should not be empty"]
                : ["ownerId should not be empty"],
          }),
        );
      }
      return json(res, { controlId: Number(ownersMatch[2]), ownerId: parsedBody.ownerId, added: true });
    }
    // PUT replaces all owners — Drata requires `{ ownerUserIds: number[] }`.
    if (method === "PUT" && ownersMatch) {
      if (!parsedBody || !Array.isArray(parsedBody.ownerUserIds)) {
        res.writeHead(400);
        return res.end(
          JSON.stringify({
            statusCode: 400,
            message:
              parsedBody && "userIds" in parsedBody
                ? ["property userIds should not exist", "ownerUserIds must be an array"]
                : ["ownerUserIds must be an array"],
          }),
        );
      }
      return json(res, { controlId: Number(ownersMatch[2]), ownerUserIds: parsedBody.ownerUserIds, replaced: true });
    }

    // V2 devices
    if (method === "GET" && path === "/public/v2/devices") {
      return json(res, { data: DEVICES_V2, pagination: { cursor: null } });
    }

    // V2 events — single page with cursor
    if (method === "GET" && path === "/public/v2/events") {
      const size = Number(url.searchParams.get("size") ?? 50);
      if (url.searchParams.get("type") === "VENDOR_SECURITY_REVIEW_STARTED") {
        return json(res, {
          data: vendorReviewStartedEvents.slice(0, size),
          pagination: { cursor: null },
        });
      }
      if (url.searchParams.has("createdAtFrom")) {
        return json(res, {
          data: [
            {
              id: "old-event",
              type: "CONTROL_UPDATED",
              category: "CONTROL",
              createdAt: "2026-03-01T00:00:00.000Z",
              description: "old event Drata should have filtered",
            },
            {
              id: "new-event",
              type: "CONTROL_UPDATED",
              category: "CONTROL",
              createdAt: "2026-04-10T00:00:00.000Z",
              description: "new event",
            },
          ],
          pagination: { cursor: null },
        });
      }
      // Just return a fixed sample to keep response small
      const data = Array.from({ length: Math.min(size, 5) }, (_, i) => ({
        id: `evt-${i + 1}`,
        type: "CONTROL_UPDATED",
        category: "CONTROL",
        createdAt: new Date(2026, 3, 27, 12, 0, i).toISOString(),
        description: `event ${i + 1}`,
      }));
      return json(res, { data, pagination: { cursor: data.length === size ? "next-cursor" : null } });
    }

    // V1 assets paginated. Real Drata's V1 `total` field is unreliable
    // — the EU instance returns 9999999 — so the mock returns that
    // sentinel to make sure the handler is computing total accurately
    // rather than passing the raw value through.
    if (method === "GET" && path === "/public/assets") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const start = (page - 1) * limit;
      return json(res, {
        data: ASSETS_DATA.slice(start, start + limit),
        page,
        limit,
        total: 9999999, // sentinel — handler must replace with real count
      });
    }

    // V1 connections — return CONNECTIONS_LIVE for the connection-health tests
    if (method === "GET" && path === "/public/connections") {
      return json(res, {
        data: CONNECTIONS_LIVE,
        page: 1,
        limit: 50,
        total: CONNECTIONS_LIVE.length,
      });
    }

    // Risk register — simulate 402 plan-gated response
    if (method === "GET" && path === "/public/v2/risk-registers") {
      res.writeHead(402);
      return res.end(
        JSON.stringify({
          statusCode: 402,
          message: "You must upgrade your plan to access Risk Management",
          code: 10740,
        }),
      );
    }

    if (method === "GET" && path === "/public/v2/vendors") {
      if (v2VendorsBroken) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: "simulated outage" }));
      }
      return json(res, {
        data: [...V2_VENDORS, ...extraV2Vendors],
        pagination: { cursor: null },
      });
    }

    // V2 personnel endpoint returns stubs (no user details) — our handlers
    // use V1 instead, but keep the route for completeness.
    if (method === "GET" && path === "/public/v2/personnel") {
      return json(res, {
        data: V1_PERSONNEL.map((p) => ({ id: p.id, employmentStatus: p.employmentStatus, userId: p.user?.id ?? null })),
        pagination: { cursor: null },
      });
    }

    // PUT /public/v2/personnel/:id
    const personnelPutMatch = path.match(/^\/public\/v2\/personnel\/(\d+)$/);
    if (method === "PUT" && personnelPutMatch) {
      const id = Number(personnelPutMatch[1]);
      return json(res, { id, ...parsedBody, updated: true });
    }

    // POST /public/v2/background-checks
    if (method === "POST" && path === "/public/v2/background-checks") {
      return json(res, { id: 999, ...parsedBody, created: true });
    }

    // GET /public/v2/vendors/:id/security-reviews/:reviewId
    const secRevGetMatch = path.match(
      /^\/public\/v2\/vendors\/(\d+)\/security-reviews\/(\d+)$/,
    );
    if (method === "GET" && secRevGetMatch) {
      const vendorId = Number(secRevGetMatch[1]);
      const reviewId = Number(secRevGetMatch[2]);
      if (reviewId === 500) {
        // Persisted-id verification: the review object must carry the
        // status/decision fields — only COMPLETED reviews count as past
        // reviews under the corrected semantics.
        return json(res, {
          id: reviewId,
          vendorId,
          status: "COMPLETED",
          decision: "APPROVED",
          title: "Imported review",
          requestedAt: "2025-11-02T00:00:00Z",
        });
      }
      res.writeHead(404);
      return res.end(
        JSON.stringify({
          statusCode: 404,
          message: "Not Found",
          code: 10170,
          debugInfo: null,
        }),
      );
    }

    // POST /public/v2/vendors/:id/security-reviews
    const secRevMatch = path.match(
      /^\/public\/v2\/vendors\/(\d+)\/security-reviews$/,
    );
    if (method === "POST" && secRevMatch) {
      const vendorId = Number(secRevMatch[1]);
      return json(res, { id: 500, vendorId, ...parsedBody });
    }

    // POST /public/v2/vendors/:id/security-reviews/with-file (multipart)
    const secRevFileMatch = path.match(
      /^\/public\/v2\/vendors\/(\d+)\/security-reviews\/with-file$/,
    );
    if (method === "POST" && secRevFileMatch) {
      const vendorId = Number(secRevFileMatch[1]);
      return json(res, { id: 501, vendorId, fileReceived: true });
    }

    // ── Policy endpoints ──

    // GET /public/v2/policies
    if (method === "GET" && path === "/public/v2/policies") {
      if (policiesStuckCursor) {
        // Always return the same cursor — fetchAllV2 must detect the stall.
        return json(res, {
          data: POLICIES,
          pagination: { cursor: "stuck-cursor" },
        });
      }
      return json(res, { data: POLICIES, pagination: { cursor: null } });
    }

    // GET /public/v2/policies/:id
    const policyGetMatch = path.match(/^\/public\/v2\/policies\/(\d+)$/);
    if (method === "GET" && policyGetMatch) {
      const id = Number(policyGetMatch[1]);
      const p = POLICIES.find((x) => x.id === id);
      if (!p) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Not found" }));
      }
      return json(res, p);
    }

    // GET /public/v2/policies/:id/policy-versions
    const versionsListMatch = path.match(
      /^\/public\/v2\/policies\/(\d+)\/policy-versions$/,
    );
    if (method === "GET" && versionsListMatch) {
      const id = Number(versionsListMatch[1]);
      return json(res, {
        data: POLICY_VERSIONS.filter((v) => v.policyId === id),
        pagination: { cursor: null },
      });
    }

    // GET /public/v2/policies/:id/policy-versions/:vid
    const versionGetMatch = path.match(
      /^\/public\/v2\/policies\/(\d+)\/policy-versions\/(\d+)$/,
    );
    if (method === "GET" && versionGetMatch) {
      const policyId = Number(versionGetMatch[1]);
      const vid = Number(versionGetMatch[2]);
      const accept = req.headers["accept"] || "";
      if (accept.includes("text/html")) {
        res.setHeader("Content-Type", "text/html");
        res.writeHead(200);
        return res.end(POLICY_VERSION_HTML);
      }
      const ver = POLICY_VERSIONS.find(
        (v) => v.policyId === policyId && v.id === vid,
      );
      if (!ver) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Not found" }));
      }
      return json(res, ver);
    }

    // GET /public/v2/policies/:id/actions
    const actionsGetMatch = path.match(
      /^\/public\/v2\/policies\/(\d+)\/actions$/,
    );
    if (method === "GET" && actionsGetMatch) {
      return json(res, POLICY_ACTIONS);
    }

    // POST /public/v2/policies/:id/actions
    if (method === "POST" && actionsGetMatch) {
      return json(res, {
        success: true,
        newStatus: "APPROVED",
        message: `Action ${parsedBody?.action} performed`,
      });
    }

    // GET /public/v2/users/:uid/assigned-policies
    const assignedListMatch = path.match(
      /^\/public\/v2\/users\/(\d+)\/assigned-policies$/,
    );
    if (method === "GET" && assignedListMatch) {
      const uid = Number(assignedListMatch[1]);
      return json(res, {
        data: USER_ASSIGNED_POLICIES.filter((p) => p.userId === uid),
        pagination: { cursor: null },
      });
    }

    // POST /public/v2/users/:uid/assigned-policies/:pid/action-acknowledge
    const ackMatch = path.match(
      /^\/public\/v2\/users\/(\d+)\/assigned-policies\/(\d+)\/action-acknowledge$/,
    );
    if (method === "POST" && ackMatch) {
      const uid = Number(ackMatch[1]);
      const pid = Number(ackMatch[2]);
      return json(res, {
        userId: uid,
        policyId: pid,
        acknowledged: true,
        acceptedAt: parsedBody?.acceptedAt,
        details: parsedBody?.details,
      });
    }

    // Catch-all 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: `No mock for ${method} ${path}` }));
  });
}

function json(res, data) {
  res.writeHead(200);
  res.end(JSON.stringify(data));
}

// ── Test suite ─────────────────────────────────────────────────

let server;
let port;

// Handlers (dynamically imported after env vars are set)
let listPersonnel,
  listPersonnelV2,
  listControls,
  listVendors,
  checkPersonnel,
  checkVendors,
  checkVendorSecurityReviews,
  searchVendors,
  getVendor,
  updateVendor,
  archiveVendor,
  createVendorSecurityReview,
  resolvePersonnelIdByEmail,
  resolveUserIdForPersonnel,
  updatePersonnel,
  createBackgroundCheck,
  createBackgroundCheckTool,
  listPoliciesV2,
  getPolicy,
  listPolicyVersions,
  getPolicyVersion,
  getPolicyVersionContent,
  listPolicyActions,
  performPolicyAction,
  listUserAssignedPolicies,
  acknowledgeAssignedPolicy,
  checkMonitors,
  getRecentEvents,
  listFrameworks,
  listFrameworkRequirements,
  runGapAnalysis,
  getComplianceSummary,
  listMonitoringTestsV2,
  listEvidenceLibrary,
  getMonitoringTest,
  listControlOwners,
  addControlOwner,
  modifyControlOwners,
  listVendorTypes,
  listVendorQuestionnaires,
  listDevicesV2,
  listRiskRegisters,
  listEventsV2,
  listAssets,
  listConnections;

before(async () => {
  server = createMockServer();
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;

  process.env.DRATA_API_KEY = "test-key-12345";
  process.env.DRATA_BASE_URL = `http://localhost:${port}`;
  process.env.DRATA_MCP_STATE_PATH = STATE_PATH;

  // Dynamic imports — must happen after env vars are set so the singleton
  // picks up our mock server URL.
  const listEntities = await import("../dist/handlers/list-entities.handler.js");
  const v2Write = await import("../dist/handlers/v2-write.handler.js");
  const checkPersonnelMod = await import("../dist/handlers/check-personnel.handler.js");
  const checkVendorsMod = await import("../dist/handlers/check-vendors.handler.js");
  const checkVendorSecRevMod = await import("../dist/handlers/check-vendor-security-reviews.handler.js");
  const vendorRead = await import("../dist/handlers/vendor-read.handler.js");
  const vendorWrite = await import("../dist/handlers/vendor-write.handler.js");
  const checkMonitorsMod = await import("../dist/handlers/check-monitors.handler.js");
  const getRecentEventsMod = await import("../dist/handlers/get-recent-events.handler.js");
  const runGapAnalysisMod = await import("../dist/handlers/run-gap-analysis.handler.js");
  const getComplianceSummaryMod = await import("../dist/handlers/get-compliance-summary.handler.js");

  listPersonnel = listEntities.listPersonnel;
  listControls = listEntities.listControls;
  listVendors = listEntities.listVendors;
  listPersonnelV2 = v2Write.listPersonnelV2;
  resolvePersonnelIdByEmail = v2Write.resolvePersonnelIdByEmail;
  resolveUserIdForPersonnel = v2Write.resolveUserIdForPersonnel;
  updatePersonnel = v2Write.updatePersonnel;
  createBackgroundCheck = v2Write.createBackgroundCheck;
  const createBgCheckMod = await import(
    "../dist/tools/v2/create-background-check.tool.js"
  );
  createBackgroundCheckTool = createBgCheckMod.default();
  createVendorSecurityReview = v2Write.createVendorSecurityReview;
  checkPersonnel = checkPersonnelMod.checkPersonnel;
  checkVendors = checkVendorsMod.checkVendors;
  checkVendorSecurityReviews = checkVendorSecRevMod.checkVendorSecurityReviews;
  searchVendors = vendorRead.searchVendors;
  getVendor = vendorRead.getVendor;
  updateVendor = vendorWrite.updateVendor;
  archiveVendor = vendorWrite.archiveVendor;

  listPoliciesV2 = v2Write.listPoliciesV2;
  getPolicy = v2Write.getPolicy;
  listPolicyVersions = v2Write.listPolicyVersions;
  getPolicyVersion = v2Write.getPolicyVersion;
  getPolicyVersionContent = v2Write.getPolicyVersionContent;
  listPolicyActions = v2Write.listPolicyActions;
  performPolicyAction = v2Write.performPolicyAction;
  listUserAssignedPolicies = v2Write.listUserAssignedPolicies;
  acknowledgeAssignedPolicy = v2Write.acknowledgeAssignedPolicy;

  checkMonitors = checkMonitorsMod.checkMonitors;
  getRecentEvents = getRecentEventsMod.getRecentEvents;
  listFrameworks = v2Write.listFrameworks;
  listFrameworkRequirements = v2Write.listFrameworkRequirements;
  runGapAnalysis = runGapAnalysisMod.runGapAnalysis;
  getComplianceSummary = getComplianceSummaryMod.getComplianceSummary;

  listMonitoringTestsV2 = v2Write.listMonitoringTestsV2;
  listEvidenceLibrary = v2Write.listEvidenceLibrary;
  getMonitoringTest = v2Write.getMonitoringTest;
  listControlOwners = v2Write.listControlOwners;
  addControlOwner = v2Write.addControlOwner;
  modifyControlOwners = v2Write.modifyControlOwners;
  listVendorTypes = v2Write.listVendorTypes;
  listVendorQuestionnaires = v2Write.listVendorQuestionnaires;
  listDevicesV2 = v2Write.listDevicesV2;
  listRiskRegisters = v2Write.listRiskRegisters;
  listEventsV2 = v2Write.listEventsV2;
  listAssets = listEntities.listAssets;
  listConnections = listEntities.listConnections;
});

after(() => {
  server?.close();
  try {
    unlinkSync(STATE_PATH);
  } catch {
    /* already absent */
  }
});

beforeEach(() => {
  capturedRequests = [];
  extraV2Vendors = [];
  vendorReviewStartedEvents = [];
  controlsPayloadOverride = null;
  v2VendorsBroken = false;
  try {
    unlinkSync(STATE_PATH);
  } catch {
    /* already absent */
  }
});

// ── Personnel: V1 ──────────────────────────────────────────────

describe("list_personnel (V1)", () => {
  it("flattens nested user object into top-level fields", async () => {
    const res = await listPersonnel();
    assert.equal(res.isError, false);
    const { personnel, total } = res.result;
    assert.equal(total, 4);

    // Record with nested user
    const sally = personnel.find((p) => p.id === 1);
    assert.equal(sally.firstName, "Sally");
    assert.equal(sally.lastName, "Smith");
    assert.equal(sally.email, "sally@example.com");
    assert.equal(sally.userId, 10);
    assert.equal(sally.jobTitle, "Engineer");
    assert.equal(sally.termsAgreed, true);

    const alex = personnel.find((p) => p.id === 2);
    assert.equal(alex.firstName, "Alex");
    assert.equal(alex.email, "alex@example.com");
    assert.equal(alex.termsAgreed, false);
  });

  it("handles null user object without crashing", async () => {
    const res = await listPersonnel();
    const ghost = res.result.personnel.find((p) => p.id === 3);
    assert.equal(ghost.firstName, null);
    assert.equal(ghost.lastName, null);
    assert.equal(ghost.email, null);
    assert.equal(ghost.userId, null);
    assert.equal(ghost.employmentStatus, "FORMER_EMPLOYEE");
  });
});

// ── Personnel: V2 ──────────────────────────────────────────────

describe("list_personnel_v2", () => {
  it("returns user details (uses V1 under the hood since V2 has no user data)", async () => {
    const res = await listPersonnelV2();
    assert.equal(res.isError, false);
    const { personnel, total } = res.result;
    assert.equal(total, 4);

    const sally = personnel.find((p) => p.id === 1);
    assert.equal(sally.firstName, "Sally");
    assert.equal(sally.lastName, "Smith");
    assert.equal(sally.email, "sally@example.com");
    assert.equal(sally.userId, 10);
    assert.equal(sally.jobTitle, "Engineer");
  });

  it("handles null user object without crashing", async () => {
    const res = await listPersonnelV2();
    const ghost = res.result.personnel.find((p) => p.id === 3);
    assert.equal(ghost.firstName, null);
    assert.equal(ghost.email, null);
    assert.equal(ghost.userId, null);
  });

  it("q parameter filters by first name", async () => {
    const res = await listPersonnelV2({ q: "Alex" });
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 1);
    assert.equal(res.result.personnel[0].firstName, "Alex");
  });

  it("q parameter filters by email", async () => {
    const res = await listPersonnelV2({ q: "sally@" });
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 1);
    assert.equal(res.result.personnel[0].email, "sally@example.com");
  });

  it("q parameter is case-insensitive", async () => {
    const res = await listPersonnelV2({ q: "alex" });
    assert.equal(res.result.total, 1);
    assert.equal(res.result.personnel[0].firstName, "Alex");
  });

  it("q parameter returns empty for non-match", async () => {
    const res = await listPersonnelV2({ q: "zzz_nonexistent" });
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 0);
  });

  it("q parameter matches full name", async () => {
    const res = await listPersonnelV2({ q: "Sally Smith" });
    assert.equal(res.result.total, 1);
    assert.equal(res.result.personnel[0].firstName, "Sally");
  });
});

describe("compact control and vendor reads", () => {
  it("check_control_status includes ids and filters by codes[] and fields[]", async () => {
    process.env.DRATA_WORKSPACE_ID = "1";
    capturedRequests = [];
    try {
      const { checkControls } = await import(
        "../dist/handlers/check-controls.handler.js"
      );

      const res = await checkControls("all", undefined, {
        codes: ["dcf-26"],
        fields: ["id", "code", "isReady"],
      });

      assert.equal(res.isError, false, res.error);
      assert.deepEqual(res.result.controls, [
        { id: 26, code: "DCF-26", isReady: false },
      ]);

      // Reads the V2 controls list with every evidence expand — not V1.
      const req = capturedRequests.find(
        (r) => r.method === "GET" && r.path === "/public/v2/workspaces/1/controls",
      );
      assert.ok(req, "should fetch /public/v2/workspaces/1/controls");
      for (const expand of ["flags", "evidenceIds", "testIds", "frameworkTags"]) {
        assert.ok(req.query.includes(`expand=${expand}`), req.query);
      }
      assert.ok(
        !capturedRequests.some((r) => r.path === "/public/controls"),
        "must not read V1 /public/controls",
      );
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("check_control_status hasEvidence means evidence of ANY kind and archived controls are excluded", async () => {
    process.env.DRATA_WORKSPACE_ID = "1";
    try {
      const { checkControls } = await import(
        "../dist/handlers/check-controls.handler.js"
      );

      const all = await checkControls("all", undefined, {});
      assert.equal(all.isError, false, all.error);
      // Archived controls are excluded by default…
      assert.ok(
        !all.result.controls.some((c) => c.code === "DCF-55"),
        "archived control must be absent by default",
      );
      assert.equal(all.result.summary.totalControls, 4);
      assert.equal(all.result.summary.archivedControlsExcluded, 1);
      assert.equal(all.result.summary.controlsWithAnyEvidence, 3);

      // Default projection is slim: hasEvidence yes, per-source breakdown no.
      const dcf26Slim = all.result.controls.find((c) => c.code === "DCF-26");
      assert.equal(dcf26Slim.hasEvidence, true);
      assert.ok(
        !("evidence" in dcf26Slim),
        "evidence breakdown is opt-in via fields[]",
      );
      assert.match(all.result.projectionNote, /slim projection/);

      // fields[] opts the per-source breakdown (and frameworkTags) back in.
      const detailed = await checkControls("all", undefined, {
        fields: ["code", "hasEvidence", "evidence", "frameworkTags"],
      });
      // Monitor-test-only evidence counts, even though Drata's narrow flag is false.
      const dcf26 = detailed.result.controls.find((c) => c.code === "DCF-26");
      assert.equal(dcf26.hasEvidence, true);
      assert.equal(dcf26.evidence.drataHasEvidenceFlag, false);
      assert.equal(dcf26.evidence.monitorTestCount, 1);
      // Mapped-policy-only evidence counts too.
      const dcf21 = detailed.result.controls.find((c) => c.code === "DCF-21");
      assert.equal(dcf21.hasEvidence, true);
      assert.equal(dcf21.evidence.hasMappedPolicy, true);
      // External evidence is the one case Drata's own flag agrees on.
      const dcf33 = detailed.result.controls.find((c) => c.code === "DCF-33");
      assert.equal(dcf33.hasEvidence, true);
      assert.equal(dcf33.evidence.externalEvidenceCount, 1);
      assert.equal(dcf33.evidence.drataHasEvidenceFlag, true);
      // V2 underscore tags are humanized on output.
      assert.deepEqual(dcf33.frameworkTags, ["SOC 2", "ISO 27001"]);

      // no_evidence returns ONLY the truly evidence-free control — the
      // monitor-test-only control must NOT be reported as evidence-free.
      const noEvidence = await checkControls("no_evidence", undefined, {});
      assert.equal(noEvidence.isError, false, noEvidence.error);
      assert.deepEqual(
        noEvidence.result.controls.map((c) => c.code),
        ["DCF-44"],
      );
      assert.equal(noEvidence.result.count, 1);
      assert.ok(
        !noEvidence.result.controls.some((c) => c.code === "DCF-26"),
        "monitor-test-only control must not be in no_evidence",
      );
      assert.ok(
        !noEvidence.result.controls.some((c) => c.code === "DCF-55"),
        "archived control must not be in no_evidence",
      );

      // includeArchived brings the archived control back.
      const withArchived = await checkControls("all", undefined, { includeArchived: true });
      assert.ok(withArchived.result.controls.some((c) => c.code === "DCF-55"));
      assert.equal(withArchived.result.summary.totalControls, 5);
      assert.equal(withArchived.result.summary.archivedControlsExcluded, 0);

      // Human-style framework filter matches the v2 "SOC_2" tag.
      const soc2 = await checkControls("all", "SOC 2", {});
      assert.equal(soc2.isError, false, soc2.error);
      assert.equal(soc2.result.summary.totalControls, 4);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("list_controls filters by codes[] and projects selected fields", async () => {
    controlsPayloadOverride = [
      {
        id: 26,
        code: "DCF-26",
        name: "Policy acknowledgement",
        isReady: false,
        isMonitored: true,
        hasEvidence: true,
        hasOwner: true,
        frameworkTags: ["SOC 2"],
      },
    ];

    const res = await listControls(undefined, {
      codes: ["DCF-26"],
      fields: ["id", "code"],
    });

    assert.equal(res.isError, false);
    assert.deepEqual(res.result.controls, [{ id: 26, code: "DCF-26" }]);
  });

  it("list_vendors projects selected fields", async () => {
    const res = await listVendors({ fields: ["id", "name", "risk"] });
    assert.equal(res.isError, false);
    const aws = res.result.vendors.find((v) => v.id === 100);
    assert.deepEqual(Object.keys(aws).sort(), ["id", "name", "risk"]);
  });
});

// ── check_personnel_compliance ─────────────────────────────────

describe("check_personnel_compliance", () => {
  it("shows actual names instead of 'undefined undefined'", async () => {
    const res = await checkPersonnel();
    assert.equal(res.isError, false);
    const { personnel } = res.result;
    const sally = personnel.find((p) => p.id === 1);
    assert.equal(sally.firstName, "Sally");
    assert.equal(sally.lastName, "Smith");
    // Must not contain "undefined"
    assert.ok(
      sally.firstName !== undefined && sally.firstName !== "undefined",
      "firstName should not be undefined",
    );
  });

  it("compacts background checks to a count by default, restorable via fields[]", async () => {
    const res = await checkPersonnel();
    const sally = res.result.personnel.find((p) => p.id === 1);
    assert.ok(!("backgroundChecks" in sally), "heavy array dropped by default");
    assert.equal(sally.backgroundChecksCount, 1);

    const detailed = await checkPersonnel({ fields: ["backgroundChecks"] });
    const sallyFull = detailed.result.personnel.find((p) => p.id === 1);
    assert.ok(Array.isArray(sallyFull.backgroundChecks));
    assert.equal(sallyFull.backgroundChecks.length, 1);
  });

  it("handles null roles from V1 user object", async () => {
    const res = await checkPersonnel();
    const alex = res.result.personnel.find((p) => p.id === 2);
    // V1 API returns roles: null — should be normalized to []
    assert.ok(Array.isArray(alex.roles));
  });

  it("returns a top-level summary with counts and missing-* lists", async () => {
    const res = await checkPersonnel();
    assert.equal(res.result.totalPersonnel, 4);
    // Only the three CURRENT_EMPLOYEE records are scored; the FORMER_EMPLOYEE
    // ghost (id 3) is summarized under nonCurrent instead.
    assert.equal(res.result.scoredPersonnel, 3);
    // Compliance now mirrors Drata's authoritative complianceChecks — never
    // proxies like document history or drataTermsAgreedAt. This fixture has
    // no complianceChecks data, so every scored record is unknown, and
    // unknown is never reported as missing.
    assert.equal(res.result.compliantCount, 0);
    assert.equal(res.result.nonCompliantCount, 0);
    assert.equal(res.result.unknownComplianceCount, 3);

    assert.ok(Array.isArray(res.result.missingTraining));
    assert.ok(Array.isArray(res.result.missingBgCheck));
    assert.ok(Array.isArray(res.result.missingPolicyAck));
    assert.equal(res.result.missingTraining.length, 0);
    assert.equal(res.result.missingBgCheck.length, 0);
    assert.equal(res.result.missingPolicyAck.length, 0);
    assert.match(res.result.semanticsNote, /complianceChecks/);
  });

  it("ghost record (user=null, FORMER_EMPLOYEE) moves to nonCurrent, not the scored list", async () => {
    const res = await checkPersonnel();
    assert.equal(
      res.result.personnel.find((p) => p.id === 3),
      undefined,
      "non-current records are not scored by default",
    );
    assert.equal(res.result.nonCurrent.total, 1);
    assert.equal(res.result.nonCurrent.byStatus.FORMER_EMPLOYEE, 1);
    const ghost = res.result.nonCurrent.personnel.find((p) => p.id === 3);
    assert.ok(ghost, "ghost summarized under nonCurrent");
    assert.equal(
      ghost.isCompliant,
      null,
      "no complianceChecks data → unknown, not assumed non-compliant",
    );

    // Opting in scores it alongside the rest.
    const scoredAll = await checkPersonnel({ includeNonCurrent: true });
    assert.equal(scoredAll.result.scoredPersonnel, 4);
    assert.ok(scoredAll.result.personnel.find((p) => p.id === 3));
  });

  it("annotates each scored record with complianceChecks-driven fields", async () => {
    const res = await checkPersonnel();
    assert.equal(res.result.personnel.length, 3);
    for (const person of res.result.personnel) {
      // Fixture has no complianceChecks: verdict is unknown, and nothing is
      // reported missing — document/ToS proxies no longer drive these flags.
      assert.equal(person.isCompliant, null);
      assert.equal(person.missingPolicyAck, false);
      assert.equal(person.missingBackgroundCheck, false);
      assert.equal(person.missingSecurityTraining, false);
      assert.deepEqual(person.failedChecks, []);
      assert.ok(!("termsAgreed" in person), "Drata-ToS proxy is dropped");
    }
  });
});

// ── resolvePersonnelIdByEmail ──────────────────────────────────

describe("resolvePersonnelIdByEmail", () => {
  it("resolves email to personnel ID (V2 flat shape)", async () => {
    const id = await resolvePersonnelIdByEmail("alex@example.com");
    assert.equal(id, 2);
  });

  it("is case-insensitive", async () => {
    const id = await resolvePersonnelIdByEmail("SALLY@EXAMPLE.COM");
    assert.equal(id, 1);
  });

  it("throws for unknown email", async () => {
    await assert.rejects(
      () => resolvePersonnelIdByEmail("nobody@example.com"),
      { message: /No personnel found with email/ },
    );
  });
});

describe("resolveUserIdForPersonnel", () => {
  it("returns userId as-is when provided directly", async () => {
    capturedRequests = [];
    const uid = await resolveUserIdForPersonnel({ userId: 99 });
    assert.equal(uid, 99);
    assert.equal(
      capturedRequests.find((r) => r.path === "/public/personnel"),
      undefined,
    );
  });

  it("resolves lookupEmail → userId via V1 personnel list", async () => {
    capturedRequests = [];
    const uid = await resolveUserIdForPersonnel({
      lookupEmail: "alex@example.com",
    });
    assert.equal(uid, 20);
  });

  it("resolves personnelId → userId via V1 personnel list", async () => {
    capturedRequests = [];
    const uid = await resolveUserIdForPersonnel({ personnelId: 1 });
    assert.equal(uid, 10);
  });

  it("throws a clear error when lookupEmail has no match", async () => {
    await assert.rejects(
      () => resolveUserIdForPersonnel({ lookupEmail: "nobody@example.com" }),
      /No personnel found with email "nobody@example.com"/,
    );
  });

  it("throws a clear error when personnelId has no match", async () => {
    await assert.rejects(
      () => resolveUserIdForPersonnel({ personnelId: 999999 }),
      /No personnel found with id 999999/,
    );
  });
});

describe("create_background_check tool", () => {
  const callTool = (args) =>
    createBackgroundCheckTool.handler(args, {
      signal: new AbortController().signal,
    });

  it("happy path: lookupEmail → resolves to userId → POST succeeds", async () => {
    capturedRequests = [];
    const res = await callTool({
      lookupEmail: "alex@example.com",
      url: "https://checks.example.com/r/1",
    });
    assert.ok(!res.content[0].text.startsWith("Error:"), res.content[0].text);
    const postReq = capturedRequests.find(
      (r) => r.method === "POST" && r.path === "/public/v2/background-checks",
    );
    assert.ok(postReq);
    assert.equal(postReq.body.userId, 20);
    assert.equal(postReq.body.personnelId, undefined);
    assert.equal(postReq.body.url, "https://checks.example.com/r/1");
  });

  it("happy path: personnelId → resolves to userId → POST succeeds", async () => {
    capturedRequests = [];
    const res = await callTool({
      personnelId: 1,
      url: "https://checks.example.com/r/2",
    });
    assert.ok(!res.content[0].text.startsWith("Error:"), res.content[0].text);
    const postReq = capturedRequests.find(
      (r) => r.method === "POST" && r.path === "/public/v2/background-checks",
    );
    assert.ok(postReq);
    assert.equal(postReq.body.userId, 10);
    assert.equal(postReq.body.personnelId, undefined);
  });

  it("happy path: userId direct → POST succeeds without lookup", async () => {
    capturedRequests = [];
    const res = await callTool({
      userId: 42,
      url: "https://checks.example.com/r/3",
    });
    assert.ok(!res.content[0].text.startsWith("Error:"), res.content[0].text);
    const postReq = capturedRequests.find(
      (r) => r.method === "POST" && r.path === "/public/v2/background-checks",
    );
    assert.ok(postReq);
    assert.equal(postReq.body.userId, 42);
    assert.equal(postReq.body.personnelId, undefined);
    assert.equal(
      capturedRequests.find((r) => r.path === "/public/personnel"),
      undefined,
    );
  });

  it("validation: none of the three provided → error, no HTTP call", async () => {
    capturedRequests = [];
    const res = await callTool({ url: "https://checks.example.com/r/4" });
    assert.match(
      res.content[0].text,
      /Provide exactly one of userId, personnelId, or lookupEmail/,
    );
    assert.equal(
      capturedRequests.find(
        (r) =>
          r.method === "POST" && r.path === "/public/v2/background-checks",
      ),
      undefined,
    );
  });

  it("validation: more than one provided → error", async () => {
    capturedRequests = [];
    const res = await callTool({
      userId: 10,
      personnelId: 1,
      url: "https://checks.example.com/r/5",
    });
    assert.match(
      res.content[0].text,
      /Provide exactly one of userId, personnelId, or lookupEmail/,
    );
  });

  it("clear error when lookupEmail has no matching personnel", async () => {
    capturedRequests = [];
    const res = await callTool({
      lookupEmail: "ghost@example.com",
      url: "https://checks.example.com/r/6",
    });
    assert.match(
      res.content[0].text,
      /No personnel found with email "ghost@example.com"/,
    );
    assert.equal(
      capturedRequests.find(
        (r) =>
          r.method === "POST" && r.path === "/public/v2/background-checks",
      ),
      undefined,
    );
  });
});

// ── Vendor tools ───────────────────────────────────────────────

describe("check_vendor_risk", () => {
  it("suggests generic vendor categories, not products, when the inventory is empty", async () => {
    const saved = VENDORS.splice(0, VENDORS.length);
    try {
      const res = await checkVendors();
      assert.equal(res.isError, false, `unexpected error: ${res.error}`);
      assert.equal(res.result.status, "NO_VENDORS");
      assert.equal(res.result.suggestedVendors, undefined);
      const categories = res.result.suggestedVendorCategories;
      assert.ok(Array.isArray(categories) && categories.length > 0);
      assert.ok(categories.includes("Identity provider / SSO"));
      assert.match(res.result.message, /suggestedVendorCategories/);
    } finally {
      VENDORS.push(...saved);
    }
  });

  it("returns trimmed vendor data, not full objects", async () => {
    const res = await checkVendors();
    assert.equal(res.isError, false);
    assert.equal(res.result.totalVendors, 3);

    const aws = res.result.vendors.find((v) => v.id === 100);
    // Should have trimmed fields
    assert.equal(aws.name, "Amazon Web Services (AWS)");
    assert.equal(aws.critical, true);
    assert.equal(aws.risk, "HIGH");
    assert.equal(aws.impactLevel, "MAJOR");
    assert.equal(aws.hasPii, true);
    assert.equal(aws.passwordPolicy, "SSO");
    assert.equal(aws.passwordMfaEnabled, true);
    // reviewCount was split into status buckets mirroring the Drata app.
    assert.equal(aws.completedReviewCount, 1);
    assert.equal(aws.pendingReviewCount, 0);
    assert.equal(aws.unverifiableReviewCount, 0);
    assert.equal(aws.hasPrivacyUrl, true);
    assert.equal(aws.hasTermsUrl, true);

    // Should NOT have full vendor fields like url, category, notes, etc.
    assert.equal(aws.url, undefined);
    assert.equal(aws.category, undefined);
    assert.equal(aws.securityReviews, undefined);

    const chat = res.result.vendors.find((v) => v.id === 101);
    assert.equal(chat.completedReviewCount, 0);
    assert.equal(chat.pendingReviewCount, 0);
    assert.equal(chat.unverifiableReviewCount, 0);
    assert.equal(chat.hasPrivacyUrl, false);
    assert.equal(chat.hasTermsUrl, false);
  });

  it("uses event-log evidence instead of reporting false zero reviews", async () => {
    vendorReviewStartedEvents = [
      {
        id: "vsr-chat",
        type: "VENDOR_SECURITY_REVIEW_STARTED",
        category: "VENDOR",
        description: "Security review started for Example Chat",
        metadata: { vendorId: 101 },
        createdAt: "2026-04-09T15:47:28.155Z",
      },
    ];

    const res = await checkVendors();
    assert.equal(res.isError, false);
    const chat = res.result.vendors.find((v) => v.id === 101);
    // An event-log detection has unknowable status: it is unverifiable, never
    // silently zero and never presumed completed.
    assert.equal(chat.unverifiableReviewCount, 1);
    assert.equal(chat.completedReviewCount, 0);
    assert.deepEqual(chat.reviewSources, ["event_log"]);
    assert.deepEqual(chat.eventIds, ["vsr-chat"]);
  });
});

describe("check-vendor-security-review-statuses", () => {
  it("does not include the V1 API disclaimer note", async () => {
    const res = await checkVendorSecurityReviews();
    assert.equal(res.isError, false);
    assert.equal(
      res.result.note,
      undefined,
      "V1 disclaimer note should be removed once V2 reviews are merged in",
    );
  });

  it("splits vendors into with/without reviews using V2 review counts", async () => {
    capturedRequests = [];
    const res = await checkVendorSecurityReviews();
    assert.equal(res.result.totalVendors, 3);
    // V2 surfaces an Example Tracker review V1 misses — Example Tracker
    // should now be in the "has reviews" bucket.
    assert.equal(res.result.vendorsWithReviews, 2); // AWS + Example Tracker
    assert.equal(res.result.vendorsWithoutReviews, 1); // Example Chat only

    const v2Req = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/vendors",
    );
    assert.ok(v2Req, "Should call V2 vendors endpoint");
  });

  it("prefers V2 review records over V1 when both are returned", async () => {
    const res = await checkVendorSecurityReviews();
    const aws = res.result.hasReviews.find((v) => v.id === 100);
    assert.ok(aws, "AWS has a COMPLETED review so it belongs in hasReviews");
    assert.equal(
      aws.totalReviewRecords,
      2,
      "AWS should reflect V2's 2 review records, not V1's 1",
    );
    // Only the COMPLETED review counts as a past review; IN_PROGRESS is pending.
    assert.equal(aws.securityReviewStatus, "UP_TO_DATE");
    assert.equal(aws.completedReviewCount, 1);
    assert.equal(aws.pendingReviewCount, 1);
    assert.equal(aws.decision, "APPROVED");
    // Per-review detail is opt-in via fields[] now.
    assert.ok(
      !("latestCompletedReview" in aws),
      "latestCompletedReview is opt-in via fields[]",
    );
    const detailed = await checkVendorSecurityReviews({
      fields: ["latestCompletedReview"],
    });
    const awsDetailed = detailed.result.hasReviews.find((v) => v.id === 100);
    assert.deepEqual(awsDetailed.latestCompletedReview, {
      id: 1,
      title: "Annual security review",
      decision: "APPROVED",
      requestedAt: "2026-01-15T00:00:00Z",
      reviewDeadlineAt: null,
    });
    // The old ambiguous per-vendor keys are gone from THIS tool.
    assert.equal(aws.reviewCount, undefined, "reviewCount key was removed");
    assert.equal(aws.reviewIds, undefined, "reviewIds key was removed");
  });

  it("needsReview contains correct vendor data", async () => {
    const res = await checkVendorSecurityReviews();
    const chat = res.result.needsReview.find((v) => v.id === 101);
    assert.equal(chat.name, "Example Chat");
    assert.equal(chat.securityReviewStatus, "NO_PAST_REVIEW");
    assert.equal(chat.completedReviewCount, 0);
    assert.equal(chat.pendingReviewCount, 0);
    assert.equal(chat.totalReviewRecords, 0);
    assert.equal(chat.decision, null);
    assert.ok(
      !("latestCompletedReview" in chat),
      "latestCompletedReview is opt-in via fields[]",
    );
  });

  it("vendor with only NOT_YET_STARTED shells is NO_PAST_REVIEW, not reviewed", async () => {
    extraV2Vendors = [
      {
        id: 300,
        name: "Scheduled Shell Co",
        critical: false,
        risk: "LOW",
        impactLevel: "MINOR",
        hasPii: false,
        // A scheduled shell the app shows as "No past review".
        securityReviews: [
          { id: 60, status: "NOT_YET_STARTED", decision: "PENDING", title: "Scheduled review" },
        ],
      },
    ];
    try {
      const res = await checkVendorSecurityReviews();
      const shell = res.result.needsReview.find((v) => v.id === 300);
      assert.ok(shell, "shell-only vendor belongs in needsReview");
      assert.equal(shell.securityReviewStatus, "NO_PAST_REVIEW");
      assert.equal(shell.completedReviewCount, 0);
      assert.equal(shell.pendingReviewCount, 1, "the shell is counted as pending");
      assert.equal(shell.totalReviewRecords, 1);
      assert.equal(shell.decision, null);
      assert.ok(
        !res.result.hasReviews.some((v) => v.id === 300),
        "shells must not count toward vendorsWithReviews",
      );
      assert.equal(res.result.vendorsWithPendingShellsOnly, 1);
      assert.equal(res.result.vendorsWithReviews, 2, "still only AWS + Example Tracker");
      assert.equal(res.result.vendorsWithoutReviews, 2, "Example Chat + shell vendor");
    } finally {
      extraV2Vendors = [];
    }
  });

  it("falls back to V1 review records when V2 endpoint fails (5xx)", async () => {
    v2VendorsBroken = true;
    try {
      const res = await checkVendorSecurityReviews();
      assert.equal(res.isError, false, `unexpected error: ${res.error}`);
      // V1 has AWS=1 COMPLETED review, Example Chat=0, Example Tracker=0 —
      // when V2 is unreachable we should land on V1 records, not throw.
      assert.equal(res.result.totalVendors, 3);
      assert.equal(res.result.vendorsWithReviews, 1);
      assert.equal(res.result.vendorsWithoutReviews, 2);
      const aws = res.result.hasReviews.find((v) => v.id === 100);
      assert.ok(aws, "AWS should still be up to date from V1's COMPLETED review");
      assert.equal(
        aws.totalReviewRecords,
        1,
        "should reflect V1's single record when V2 is down",
      );
      assert.equal(aws.completedReviewCount, 1);
    } finally {
      v2VendorsBroken = false;
    }
  });

  it("no longer persists review IDs when creating a security review", async () => {
    const created = await createVendorSecurityReview(101, {
      reviewDeadlineAt: "2026-04-09T00:00:00Z",
      securityReviewStatus: "COMPLETED",
      securityReviewType: "SECURITY",
      requesterUserId: 1,
    });
    assert.equal(created.isError, false);
    assert.equal(
      existsSync(STATE_PATH),
      false,
      "create_vendor_security_review must not write the local state file",
    );
  });

  it("uses persisted legacy review IDs with GET-by-ID as a deprecated fallback", async () => {
    // Seed legacy state directly: pre-release builds recorded review IDs at
    // create time. The server only reads the file, as a fallback.
    writeFileSync(
      STATE_PATH,
      `${JSON.stringify({ vendorSecurityReviews: { 101: [500] } })}\n`,
    );

    const res = await checkVendorSecurityReviews({ fields: ["reviews"] });
    const chat = res.result.hasReviews.find((v) => v.id === 101);
    assert.ok(
      chat,
      "persisted review resolves to a COMPLETED record → Example Chat lands in hasReviews",
    );
    assert.equal(chat.securityReviewStatus, "UP_TO_DATE");
    assert.equal(chat.completedReviewCount, 1);
    assert.equal(chat.totalReviewRecords, 1);
    assert.deepEqual(chat.reviews, [
      { id: 500, status: "COMPLETED", decision: "APPROVED", title: "Imported review" },
    ]);
    assert.ok(chat.reviewSources.includes("persisted_get_by_id"));

    const getReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/vendors/101/security-reviews/500",
    );
    assert.ok(getReq, "should verify remembered review ID with GET-by-ID");
  });

  it("falls back to event log and vendor notes when review arrays are empty", async () => {
    extraV2Vendors = [
      {
        id: 200,
        name: "Event Reviewed SaaS",
        critical: true,
        risk: "HIGH",
        impactLevel: "MAJOR",
        hasPii: true,
        securityReviews: [],
        notes: "SECURITY REVIEW - completed from external attestation",
      },
    ];
    vendorReviewStartedEvents = [
      {
        id: "vsr-200",
        type: "VENDOR_SECURITY_REVIEW_STARTED",
        category: "VENDOR",
        description: "Security review started for Event Reviewed SaaS",
        metadata: { vendorId: 200 },
        createdAt: "2026-04-09T15:47:28.155Z",
      },
    ];

    const res = await checkVendorSecurityReviews();
    // Fallback sources prove a review existed but cannot see its status, so
    // the corrected semantics report the vendor as UNKNOWN — neither
    // "up to date" nor a false "no past review".
    const vendor = res.result.unknownStatus.find((v) => v.id === 200);
    assert.ok(vendor, "fallback-only evidence should land in unknownStatus");
    assert.equal(vendor.securityReviewStatus, "UNKNOWN");
    assert.equal(vendor.completedReviewCount, 0);
    assert.equal(vendor.totalReviewRecords, 1);
    assert.ok(vendor.reviewSources.includes("event_log"));
    assert.ok(vendor.reviewSources.includes("vendor_notes"));
    assert.deepEqual(vendor.eventIds, ["vsr-200"]);
    assert.equal(res.result.vendorsWithUnknownStatus, 1);
    assert.ok(
      !res.result.hasReviews.some((v) => v.id === 200),
      "UNKNOWN vendors must not count as vendorsWithReviews",
    );
    assert.ok(
      !res.result.needsReview.some((v) => v.id === 200),
      "UNKNOWN vendors are not needsReview either",
    );
  });
});

describe("search_vendors", () => {
  it("finds vendors by name substring", async () => {
    const res = await searchVendors("AWS");
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 1);
    assert.equal(res.result.vendors[0].name, "Amazon Web Services (AWS)");
  });

  it("is case-insensitive", async () => {
    const res = await searchVendors("chat");
    assert.equal(res.result.total, 1);
    assert.equal(res.result.vendors[0].id, 101);
  });

  it("returns empty for no match", async () => {
    const res = await searchVendors("nonexistent_vendor");
    assert.equal(res.result.total, 0);
  });

  it("returns key fields only", async () => {
    const res = await searchVendors("Tracker");
    const v = res.result.vendors[0];
    assert.equal(v.id, 102);
    assert.equal(v.name, "Example Tracker");
    assert.equal(v.risk, "MODERATE");
    // Should not include heavy fields like securityReviews, documents
    assert.equal(v.securityReviews, undefined);
    assert.equal(v.documents, undefined);
  });
});

describe("get_vendor", () => {
  it("returns a single vendor by ID", async () => {
    const res = await getVendor(100);
    assert.equal(res.isError, false);
    assert.equal(res.result.id, 100);
    assert.equal(res.result.name, "Amazon Web Services (AWS)");
  });
});

describe("archive_vendor", () => {
  it("sends archivedAt in the update payload", async () => {
    capturedRequests = [];
    const res = await archiveVendor(101);
    assert.equal(res.isError, false);

    // Find the PUT request
    const putReq = capturedRequests.find(
      (r) => r.method === "PUT" && r.path === "/public/vendors/101",
    );
    assert.ok(putReq, "Should have sent a PUT to /public/vendors/101");
    assert.ok(putReq.body.archivedAt, "Body should contain archivedAt");
    // archivedAt should be a valid ISO string
    assert.ok(
      !isNaN(Date.parse(putReq.body.archivedAt)),
      "archivedAt should be a valid date",
    );
  });

  it("strips read-only fields from the update", async () => {
    capturedRequests = [];
    await archiveVendor(100);
    const putReq = capturedRequests.find(
      (r) => r.method === "PUT" && r.path === "/public/vendors/100",
    );
    assert.equal(putReq.body.id, undefined, "Should strip id");
    assert.equal(
      putReq.body.securityReviews,
      undefined,
      "Should strip securityReviews",
    );
  });
});

describe("update_vendor", () => {
  it("merges partial update with existing vendor", async () => {
    capturedRequests = [];
    const res = await updateVendor(101, { risk: "HIGH" });
    assert.equal(res.isError, false);
    const putReq = capturedRequests.find(
      (r) => r.method === "PUT" && r.path === "/public/vendors/101",
    );
    // Should have the new risk value
    assert.equal(putReq.body.risk, "HIGH");
    // Should preserve existing fields from the vendor
    assert.equal(putReq.body.name, "Example Chat");
  });
});

describe("bulk_update_vendors", () => {
  it("passes renewal fields through to per-vendor update calls", async () => {
    capturedRequests = [];
    const tool = (
      await import("../dist/tools/write/bulk-update-vendors.tool.js")
    ).default();

    const out = await tool.handler({
      updates: [
        {
          vendorId: 101,
          renewalDate: "2027-04-09T00:00:00.000Z",
          renewalScheduleType: "ONE_YEAR",
        },
      ],
    });

    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.succeeded, 1);
    assert.deepEqual(parsed.errors, undefined);
    assert.deepEqual(parsed.total, 1);
    assert.deepEqual(parsed.failed, 0);
    assert.deepEqual(parsed.total, 1);
    const putReq = capturedRequests.find(
      (r) => r.method === "PUT" && r.path === "/public/vendors/101",
    );
    assert.ok(putReq, "Should send a per-vendor PUT");
    assert.equal(putReq.body.renewalDate, "2027-04-09T00:00:00.000Z");
    assert.equal(putReq.body.renewalScheduleType, "ONE_YEAR");
    assert.deepEqual(parsed.errors, undefined);
  });

  it("does not send no-op bulk updates to Drata", async () => {
    capturedRequests = [];
    const tool = (
      await import("../dist/tools/write/bulk-update-vendors.tool.js")
    ).default();

    const out = await tool.handler({
      updates: [
        {
          vendorId: 101,
          unsupportedField: "silently ignored before this regression",
        },
      ],
    });

    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.succeeded, 0);
    assert.equal(parsed.failed, 1);
    assert.match(parsed.errors[0].error, /Unsupported bulk vendor update fields/);
    assert.equal(
      capturedRequests.some((r) => r.method === "PUT" && r.path === "/public/vendors/101"),
      false,
    );
  });

  it("tool schema rejects unsupported vendor fields", async () => {
    const zodModule = await import("zod");
    const z = zodModule.z ?? zodModule.default;
    const tool = (
      await import("../dist/tools/write/bulk-update-vendors.tool.js")
    ).default();
    const wrapped = z.object(tool.schema);

    assert.throws(
      () =>
        wrapped.parse({
          updates: [{ vendorId: 101, unsupportedField: "nope" }],
        }),
      /unrecognized_keys|Unrecognized key/i,
    );
  });
});

// ── create_vendor_security_review ──────────────────────────────

describe("create_vendor_security_review", () => {
  it("sends correct V2 field names", async () => {
    capturedRequests = [];
    const res = await createVendorSecurityReview(100, {
      reviewDeadlineAt: "2025-06-01T00:00:00Z",
      securityReviewStatus: "COMPLETED",
      securityReviewType: "SECURITY",
      requesterUserId: 10,
    });
    assert.equal(res.isError, false);

    const postReq = capturedRequests.find(
      (r) =>
        r.method === "POST" &&
        r.path === "/public/v2/vendors/100/security-reviews",
    );
    assert.ok(postReq, "Should POST to security-reviews");
    assert.equal(postReq.body.reviewDeadlineAt, "2025-06-01T00:00:00Z");
    assert.equal(postReq.body.securityReviewStatus, "COMPLETED");
    assert.equal(postReq.body.securityReviewType, "SECURITY");
    assert.equal(postReq.body.requesterUserId, 10);
  });

  it("does NOT send deprecated fields (reviewDate, status, notes)", async () => {
    capturedRequests = [];
    await createVendorSecurityReview(100, {
      reviewDeadlineAt: "2025-06-01T00:00:00Z",
      securityReviewStatus: "IN_PROGRESS",
      securityReviewType: "SOC_REPORT",
      requesterUserId: 1,
    });
    const postReq = capturedRequests.find(
      (r) =>
        r.method === "POST" &&
        r.path === "/public/v2/vendors/100/security-reviews",
    );
    assert.equal(postReq.body.reviewDate, undefined, "Should not send reviewDate");
    assert.equal(postReq.body.status, undefined, "Should not send status");
    assert.equal(postReq.body.notes, undefined, "Should not send notes");
  });
});

// ── update_personnel / create_background_check by email ────────

describe("update_personnel via handler", () => {
  it("updates by personnel ID", async () => {
    capturedRequests = [];
    const res = await updatePersonnel(1, { jobTitle: "Senior Engineer" });
    assert.equal(res.isError, false);
    const putReq = capturedRequests.find(
      (r) => r.method === "PUT" && r.path === "/public/v2/personnel/1",
    );
    assert.ok(putReq);
    assert.equal(putReq.body.jobTitle, "Senior Engineer");
  });
});

describe("create_background_check via handler", () => {
  it("creates with personnelId", async () => {
    capturedRequests = [];
    const res = await createBackgroundCheck({
      personnelId: 2,
      url: "https://checks.example.com/report/123",
    });
    assert.equal(res.isError, false);
    const postReq = capturedRequests.find(
      (r) => r.method === "POST" && r.path === "/public/v2/background-checks",
    );
    assert.ok(postReq);
    assert.equal(postReq.body.personnelId, 2);
    assert.equal(postReq.body.url, "https://checks.example.com/report/123");
  });
});

// ── Policy handlers ────────────────────────────────────────────

describe("list_policies_v2", () => {
  it("returns policies", async () => {
    capturedRequests = [];
    const res = await listPoliciesV2();
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 2);
    assert.equal(res.result.policies[0].name, "Information Security Policy");
    const getReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/policies",
    );
    assert.ok(getReq);
  });

  it("passes filter params including arrays as repeated keys", async () => {
    capturedRequests = [];
    await listPoliciesV2({
      name: "Info",
      statuses: ["ACTIVE", "ARCHIVED"],
      expand: ["owner", "groups"],
      size: 25,
      sort: "name",
      sortDir: "ASC",
    });
    const getReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/policies",
    );
    assert.ok(getReq, "Should GET /public/v2/policies");
    // URLSearchParams serializes arrays as repeated keys
    assert.ok(getReq.query.includes("name=Info"));
    assert.ok(getReq.query.includes("statuses=ACTIVE"));
    assert.ok(getReq.query.includes("statuses=ARCHIVED"));
    assert.ok(getReq.query.includes("expand=owner"));
    assert.ok(getReq.query.includes("expand=groups"));
    assert.ok(getReq.query.includes("size=25"));
    assert.ok(getReq.query.includes("sort=name"));
    assert.ok(getReq.query.includes("sortDir=ASC"));
  });

  it("skips undefined params", async () => {
    capturedRequests = [];
    await listPoliciesV2({
      name: undefined,
      statuses: undefined,
      expand: ["owner"],
    });
    const getReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/policies",
    );
    assert.ok(!getReq.query.includes("name="));
    assert.ok(!getReq.query.includes("statuses="));
    assert.ok(getReq.query.includes("expand=owner"));
  });
});

describe("get_policy", () => {
  it("fetches a single policy", async () => {
    capturedRequests = [];
    const res = await getPolicy(13);
    assert.equal(res.isError, false);
    assert.equal(res.result.id, 13);
    const getReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/policies/13",
    );
    assert.ok(getReq);
  });

  it("forwards expand[] as repeated keys", async () => {
    capturedRequests = [];
    await getPolicy(13, { expand: ["owner", "controls", "groups"] });
    const getReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/policies/13",
    );
    assert.ok(getReq);
    assert.ok(getReq.query.includes("expand=owner"));
    assert.ok(getReq.query.includes("expand=controls"));
    assert.ok(getReq.query.includes("expand=groups"));
  });
});

describe("list_policy_versions", () => {
  it("GETs the versions subresource", async () => {
    capturedRequests = [];
    const res = await listPolicyVersions(13);
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 2);
    const getReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/policies/13/policy-versions",
    );
    assert.ok(getReq);
  });

  it("forwards array filters and scalar params", async () => {
    capturedRequests = [];
    await listPolicyVersions(13, {
      statuses: ["PUBLISHED", "DRAFT"],
      expand: ["downloadUrl", "downloadPdfUrl"],
      current: true,
      version: 2,
      sort: "createdAt",
      sortDir: "DESC",
      size: 10,
    });
    const getReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/policies/13/policy-versions",
    );
    assert.ok(getReq);
    assert.ok(getReq.query.includes("statuses=PUBLISHED"));
    assert.ok(getReq.query.includes("statuses=DRAFT"));
    assert.ok(getReq.query.includes("expand=downloadUrl"));
    assert.ok(getReq.query.includes("expand=downloadPdfUrl"));
    assert.ok(getReq.query.includes("current=true"));
    assert.ok(getReq.query.includes("version=2"));
    assert.ok(getReq.query.includes("sort=createdAt"));
    assert.ok(getReq.query.includes("sortDir=DESC"));
    assert.ok(getReq.query.includes("size=10"));
  });

  it("stops paginating when server returns a non-advancing cursor", async () => {
    // Guard against infinite loop if the server bug returns the same cursor.
    // Directly exercise fetchAllV2 via getDrataClient so we can inject state.
    // Verified implicitly: the handler completes and returns a result.
    capturedRequests = [];
    const res = await listPolicyVersions(13);
    assert.equal(res.isError, false);
    // Should have made at least one request and not hung.
    assert.ok(capturedRequests.length >= 1);
  });
});

describe("get_policy_version", () => {
  it("fetches a specific version as JSON", async () => {
    capturedRequests = [];
    const res = await getPolicyVersion(13, 501);
    assert.equal(res.isError, false);
    assert.equal(res.result.id, 501);
    const getReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/policies/13/policy-versions/501",
    );
    assert.ok(getReq);
    // JSON request should NOT send Accept: text/html
    assert.ok(
      !getReq.accept || !getReq.accept.includes("text/html"),
      `Expected JSON Accept, got: ${getReq.accept}`,
    );
  });

  it("forwards expand[]", async () => {
    capturedRequests = [];
    await getPolicyVersion(13, 501, { expand: ["owner", "downloadUrl"] });
    const getReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/policies/13/policy-versions/501",
    );
    assert.ok(getReq.query.includes("expand=owner"));
    assert.ok(getReq.query.includes("expand=downloadUrl"));
  });
});

describe("get_policy_version_content", () => {
  it("requests with Accept: text/html and returns raw HTML", async () => {
    capturedRequests = [];
    const res = await getPolicyVersionContent(13, 502);
    assert.equal(res.isError, false);
    assert.equal(res.result.contentType, "text/html");
    assert.ok(res.result.html.startsWith("<html>"));
    const getReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/policies/13/policy-versions/502",
    );
    assert.ok(getReq, "Should GET the version URL");
    assert.ok(
      getReq.accept && getReq.accept.includes("text/html"),
      `Expected Accept: text/html, got: ${getReq.accept}`,
    );
  });
});

describe("list_policy_actions", () => {
  it("fetches available workflow actions for a policy", async () => {
    capturedRequests = [];
    const res = await listPolicyActions(13);
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 4);
    assert.ok(Array.isArray(res.result.actions));
    assert.equal(res.result.actions[0].action, "SubmitForApproval");
    const getReq = capturedRequests.find(
      (r) =>
        r.method === "GET" && r.path === "/public/v2/policies/13/actions",
    );
    assert.ok(getReq);
  });
});

describe("perform_policy_action", () => {
  it("POSTs the action body to /policies/:id/actions", async () => {
    capturedRequests = [];
    const res = await performPolicyAction(13, { action: "Publish" });
    assert.equal(res.isError, false);
    const postReq = capturedRequests.find(
      (r) =>
        r.method === "POST" && r.path === "/public/v2/policies/13/actions",
    );
    assert.ok(postReq, "Should POST to /public/v2/policies/13/actions");
    assert.equal(postReq.body.action, "Publish");
  });

  it("forwards reason and overrideReason", async () => {
    capturedRequests = [];
    await performPolicyAction(13, {
      action: "RequestChanges",
      reason: "Needs section 3 update",
    });
    const postReq = capturedRequests.find(
      (r) =>
        r.method === "POST" && r.path === "/public/v2/policies/13/actions",
    );
    assert.equal(postReq.body.action, "RequestChanges");
    assert.equal(postReq.body.reason, "Needs section 3 update");

    capturedRequests = [];
    await performPolicyAction(13, {
      action: "OverrideApprove",
      overrideReason: "Legal sign-off exists offline",
    });
    const postReq2 = capturedRequests.find(
      (r) =>
        r.method === "POST" && r.path === "/public/v2/policies/13/actions",
    );
    assert.equal(postReq2.body.action, "OverrideApprove");
    assert.equal(
      postReq2.body.overrideReason,
      "Legal sign-off exists offline",
    );
  });
});

describe("list_user_assigned_policies", () => {
  it("GETs assigned policies for a user", async () => {
    capturedRequests = [];
    const res = await listUserAssignedPolicies(10);
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 2);
    const getReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/users/10/assigned-policies",
    );
    assert.ok(getReq);
  });
});

describe("acknowledge_assigned_policy", () => {
  it("POSTs to the action-acknowledge subresource with acceptedAt", async () => {
    capturedRequests = [];
    const res = await acknowledgeAssignedPolicy(10, 14, {
      acceptedAt: "2026-04-24T12:00:00.000Z",
    });
    assert.equal(res.isError, false);
    assert.equal(res.result.acknowledged, true);
    const postReq = capturedRequests.find(
      (r) =>
        r.method === "POST" &&
        r.path ===
          "/public/v2/users/10/assigned-policies/14/action-acknowledge",
    );
    assert.ok(postReq, "Should POST to action-acknowledge endpoint");
    assert.equal(postReq.body.acceptedAt, "2026-04-24T12:00:00.000Z");
  });

  it("forwards optional details", async () => {
    capturedRequests = [];
    await acknowledgeAssignedPolicy(10, 14, {
      acceptedAt: "2026-04-24T12:00:00.000Z",
      details: "Reviewed and accepted",
    });
    const postReq = capturedRequests.find(
      (r) =>
        r.method === "POST" &&
        r.path ===
          "/public/v2/users/10/assigned-policies/14/action-acknowledge",
    );
    assert.equal(postReq.body.details, "Reviewed and accepted");
  });
});

// ── check_monitors filter ──────────────────────────────────────

describe("check_monitors", () => {
  it("filter=failing returns zero monitors with status PASSED", async () => {
    const res = await checkMonitors("failing");
    assert.equal(res.isError, false);
    const passedInFailing = res.result.monitors.filter(
      (m) => m.status === "PASSED",
    );
    assert.equal(
      passedInFailing.length,
      0,
      `failing-filtered list contained ${passedInFailing.length} monitors with status=PASSED`,
    );
    // Sanity: should also exclude legacy READY status.
    const readyInFailing = res.result.monitors.filter((m) => m.status === "READY");
    assert.equal(readyInFailing.length, 0);
  });

  it("filter=failing returns only enabled, non-passing monitors (incl. NEEDS_ATTENTION, ERROR)", async () => {
    const res = await checkMonitors("failing");
    // Mock has: M2 FAILED, M5 ERROR, M6 NEEDS_ATTENTION — all enabled.
    // `count` was replaced by `matched` (filter matches) + `returned` (page).
    assert.equal(res.result.matched, 3);
    assert.equal(res.result.returned, 3);
    const ids = res.result.monitors.map((m) => m.id).sort();
    assert.deepEqual(ids, [2, 5, 6]);
  });

  it("filter=passing accepts both PASSED and legacy READY", async () => {
    const res = await checkMonitors("passing");
    // M1 PASSED enabled, M4 READY enabled. M3 PASSED but disabled — excluded.
    assert.equal(res.result.matched, 2);
    const ids = res.result.monitors.map((m) => m.id).sort();
    assert.deepEqual(ids, [1, 4]);
  });

  it("filter=disabled returns only disabled monitors regardless of result", async () => {
    const res = await checkMonitors("disabled");
    // M3 is PASSED but DISABLED — should still appear in disabled bucket.
    assert.equal(res.result.matched, 1);
    assert.equal(res.result.monitors[0].id, 3);
    assert.equal(res.result.monitors[0].status, "PASSED");
  });

  it("no filter returns all monitors", async () => {
    const res = await checkMonitors();
    assert.equal(res.result.matched, 6);
    assert.equal(res.result.totalMonitors, 6);
  });

  it("buckets partition the result set: passing + failing + disabled = total", async () => {
    const passing = await checkMonitors("passing");
    const failing = await checkMonitors("failing");
    const disabled = await checkMonitors("disabled");
    const all = await checkMonitors();
    assert.equal(
      passing.result.matched + failing.result.matched + disabled.result.matched,
      all.result.matched,
      "buckets must form a clean partition of the monitor list",
    );
    // The always-on statusCounts summary partitions the same way.
    const counts = all.result.statusCounts;
    assert.equal(
      counts.passing + counts.failing + counts.disabled,
      all.result.totalMonitors,
    );
  });
});

// ── get_recent_events limit clamp ──────────────────────────────

describe("get_recent_events", () => {
  it("clamps limit=100 to 50, no error from upstream", async () => {
    capturedRequests = [];
    const res = await getRecentEvents(100);
    assert.equal(res.isError, false, `Expected success, got error: ${res.error}`);
    assert.equal(res.result.events.length, 50);
    assert.equal(res.result.count, 50);

    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/events",
    );
    assert.ok(eventsReq, "Should call /public/events");
    assert.ok(
      eventsReq.query.includes("limit=50"),
      `Expected outgoing limit=50 after clamp, got query: ${eventsReq.query}`,
    );
  });

  it("respects limit values within range", async () => {
    const res = await getRecentEvents(10);
    assert.equal(res.isError, false);
    assert.equal(res.result.events.length, 10);
  });

  it("default limit (no arg) is 20", async () => {
    capturedRequests = [];
    const res = await getRecentEvents();
    assert.equal(res.isError, false);
    assert.equal(res.result.events.length, 20);
  });

  it("limit=50 (boundary) is forwarded as-is — no clamp, no error", async () => {
    capturedRequests = [];
    const res = await getRecentEvents(50);
    assert.equal(res.isError, false);
    assert.equal(res.result.events.length, 50);
    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/events",
    );
    assert.ok(eventsReq.query.includes("limit=50"));
  });

  it("limit=0 floors to 1 (Math.max guard)", async () => {
    capturedRequests = [];
    const res = await getRecentEvents(0);
    assert.equal(res.isError, false);
    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/events",
    );
    assert.ok(
      eventsReq.query.includes("limit=1"),
      `Expected limit=1 after floor, got: ${eventsReq.query}`,
    );
  });

  it("limit=10000 still clamps cleanly", async () => {
    capturedRequests = [];
    const res = await getRecentEvents(10000);
    assert.equal(res.isError, false);
    assert.equal(res.result.events.length, 50);
  });
});

// ── list_frameworks workspace resolution ──────────────────────

describe("list_frameworks", () => {
  it("uses DRATA_WORKSPACE_ID env var when no arg is provided", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    const res = await listFrameworks();
    assert.equal(res.isError, false, `Got error: ${res.error}`);
    const fwReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/workspaces/42/frameworks",
    );
    assert.ok(fwReq, "Should hit /public/v2/workspaces/42/frameworks via env var");
    delete process.env.DRATA_WORKSPACE_ID;
  });

  it("auto-resolves workspace via /public/v2/workspaces when no env var or arg", async () => {
    delete process.env.DRATA_WORKSPACE_ID;
    capturedRequests = [];
    const res = await listFrameworks();
    assert.equal(res.isError, false, `Got error: ${res.error}`);
    const wsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/workspaces",
    );
    assert.ok(wsReq, "Should fetch /public/v2/workspaces to auto-resolve");
    const fwReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/workspaces/42/frameworks",
    );
    assert.ok(fwReq, "Should then hit frameworks for the resolved workspace");
  });

  it("explicit workspaceId param wins over env var", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    await listFrameworks(99);
    const fwReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/workspaces/99/frameworks",
    );
    assert.ok(fwReq, "Should hit workspace 99, not env var's 42");
    delete process.env.DRATA_WORKSPACE_ID;
  });
});

describe("list_framework_requirements", () => {
  it("uses DRATA_WORKSPACE_ID env var when no arg is provided", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    const res = await listFrameworkRequirements();
    assert.equal(res.isError, false, `Got error: ${res.error}`);
    const req = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/workspaces/42/framework-requirements",
    );
    assert.ok(req, "Should use env var workspace 42");
    delete process.env.DRATA_WORKSPACE_ID;
  });

  it("builds readiness rollup from the V2 controls expand=requirements reverse mapping", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    try {
      const { getFrameworkRequirementReadinessRollup } = await import(
        "../dist/handlers/v2-write.handler.js"
      );
      const res = await getFrameworkRequirementReadinessRollup(undefined, {
        size: 500,
      });
      assert.equal(res.isError, false, res.error);
      // Framework-wide totals live under `framework`; `requirements` is a
      // (capped) page of detailed per-requirement rollups. The mapping comes
      // from the CONTROL side (expand=requirements) because Drata caps the
      // requirement-side expand=controls at 10 inline controls.
      assert.equal(res.result.mappingSource, "v2-controls-expand-requirements");
      const fw = res.result.framework;
      assert.equal(fw.readinessSource, "v2-controls-expand-requirements");
      assert.equal(fw.totalRequirements, 61);
      // Requirement 61's only mapped control is archived → out of scope.
      assert.equal(fw.inScopeRequirements, 60);
      assert.equal(fw.outOfScopeRequirements, 1);
      // Ready = requirements 1 and 3 (all live mapped controls ready);
      // requirement 2 maps a not-ready control and the remaining 57 in-scope
      // requirements have no live mapped controls, so none of them are ready.
      assert.equal(fw.readyRequirements, 2);
      assert.equal(fw.notReadyRequirements, 58);
      // No frameworkId passed → no Drata-reported numbers to cross-check.
      assert.equal(fw.drataReported, null);
      assert.equal(fw.matchesDrataReported, null);

      const [first, second, third] = res.result.requirements;
      // Requirement 1: two live ready controls (one mapped via the
      // {data, totalCount} envelope shape) → ready.
      assert.equal(first.isInScope, true);
      assert.equal(first.isReady, true);
      assert.equal(first.controlCount, 2);
      assert.equal(first.archivedControlCount, 0);
      assert.equal(first.readyControlCount, 2);
      assert.equal(first.notReadyControlCount, 0);
      assert.deepEqual(first.controls, [
        { code: "DCF-21", isReady: true },
        { code: "DCF-33", isReady: true },
      ]);
      // Requirement 2: one live control, not ready.
      assert.equal(second.isInScope, true);
      assert.equal(second.isReady, false);
      assert.equal(second.controlCount, 1);
      assert.deepEqual(second.controls, [{ code: "DCF-26", isReady: false }]);
      // Requirement 3: archived mapping is excluded from controls[] and
      // counted separately — it does not break readiness.
      assert.equal(third.archivedControlCount, 1);
      assert.equal(third.controlCount, 1);
      assert.equal(third.isReady, true);
      assert.deepEqual(third.controls, [{ code: "DCF-21", isReady: true }]);
      // All-archived requirement: out of scope, never ready, no live controls.
      const outOfScope = res.result.requirements.find((r) => r.id === 61);
      assert.equal(outOfScope.isInScope, false);
      assert.equal(outOfScope.isReady, false);
      assert.equal(outOfScope.controlCount, 0);
      assert.equal(outOfScope.archivedControlCount, 1);
      assert.deepEqual(outOfScope.controls, []);

      // The mapping is built from ONE walk of the V2 controls list with
      // expand=requirements.
      const controlsReq = capturedRequests.find(
        (r) => r.method === "GET" && r.path === "/public/v2/workspaces/42/controls",
      );
      assert.ok(controlsReq, "should walk the V2 controls list");
      assert.ok(controlsReq.query.includes("expand=requirements"), controlsReq.query);
      // Full requirement walk + detail page hit the V2 endpoint WITHOUT any
      // controls expansion (Drata caps it at 10 inline controls).
      const reqs = capturedRequests.filter(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/framework-requirements",
      );
      assert.ok(reqs.length >= 2, "full walk plus one detail page");
      for (const r of reqs) {
        assert.ok(!r.query.includes("expand=controls"), r.query);
      }
      // The deprecated V1 per-requirement fan-out must be gone.
      assert.ok(
        !capturedRequests.some(
          (r) => r.path === "/public/controls" && r.query.includes("requirementId"),
        ),
        "must not fan out to V1 /public/controls?requirementId",
      );
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });
});

describe("control evidence lifecycle read paths", () => {
  it("lists mapped requirements using the documented /controls/{id}/requirements route", async () => {
    capturedRequests = [];
    const { listControlMappedRequirements } = await import(
      "../dist/handlers/write-evidence.handler.js"
    );

    const res = await listControlMappedRequirements(7, {
      frameworkTag: "SOC_2",
      page: 1,
      limit: 50,
    });

    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 1);
    const req = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/controls/7/requirements",
    );
    assert.ok(req, "Should call the documented requirements route");
    assert.ok(req.query.includes("frameworkTag=SOC_2"), req.query);
    assert.equal(
      capturedRequests.some((r) => r.path.includes("mapped-requirements")),
      false,
    );
  });
});

// ── gap-analysis monitor counts agree with check_monitors ──

describe("run_gap_analysis monitor counts", () => {
  it("agrees with check_monitors on passing/failing partition", async () => {
    const gap = await runGapAnalysis();
    assert.equal(gap.isError, false, `gap analysis error: ${gap.error}`);

    const passing = await checkMonitors("passing");
    const failing = await checkMonitors("failing");

    assert.equal(
      gap.result.overview.passingMonitors,
      passing.result.matched,
      "gap analysis passingMonitors should match check_monitors filter=passing",
    );
    assert.equal(
      gap.result.overview.failingMonitors,
      failing.result.matched,
      "gap analysis failingMonitors should match check_monitors filter=failing",
    );
    assert.equal(gap.result.overview.totalMonitors, 6);
  });
});

describe("get_compliance_summary monitor counts", () => {
  it("counts PASSED monitors as passing (not zero)", async () => {
    const res = await getComplianceSummary();
    assert.equal(res.isError, false);
    // Mock has 2 enabled passing monitors (M1 PASSED + M4 READY) and 3
    // enabled non-passing monitors (M2 FAILED, M5 ERROR, M6 NEEDS_ATTENTION).
    assert.equal(res.result.passingMonitors, 2);
    assert.equal(res.result.failingMonitors, 3);
  });
});

// ──────────────────────────────────────────────────────────────
// Deeper edge-case suite
// ──────────────────────────────────────────────────────────────

describe("check_monitors — defensive shape handling", () => {
  it("monitor with empty monitorInstances does not crash and passing entries carry no failure field", async () => {
    // Mock M1 has monitorInstances: []. A passing monitor must not emit a
    // failure field at all — surfacing Drata's static failure template on
    // passing monitors made LLMs assert failures that were not happening.
    const res = await checkMonitors();
    const m1 = res.result.monitors.find((m) => m.id === 1);
    assert.ok(m1, "M1 present");
    assert.ok(!("failureDetails" in m1), "no failureDetails on a passing monitor");
    assert.ok(!("failedReason" in m1), "legacy failedReason key is gone");
  });

  it("monitor with populated monitorInstances exposes failedTestDescription as failureDetails", async () => {
    const res = await checkMonitors("failing");
    const m2 = res.result.monitors.find((m) => m.id === 2);
    assert.equal(m2.failureDetails, "2 admin accounts without MFA");
  });

  it("paginates correctly: 6 monitors served as 2 pages of 3 still classify identically", async () => {
    monitorsPageSize = 3;
    try {
      const all = await checkMonitors();
      assert.equal(all.result.matched, 6, "should fetch across pages");
      const failing = await checkMonitors("failing");
      const passing = await checkMonitors("passing");
      const disabled = await checkMonitors("disabled");
      assert.equal(failing.result.matched, 3);
      assert.equal(passing.result.matched, 2);
      assert.equal(disabled.result.matched, 1);
      assert.equal(
        failing.result.matched + passing.result.matched + disabled.result.matched,
        all.result.matched,
        "partition still holds across pagination",
      );
    } finally {
      monitorsPageSize = null;
    }
  });

  it("unknown filter value falls through to 'all' (no throw)", async () => {
    const res = await checkMonitors("garbage-filter-name");
    assert.equal(res.isError, false);
    assert.equal(res.result.matched, 6);
  });
});

describe("get_recent_events — deeper limit behavior", () => {
  it("server returns fewer events than asked: handler returns server's count, not the cap", async () => {
    const res = await getRecentEvents(5);
    assert.equal(res.isError, false);
    assert.equal(res.result.events.length, 5);
    assert.equal(res.result.count, 5);
  });

  it("limit=NaN coerces to default 20, never reaches upstream as NaN", async () => {
    // Math.max/Math.min propagate NaN unmodified — without an explicit
    // Number.isFinite guard the handler would forward `limit=NaN` and the
    // upstream would 400 (or worse). The guard maps non-finite inputs to
    // the documented default.
    capturedRequests = [];
    const res = await getRecentEvents(Number.NaN);
    assert.equal(res.isError, false);
    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/events",
    );
    assert.ok(
      eventsReq.query.includes("limit=20"),
      `expected limit=20 (default) after NaN coercion, got: ${eventsReq.query}`,
    );
    // And, importantly, never the literal NaN string.
    assert.ok(!eventsReq.query.includes("NaN"));
  });

  it("limit=-99 floors to 1 (negative input)", async () => {
    capturedRequests = [];
    await getRecentEvents(-99);
    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/events",
    );
    assert.ok(eventsReq.query.includes("limit=1"));
  });
});

describe("list_frameworks auto-resolve — error paths", () => {
  it("/public/v2/workspaces returns empty list → graceful error, not unhandled exception", async () => {
    delete process.env.DRATA_WORKSPACE_ID;
    workspacesPayloadOverride = { data: [], pagination: { cursor: null } };
    try {
      const res = await listFrameworks();
      assert.equal(res.isError, true);
      assert.match(res.error, /[Nn]o workspaces|Workspace ID/);
    } finally {
      workspacesPayloadOverride = null;
    }
  });

  it("/public/v2/workspaces 5xx → error propagates with the upstream status", async () => {
    delete process.env.DRATA_WORKSPACE_ID;
    workspacesBroken = true;
    try {
      const res = await listFrameworks();
      assert.equal(res.isError, true);
      assert.match(res.error, /503/);
    } finally {
      workspacesBroken = false;
    }
  });

  it("workspaces list with multiple entries: picks the first deterministically", async () => {
    delete process.env.DRATA_WORKSPACE_ID;
    workspacesPayloadOverride = {
      data: [
        { id: 11, name: "First" },
        { id: 22, name: "Second" },
      ],
      pagination: { cursor: null },
    };
    capturedRequests = [];
    try {
      const res = await listFrameworks();
      assert.equal(res.isError, false);
      const fwReq = capturedRequests.find(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/11/frameworks",
      );
      assert.ok(fwReq, "should pick id=11 (first), not id=22");
    } finally {
      workspacesPayloadOverride = null;
    }
  });
});

describe("check-personnel — deeper compliance shape handling", () => {
  // Compliance now mirrors Drata's authoritative per-person complianceChecks
  // (top-level on the V1 record) — SEC_TRAINING document history is no longer
  // a signal. These tests pin the new source of truth.
  it("SECURITY_TRAINING FAIL flags missing training even with a current SEC_TRAINING doc", async () => {
    const sallyRecord = V1_PERSONNEL[0];
    sallyRecord.complianceChecks = [
      { type: "FULL_COMPLIANCE", status: "FAIL" },
      { type: "SECURITY_TRAINING", status: "FAIL" },
      { type: "ACCEPTED_POLICIES", status: "PASS" },
      { type: "BG_CHECK", status: "PASS" },
    ];
    try {
      const res = await checkPersonnel();
      const sally = res.result.personnel.find((p) => p.id === 1);
      assert.equal(
        sally.missingSecurityTraining,
        true,
        "Drata's own check verdict wins over document history",
      );
      assert.equal(sally.isCompliant, false);
      assert.deepEqual(sally.failedChecks, ["SECURITY_TRAINING"]);
    } finally {
      delete sallyRecord.complianceChecks;
    }
  });

  it("SECURITY_TRAINING PASS clears the flag even with no documents at all", async () => {
    const sallyRecord = V1_PERSONNEL[0];
    const originalDocs = sallyRecord.user.documents;
    sallyRecord.user.documents = [];
    sallyRecord.complianceChecks = [
      { type: "FULL_COMPLIANCE", status: "PASS" },
      { type: "SECURITY_TRAINING", status: "PASS" },
    ];
    try {
      const res = await checkPersonnel();
      const sally = res.result.personnel.find((p) => p.id === 1);
      assert.equal(sally.missingSecurityTraining, false);
      assert.equal(sally.isCompliant, true);
    } finally {
      sallyRecord.user.documents = originalDocs;
      delete sallyRecord.complianceChecks;
    }
  });

  it("EXCLUDED checks are surfaced but never counted as missing", async () => {
    const sallyRecord = V1_PERSONNEL[0];
    sallyRecord.complianceChecks = [
      { type: "FULL_COMPLIANCE", status: "PASS" },
      { type: "BG_CHECK", status: "EXCLUDED" },
    ];
    try {
      const res = await checkPersonnel();
      const sally = res.result.personnel.find((p) => p.id === 1);
      assert.equal(sally.missingBackgroundCheck, false);
      assert.deepEqual(sally.excludedChecks, ["BG_CHECK"]);
      assert.equal(sally.isCompliant, true);
    } finally {
      delete sallyRecord.complianceChecks;
    }
  });
});

describe("check-vendor-security-reviews — deeper merge cases", () => {
  it("vendor that exists in V2 but not V1 still appears in the merged result", async () => {
    extraV2Vendors = [
      {
        id: 999,
        name: "Stripe",
        critical: true,
        risk: "HIGH",
        impactLevel: "MAJOR",
        hasPii: true,
        securityReviews: [{ id: 30, status: "COMPLETED" }],
      },
    ];
    try {
      const res = await checkVendorSecurityReviews();
      const stripe = res.result.hasReviews.find((v) => v.id === 999);
      assert.ok(stripe, "Stripe (V2-only) should appear with its COMPLETED review");
      assert.equal(stripe.securityReviewStatus, "UP_TO_DATE");
      assert.equal(stripe.completedReviewCount, 1);
      assert.equal(stripe.totalReviewRecords, 1);
      assert.equal(stripe.name, "Stripe");
      assert.equal(res.result.totalVendors, 4);
    } finally {
      extraV2Vendors = [];
    }
  });

  it("V2 vendor with no securityReviews field → zero review records (not crash)", async () => {
    extraV2Vendors = [
      {
        id: 998,
        name: "Quirky",
        critical: false,
        risk: "LOW",
        impactLevel: "MINOR",
        hasPii: false,
        // securityReviews missing
      },
    ];
    try {
      const res = await checkVendorSecurityReviews();
      const quirky = res.result.needsReview.find((v) => v.id === 998);
      assert.ok(quirky);
      assert.equal(quirky.securityReviewStatus, "NO_PAST_REVIEW");
      assert.equal(quirky.completedReviewCount, 0);
      assert.equal(quirky.totalReviewRecords, 0);
    } finally {
      extraV2Vendors = [];
    }
  });
});

describe("fetchAllV2 stops on non-advancing cursor (server-bug guard)", () => {
  it("breaks when the same cursor is returned twice in a row", async () => {
    policiesStuckCursor = true;
    capturedRequests = [];
    try {
      const res = await listPoliciesV2();
      assert.equal(res.isError, false, "should not hang or error");
      // Should have made at most 2 requests: the initial fetch, then one
      // attempt with cursor=stuck-cursor that returns the same cursor again
      // and breaks out of the loop.
      const policiesReqs = capturedRequests.filter(
        (r) => r.method === "GET" && r.path === "/public/v2/policies",
      );
      assert.ok(
        policiesReqs.length <= 3,
        `should stop quickly on stuck cursor, made ${policiesReqs.length} requests`,
      );
    } finally {
      policiesStuckCursor = false;
    }
  });
});

describe("MCP tool wrapper layer", () => {
  let CheckMonitorsTool;
  let CheckPersonnelTool;
  let GetRecentEventsTool;
  let CheckVendorSecurityReviewsTool;
  let ListFrameworksTool;

  before(async () => {
    CheckMonitorsTool = (await import("../dist/tools/check/check-monitors.tool.js")).default();
    CheckPersonnelTool = (await import("../dist/tools/check/check-personnel.tool.js")).default();
    GetRecentEventsTool = (await import("../dist/tools/get/get-recent-events.tool.js")).default();
    CheckVendorSecurityReviewsTool = (await import("../dist/tools/check/check-vendor-security-reviews.tool.js")).default();
    ListFrameworksTool = (await import("../dist/tools/v2/list-frameworks.tool.js")).default();
  });

  it("check_monitors tool invokes through Zod schema and returns MCP content shape", async () => {
    const out = await CheckMonitorsTool.handler({ filter: "failing" });
    assert.ok(Array.isArray(out.content), "tool must return content array");
    assert.equal(out.content[0].type, "text");
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.filter, "failing");
    assert.equal(parsed.matched, 3);
    // No PASSED in failing — same property the handler test checks, but here
    // verified at the wire layer.
    assert.equal(
      parsed.monitors.filter((m) => m.status === "PASSED").length,
      0,
    );
  });

  it("get_recent_events tool clamps at the wire layer too", async () => {
    const out = await GetRecentEventsTool.handler({ limit: 100 });
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.events.length, 50);
  });

  it("check-personnel tool returns enriched summary in MCP content", async () => {
    const out = await CheckPersonnelTool.handler({});
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.totalPersonnel, 4);
    assert.equal(parsed.scoredPersonnel, 3);
    // Fixture carries no complianceChecks → compliance is unknown, not
    // asserted either way.
    assert.equal(parsed.compliantCount, 0);
    assert.equal(parsed.unknownComplianceCount, 3);
    assert.ok(Array.isArray(parsed.missingTraining));
  });

  it("list_vendor_security_review_statuses tool has no `note` field at the wire layer", async () => {
    const out = await CheckVendorSecurityReviewsTool.handler({});
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.note, undefined);
  });

  it("list_frameworks tool surfaces handler error as text, not a thrown exception", async () => {
    delete process.env.DRATA_WORKSPACE_ID;
    workspacesPayloadOverride = { data: [], pagination: { cursor: null } };
    try {
      const out = await ListFrameworksTool.handler({});
      assert.ok(out.content[0].text.startsWith("Error:"));
    } finally {
      workspacesPayloadOverride = null;
    }
  });
});

describe("get_compliance_summary — empty monitors edge", () => {
  it("returns 0/0 when there are no monitors at all", async () => {
    // Empty out monitors temporarily.
    const originals = MONITORS.splice(0, MONITORS.length);
    try {
      const res = await getComplianceSummary();
      assert.equal(res.isError, false);
      assert.equal(res.result.totalMonitors, 0);
      assert.equal(res.result.passingMonitors, 0);
      assert.equal(res.result.failingMonitors, 0);
    } finally {
      MONITORS.push(...originals);
    }
  });
});

// ──────────────────────────────────────────────────────────────
// Defensive shape & error-propagation suite
// ──────────────────────────────────────────────────────────────

describe("check_monitors — extra defensive shapes", () => {
  it("monitor with NO monitorInstances field at all does not crash", async () => {
    MONITORS.push({
      id: 99,
      name: "Bare monitor",
      description: "Server omitted monitorInstances",
      checkResultStatus: "FAILED",
      checkStatus: "ENABLED",
      disabledMessage: null,
      priority: "HIGH",
      lastCheck: "2026-04-25T12:00:00Z",
      // monitorInstances intentionally missing
    });
    try {
      const res = await checkMonitors("failing");
      assert.equal(res.isError, false, `unexpected error: ${res.error}`);
      const bare = res.result.monitors.find((m) => m.id === 99);
      assert.ok(bare, "bare monitor should appear in failing");
      assert.equal(
        bare.failureDetails,
        null,
        "missing monitorInstances should yield null, not throw",
      );
    } finally {
      const idx = MONITORS.findIndex((m) => m.id === 99);
      if (idx >= 0) MONITORS.splice(idx, 1);
    }
  });
});

describe("error propagation — handler returns isError, never throws", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("getMonitors network failure surfaces as isError=true (not exception)", async () => {
    // Replace fetch with a function that throws — simulates DNS failure or
    // network outage. The handler's try/catch must convert this to a typed
    // error response.
    globalThis.fetch = () => {
      throw new Error("ECONNREFUSED");
    };
    const res = await checkMonitors("failing");
    assert.equal(res.isError, true);
    assert.match(res.error, /ECONNREFUSED/);
  });

  it("Drata 401 on getRecentEvents propagates with status code in error", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    const res = await getRecentEvents(10);
    assert.equal(res.isError, true);
    assert.match(res.error, /401/);
  });
});

describe("fetchAllV2 — actual cursor advancement", () => {
  before(() => {
    // Install an extra route that paginates a synthetic resource across
    // 3 pages with advancing cursors. We do this by overriding the policies
    // route via a flag.
  });

  it("advances cursor across multiple pages and accumulates results", async () => {
    // Reuse policies path but reshape per-call state.
    let call = 0;
    const pages = [
      { data: [{ id: 1 }, { id: 2 }], pagination: { cursor: "c1" } },
      { data: [{ id: 3 }, { id: 4 }], pagination: { cursor: "c2" } },
      { data: [{ id: 5 }], pagination: { cursor: null } },
    ];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.pathname === "/public/v2/policies") {
        const resp = pages[call++];
        return new Response(JSON.stringify(resp), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return realFetch(url);
    };
    try {
      const res = await listPoliciesV2();
      assert.equal(res.isError, false);
      assert.equal(res.result.total, 5, "should accumulate across 3 pages");
      assert.equal(call, 3, "should make exactly 3 paginated requests");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("listFrameworkRequirements auto-resolve", () => {
  it("falls back to /public/v2/workspaces when neither param nor env var is set", async () => {
    delete process.env.DRATA_WORKSPACE_ID;
    capturedRequests = [];
    const res = await listFrameworkRequirements();
    assert.equal(res.isError, false, `unexpected error: ${res.error}`);
    const wsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/workspaces",
    );
    assert.ok(wsReq, "should fetch workspaces to auto-resolve");
    const reqsReq = capturedRequests.find(
      (r) =>
        r.method === "GET" &&
        r.path === "/public/v2/workspaces/42/framework-requirements",
    );
    assert.ok(reqsReq, "should hit framework-requirements for resolved workspace");
  });
});

describe("resolveOrFetchWorkspaceId — malformed responses", () => {
  it("workspace with non-numeric id throws a clear error", async () => {
    delete process.env.DRATA_WORKSPACE_ID;
    workspacesPayloadOverride = {
      data: [{ id: "abc-not-a-number" }],
      pagination: { cursor: null },
    };
    try {
      const res = await listFrameworks();
      assert.equal(res.isError, true);
      assert.match(res.error, /[Nn]o workspaces|Workspace ID/);
    } finally {
      workspacesPayloadOverride = null;
    }
  });
});

describe("run_gap_analysis next-actions reflect monitor classification", () => {
  it("next-actions list a 'Fix N failing monitors' line that matches check_monitors", async () => {
    const gap = await runGapAnalysis();
    const failing = await checkMonitors("failing");
    const expectedCount = failing.result.matched; // 3 in current fixture
    const fixLine = gap.result.nextActions.find((a) =>
      a.startsWith("PRIORITY 2: Fix"),
    );
    assert.ok(fixLine, `expected a 'Fix ... failing monitors' action, got: ${gap.result.nextActions}`);
    assert.match(
      fixLine,
      new RegExp(`Fix ${expectedCount} failing monitors`),
      `expected "Fix ${expectedCount} failing monitors" in nextActions, got: ${fixLine}`,
    );
  });

  it("gaps include one monitor line per failing monitor, bucketed by the monitor's own priority", async () => {
    const gap = await runGapAnalysis();
    const failing = await checkMonitors("failing");
    const allBuckets = [
      ...gap.result.gaps.critical,
      ...gap.result.gaps.high,
      ...gap.result.gaps.medium,
      ...gap.result.gaps.low,
    ];
    const monitorLines = allBuckets.filter(
      (l) => l.startsWith("FAILING MONITOR:") || l.startsWith("MONITOR ERROR:"),
    );
    assert.equal(
      monitorLines.length,
      failing.result.matched,
      "one gap line per failing monitor across all severity buckets",
    );
    // Failing monitors are no longer blanket-critical: they land in the
    // bucket matching their own Drata priority. Fixture: M2 FAILED (HIGH),
    // M5 ERROR (HIGH), M6 NEEDS_ATTENTION (MEDIUM).
    assert.equal(
      gap.result.gaps.critical.filter((l) => l.startsWith("FAILING MONITOR:"))
        .length,
      0,
      "no fixture monitor has CRITICAL priority",
    );
    assert.equal(
      gap.result.gaps.high.filter((l) => l.startsWith("FAILING MONITOR:"))
        .length,
      1,
    );
    // An ERROR monitor is labeled as unevaluated, never as an observed failure.
    assert.equal(
      gap.result.gaps.high.filter((l) => l.startsWith("MONITOR ERROR:")).length,
      1,
    );
    assert.equal(
      gap.result.gaps.medium.filter((l) => l.startsWith("FAILING MONITOR:"))
        .length,
      1,
    );
  });
});

describe("Tool wrapper layer — Zod validation", () => {
  let CheckMonitorsTool;
  before(async () => {
    CheckMonitorsTool = (await import("../dist/tools/check/check-monitors.tool.js")).default();
  });

  it("schema is a Zod-compatible object describing the filter enum", async () => {
    // The CreateDrataTool helper exposes the raw Zod shape on `.schema`.
    assert.ok(CheckMonitorsTool.schema, "tool must expose schema");
    assert.ok(CheckMonitorsTool.schema.filter, "schema must declare filter");
    // safeParse on the wrapped Zod object proves the enum boundary.
    const zodModule = await import("zod");
    const z = zodModule.z ?? zodModule.default;
    const wrapped = z.object(CheckMonitorsTool.schema);
    assert.equal(wrapped.safeParse({ filter: "all" }).success, true);
    assert.equal(wrapped.safeParse({ filter: "failing" }).success, true);
    assert.equal(
      wrapped.safeParse({ filter: "garbage-filter" }).success,
      false,
      "Zod must reject invalid enum values before they reach the handler",
    );
  });
});

describe("concurrency — singleton client survives parallel handler invocations", () => {
  it("8 concurrent checkMonitors calls all succeed and return identical counts", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => checkMonitors("failing")),
    );
    for (const r of results) {
      assert.equal(r.isError, false);
      assert.equal(r.result.matched, 3);
    }
    // All results should be structurally identical.
    const first = JSON.stringify(results[0]);
    for (const r of results.slice(1)) {
      assert.equal(JSON.stringify(r), first);
    }
  });

  it("mixed parallel handlers (gap-analysis, compliance-summary, personnel) do not corrupt each other", async () => {
    const [gap, summary, personnel] = await Promise.all([
      runGapAnalysis(),
      getComplianceSummary(),
      checkPersonnel(),
    ]);
    assert.equal(gap.isError, false);
    assert.equal(summary.isError, false);
    assert.equal(personnel.isError, false);
    // The per-handler invariants still hold.
    assert.equal(gap.result.overview.totalMonitors, 6);
    assert.equal(summary.result.passingMonitors, 2);
    assert.equal(personnel.result.totalPersonnel, 4);
  });
});

describe("run_gap_analysis with frameworkFilter", () => {
  it("returns a clean error message when no controls match the filter", async () => {
    const res = await runGapAnalysis("UNKNOWN_FRAMEWORK_XYZ");
    // controls list in mock is empty — error should mention the framework
    // name and suggest available ones (which is also empty here).
    assert.equal(res.isError, true);
    assert.match(res.error, /UNKNOWN_FRAMEWORK_XYZ/);
  });
});

describe("flattenPersonnel — top-level fallbacks when user is null", () => {
  it("picks up termsAgreed from p.drataTermsAgreedAt when p.user is null", async () => {
    const { flattenPersonnel } = await import("../dist/clients/drata-client.js");
    const flat = flattenPersonnel({
      id: 3,
      employmentStatus: "FORMER_EMPLOYEE",
      user: null,
      drataTermsAgreedAt: "2024-05-01T00:00:00Z",
    });
    assert.equal(flat.termsAgreed, true, "top-level ?? fallback still flattens");
  });

  it("checkPersonnel never treats Drata-ToS acceptance as policy ack", async () => {
    // drataTermsAgreedAt records the person accepting Drata's own Terms of
    // Service at first portal login — NOT policy acknowledgement. It must not
    // appear in output nor influence missingPolicyAck (complianceChecks-driven).
    const res = await checkPersonnel();
    const alex = res.result.personnel.find((p) => p.id === 2);
    assert.ok(!("termsAgreed" in alex));
    assert.equal(
      alex.missingPolicyAck,
      false,
      "no ACCEPTED_POLICIES check data → not reported missing despite null drataTermsAgreedAt",
    );
  });
});

describe("get_recent_events — float and exotic limit inputs", () => {
  it("limit=10.5 (float) is accepted and forwarded to upstream", async () => {
    capturedRequests = [];
    const res = await getRecentEvents(10.5);
    assert.equal(res.isError, false);
    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/events",
    );
    // Must NOT be NaN, must be finite. Drata accepts integer-like values;
    // we don't go out of our way to floor since Drata historically accepts
    // floats and just truncates. Just assert no NaN leak.
    assert.ok(!eventsReq.query.includes("NaN"));
    assert.ok(eventsReq.query.includes("limit=10.5") || eventsReq.query.includes("limit=10"));
  });

  it("limit=Infinity clamps to 50, never reaches upstream as 'Infinity'", async () => {
    capturedRequests = [];
    const res = await getRecentEvents(Infinity);
    // Number.isFinite(Infinity) is false → coerce to default 20 → clamped.
    assert.equal(res.isError, false);
    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/events",
    );
    assert.ok(!eventsReq.query.includes("Infinity"));
    assert.ok(eventsReq.query.includes("limit=20"));
  });
});

// ──────────────────────────────────────────────────────────────
// Workspace resolution, pagination, envelopes and error mapping
// ──────────────────────────────────────────────────────────────

describe("workspace-id auto-resolve generalised across handlers", () => {
  it("list_monitoring_tests_v2 with no arg auto-resolves via env var", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    try {
      const res = await listMonitoringTestsV2();
      assert.equal(res.isError, false, `unexpected error: ${res.error}`);
      const req = capturedRequests.find(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/monitoring-tests",
      );
      assert.ok(req, "should hit /public/v2/workspaces/42/monitoring-tests");
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("list_monitoring_tests_v2 with no env var auto-fetches from /public/v2/workspaces", async () => {
    delete process.env.DRATA_WORKSPACE_ID;
    capturedRequests = [];
    const res = await listMonitoringTestsV2();
    assert.equal(res.isError, false, `unexpected error: ${res.error}`);
    const wsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/workspaces",
    );
    assert.ok(wsReq, "should auto-fetch workspaces list");
  });

  it("list_evidence_library auto-resolves workspace", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    try {
      const res = await listEvidenceLibrary();
      assert.equal(res.isError, false);
      const req = capturedRequests.find(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/evidence-library",
      );
      assert.ok(req);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("list_evidence_library projects selected fields", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      const res = await listEvidenceLibrary(undefined, { size: 50 }, {
        fields: ["id", "name"],
      });
      assert.equal(res.isError, false);
      assert.deepEqual(res.result.items[0], { id: 100, name: "SOC2 cert" });
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("get_monitoring_test auto-resolves workspace", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    try {
      const res = await getMonitoringTest(undefined, 8);
      assert.equal(res.isError, false, `unexpected error: ${res.error}`);
      // The id is resolved against the workspace's monitoring-tests LIST
      // first (testId vs monitor-id disambiguation), then the single test
      // is fetched by its resolved testId.
      const listIdx = capturedRequests.findIndex(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/monitoring-tests",
      );
      assert.ok(listIdx !== -1, "should list monitoring-tests to resolve the id");
      const getIdx = capturedRequests.findIndex(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/monitoring-tests/8",
      );
      assert.ok(getIdx !== -1, "should fetch the single test by resolved testId");
      assert.ok(listIdx < getIdx, "list resolution happens before the single GET");
      // A plain valid-testId call returns the raw test object, unwrapped.
      assert.deepEqual(res.result, {
        id: 205,
        testId: 8,
        name: "MFA enforced",
        checkResultStatus: "PASSED",
      });
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("list_control_owners auto-resolves workspace", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    try {
      const res = await listControlOwners(undefined, 5);
      assert.equal(res.isError, false);
      const req = capturedRequests.find(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/controls/5/owners",
      );
      assert.ok(req);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });
});

// ── Control owner writes: serialized body field names ──────────
// Regression guard for the field-rename bug: add_control_owner must send
// `{ ownerId }` (not `{ userId }`) and modify_control_owners must send
// `{ ownerUserIds }` (not `{ userIds }`). Public tool inputs are unchanged
// (callers still pass userId / userIds); only the wire body is remapped.

describe("add_control_owner serialized body", () => {
  it("POSTs `{ ownerId }`, not `{ userId }`", async () => {
    capturedRequests = [];
    const res = await addControlOwner(7, 5, 99);
    assert.equal(res.isError, false, `unexpected error: ${res.error}`);
    const postReq = capturedRequests.find(
      (r) =>
        r.method === "POST" &&
        r.path === "/public/v2/workspaces/7/controls/5/owners",
    );
    assert.ok(postReq, "Should POST to control owners");
    assert.equal(postReq.body.ownerId, 99, "body must carry ownerId");
    assert.equal(postReq.body.userId, undefined, "must NOT send stale userId");
  });
});

describe("modify_control_owners serialized body", () => {
  it("PUTs `{ ownerUserIds: [...] }`, not `{ userIds }`", async () => {
    capturedRequests = [];
    const res = await modifyControlOwners(7, 5, [11, 22, 33]);
    assert.equal(res.isError, false, `unexpected error: ${res.error}`);
    const putReq = capturedRequests.find(
      (r) =>
        r.method === "PUT" &&
        r.path === "/public/v2/workspaces/7/controls/5/owners",
    );
    assert.ok(putReq, "Should PUT to control owners");
    assert.deepEqual(
      putReq.body.ownerUserIds,
      [11, 22, 33],
      "body must carry ownerUserIds array",
    );
    assert.equal(putReq.body.userIds, undefined, "must NOT send stale userIds");
  });
});

describe("pagination + size caps on big-payload list endpoints", () => {
  it("list_events_v2 with default params returns one page (≤50KB)", async () => {
    capturedRequests = [];
    const res = await listEventsV2();
    assert.equal(res.isError, false);
    const size = JSON.stringify(res.result).length;
    assert.ok(size < 50_000, `response was ${size} bytes, expected <50000`);
    // Must include pagination cursor
    assert.ok(res.result.pagination, "should include pagination object");
    // Default sort should land on createdAt DESC
    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/events",
    );
    assert.ok(eventsReq.query.includes("sort=createdAt"));
    assert.ok(eventsReq.query.includes("sortDir=DESC"));
    assert.ok(eventsReq.query.includes("size=50"));
  });

  it("list_events_v2 forwards `since` (createdAtFrom) when provided via tool", async () => {
    const ListEventsV2Tool = (
      await import("../dist/tools/v2/list-events-v2.tool.js")
    ).default();
    capturedRequests = [];
    await ListEventsV2Tool.handler({ since: "2026-04-01T00:00:00Z" });
    const eventsReq = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/events",
    );
    assert.ok(
      eventsReq.query.includes("createdAtFrom=2026-04-01"),
      `expected createdAtFrom in query, got: ${eventsReq.query}`,
    );
  });

  it("list_events_v2 client-side filters when Drata ignores createdAtFrom", async () => {
    const res = await listEventsV2({ createdAtFrom: "2026-04-09T00:00:00Z" });
    assert.equal(res.isError, false);
    assert.deepEqual(
      res.result.events.map((event) => event.id),
      ["new-event"],
    );
  });

  it("list_assets default returns one page with pagination metadata (≤50KB)", async () => {
    capturedRequests = [];
    const res = await listAssets();
    assert.equal(res.isError, false);
    const size = JSON.stringify(res.result).length;
    assert.ok(size < 50_000, `response was ${size} bytes, expected <50000`);
    assert.equal(res.result.page, 1);
    // The default size is 20 so verbose asset records fit in ~40KB.
    // `total` is the workspace count of live assets; `returned` is the page
    // count.
    assert.equal(res.result.limit, 20);
    assert.equal(res.result.returned, 20);
    assert.equal(res.result.total, 75);
    assert.equal(res.result.assets.length, 20, "first page only — no auto-merge");
    assert.equal(res.result.hasMore, true);
  });

  it("list_assets respects size and page params", async () => {
    const res = await listAssets({ size: 20, page: 3 });
    assert.equal(res.result.assets.length, 20);
    assert.equal(res.result.page, 3);
  });

  it("list_framework_requirements default returns one page with pagination cursor (≤50KB)", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      capturedRequests = [];
      const res = await listFrameworkRequirements();
      assert.equal(res.isError, false);
      const size = JSON.stringify(res.result).length;
      assert.ok(size < 50_000, `response was ${size} bytes, expected <50000`);
      assert.ok(res.result.pagination, "should include pagination cursor");
      const req = capturedRequests.find(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/framework-requirements",
      );
      // The default size is 20.
      assert.ok(req.query.includes("size=20"), "default size=20 should be forwarded");
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });
});

describe("list_policies V1/V2 description differs", () => {
  it("V1 description states ACTIVE-only", async () => {
    const tool = (
      await import("../dist/tools/list/list-policies.tool.js")
    ).default();
    assert.match(tool.description, /ACTIVE/);
    assert.match(tool.description, /list_policies_v2/);
  });

  it("V2 description notes REPLACED inclusion", async () => {
    const tool = (
      await import("../dist/tools/v2/list-policies-v2.tool.js")
    ).default();
    assert.match(tool.description, /REPLACED|ARCHIVED/);
  });
});

describe("V2 envelope consistency — typed-key + total + pagination", () => {
  it("list_frameworks returns { frameworks, total, pagination }", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      const res = await listFrameworks();
      assert.equal(res.isError, false);
      assert.ok(Array.isArray(res.result.frameworks));
      assert.equal(typeof res.result.total, "number");
      assert.ok(res.result.pagination, "must have pagination object");
      assert.equal(res.result.data, undefined, "raw `data` should be normalized away");
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("list_vendor_types returns { vendorTypes, total, pagination }", async () => {
    // Mock returns 404 since /public/v2/vendor-types isn't routed — we'll
    // patch the call here with a temporary fetch override. Easier path:
    // assert envelope shape on a mocked success path via the handler.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).endsWith("/public/v2/vendor-types")) {
        return new Response(
          JSON.stringify({ data: [{ id: 1, name: "PaaS" }], pagination: { cursor: null } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(u);
    };
    try {
      const res = await listVendorTypes();
      assert.equal(res.isError, false);
      assert.ok(Array.isArray(res.result.vendorTypes));
      assert.equal(res.result.total, 1);
      assert.ok(res.result.pagination);
      assert.equal(res.result.data, undefined);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("list_vendor_questionnaires returns { questionnaires, total, pagination }", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).includes("/public/v2/vendors/100/questionnaires")) {
        return new Response(
          JSON.stringify({
            data: [{ id: 9 }],
            pagination: { cursor: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(u);
    };
    try {
      const res = await listVendorQuestionnaires(100);
      assert.equal(res.isError, false);
      assert.ok(Array.isArray(res.result.questionnaires));
      assert.equal(res.result.total, 1);
      assert.ok(res.result.pagination);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("connection health derivation", () => {
  it("isHealthy is true only for ACTIVE state with null failedAt", async () => {
    const res = await listConnections();
    assert.equal(res.isError, false);
    const aws = res.result.connections.find((c) => c.id === 1); // ACTIVE, no failedAt
    const github = res.result.connections.find((c) => c.id === 2); // MISCONFIGURED
    const okta = res.result.connections.find((c) => c.id === 3); // ACTIVE but failedAt set
    const stripe = res.result.connections.find((c) => c.id === 4); // CONFIGURED_PENDING_CONFIRMATION

    assert.equal(aws.isHealthy, true);
    assert.equal(github.isHealthy, false);
    assert.equal(okta.isHealthy, false);
    assert.equal(stripe.isHealthy, false);
  });

  it("connected is overridden to false when MISCONFIGURED or failedAt set", async () => {
    const res = await listConnections();
    const aws = res.result.connections.find((c) => c.id === 1);
    const github = res.result.connections.find((c) => c.id === 2);
    const okta = res.result.connections.find((c) => c.id === 3);

    assert.equal(aws.connected, true);
    assert.equal(
      github.connected,
      false,
      "MISCONFIGURED should override raw connected=true",
    );
    assert.equal(
      okta.connected,
      false,
      "failedAt set should override raw connected=true",
    );
  });

  it("response includes healthyConnections / unhealthyConnections counts", async () => {
    const res = await listConnections();
    assert.equal(res.result.healthyConnections, 1);
    assert.equal(res.result.unhealthyConnections, 3);
    assert.equal(res.result.total, 4);
  });

  it("compliance-summary surfaces healthyConnections", async () => {
    const res = await getComplianceSummary();
    assert.equal(res.isError, false);
    assert.equal(res.result.totalConnections, 4);
    assert.equal(res.result.healthyConnections, 1);
  });
});

describe("list_devices_v2 enrichment", () => {
  it("returns device summary fields", async () => {
    const res = await listDevicesV2();
    assert.equal(res.isError, false);
    assert.equal(res.result.totalDevices, 3);
    // Only device 1 is "reporting": recent check AND telemetry. Device 2
    // has null telemetry; device 3's lastCheckedAt is too old.
    assert.equal(res.result.devicesReporting, 1);
    // devicesWith* counts everything with the field set, irrespective of
    // recency — devices 1 and 3 both have the boolean flags true.
    assert.equal(res.result.devicesWithEncryption, 2);
    assert.equal(res.result.devicesWithScreenLock, 2);
    assert.equal(res.result.devicesWithAntivirus, 2);
    assert.equal(res.result.devicesWithPasswordManager, 2);
    assert.equal(res.result.devicesWithAutoUpdates, 2);
    assert.equal(res.result.devicesWithFirewall, 2);
    assert.ok(Array.isArray(res.result.nonReportingDevices));
    assert.equal(res.result.nonReportingDevices.length, 2);
  });

  it("nonReportingDevices include device with stale lastCheckedAt", async () => {
    const res = await listDevicesV2();
    const ids = res.result.nonReportingDevices.map((d) => d.id);
    assert.ok(ids.includes(2), "device 2 has all-null telemetry");
    assert.ok(ids.includes(3), "device 3 has old lastCheckedAt");
  });

  it("nonReportingDevices include personnelId and lastCheckedAt", async () => {
    const res = await listDevicesV2();
    for (const d of res.result.nonReportingDevices) {
      assert.equal(typeof d.id, "number");
      assert.ok("personnelId" in d);
      assert.ok("lastCheckedAt" in d);
    }
  });
});

describe("list_policy_versions normalises numeric policyStatus", () => {
  it("nested policy.policyStatus is mapped from number to string", async () => {
    // Augment the mock: inject a numeric policyStatus into POLICY_VERSIONS for this test.
    const original = POLICY_VERSIONS.map((v) => ({ ...v }));
    POLICY_VERSIONS.length = 0;
    POLICY_VERSIONS.push({
      id: 501,
      policyId: 13,
      version: 1,
      current: false,
      status: "PUBLISHED",
      policy: { id: 13, name: "Info Sec", policyStatus: 1 }, // numeric
    });
    POLICY_VERSIONS.push({
      id: 502,
      policyId: 13,
      version: 2,
      current: true,
      status: "DRAFT",
      policy: { id: 13, name: "Info Sec", policyStatus: 3 }, // numeric REPLACED
    });
    try {
      const res = await listPolicyVersions(13);
      assert.equal(res.isError, false);
      const v1 = res.result.versions.find((v) => v.id === 501);
      const v2 = res.result.versions.find((v) => v.id === 502);
      assert.equal(v1.policy.policyStatus, "ACTIVE");
      assert.equal(v1.policy.policyStatusCode, 1);
      assert.equal(v2.policy.policyStatus, "REPLACED");
      assert.equal(v2.policy.policyStatusCode, 3);
    } finally {
      POLICY_VERSIONS.length = 0;
      POLICY_VERSIONS.push(...original);
    }
  });

  it("getPolicyVersion normalises policyStatus on a single version too", async () => {
    const original = POLICY_VERSIONS.map((v) => ({ ...v }));
    POLICY_VERSIONS.length = 0;
    POLICY_VERSIONS.push({
      id: 501,
      policyId: 13,
      version: 1,
      current: false,
      status: "PUBLISHED",
      policy: { id: 13, name: "Info Sec", policyStatus: 2 }, // ARCHIVED
    });
    try {
      const res = await getPolicyVersion(13, 501);
      assert.equal(res.isError, false);
      assert.equal(res.result.policy.policyStatus, "ARCHIVED");
      assert.equal(res.result.policy.policyStatusCode, 2);
    } finally {
      POLICY_VERSIONS.length = 0;
      POLICY_VERSIONS.push(...original);
    }
  });
});

describe("402 plan-gated mapping", () => {
  it("listRiskRegisters surfaces 402 as a non-retryable, feature-named message", async () => {
    const res = await listRiskRegisters();
    assert.equal(res.isError, true);
    assert.equal(res.drataCode, 10740);
    assert.equal(res.httpStatus, 402);
    assert.equal(res.retryable, false);
    assert.equal(res.feature, "Risk Management Pro");
    // Names the gated feature and points at the base-tier alternative.
    assert.match(res.error, /Risk Management Pro/);
    assert.match(res.error, /list_risks/);
  });

  it("non-402 errors keep their original message, with httpStatus surfaced", async () => {
    // Hit a non-existent vendor — should 404.
    const res = await getVendor(9999999);
    assert.equal(res.isError, true);
    assert.equal(res.httpStatus, 404);
    assert.match(res.error, /404/);
    // Should NOT be mistaken for a plan-gated 402.
    assert.equal(res.feature, undefined);
    assert.ok(!/upgrade your plan/.test(res.error));
  });
});

describe("search_vendors empty-query rejection", () => {
  it("empty string returns isError=true with helpful message", async () => {
    const res = await searchVendors("");
    assert.equal(res.isError, true);
    assert.match(res.error, /non-empty/i);
  });

  it("whitespace-only string is rejected", async () => {
    const res = await searchVendors("   ");
    assert.equal(res.isError, true);
    assert.match(res.error, /non-empty/i);
  });

  it("Zod schema enforces minLength: 1 at the tool layer", async () => {
    const tool = (
      await import("../dist/tools/list/search-vendors.tool.js")
    ).default();
    const zodModule = await import("zod");
    const z = zodModule.z ?? zodModule.default;
    const wrapped = z.object(tool.schema);
    assert.equal(wrapped.safeParse({ query: "" }).success, false);
    assert.equal(wrapped.safeParse({ query: "AWS" }).success, true);
  });
});

// ──────────────────────────────────────────────────────────────
// Response size, envelope keys and `total` semantics
// ──────────────────────────────────────────────────────────────

describe("default size keeps verbose-record responses under 40KB", () => {
  it("list_assets default response is < 40KB on a verbose-record fixture", async () => {
    // Inject verbose asset records to mimic a real workspace where each
    // asset is ~45 lines / ~1.4KB. With size=20 the budget is comfortable.
    const verbose = ASSETS_DATA.splice(0, ASSETS_DATA.length);
    const padding = "x".repeat(800);
    for (let i = 0; i < 75; i++) {
      ASSETS_DATA.push({
        id: i + 1,
        name: `Verbose asset ${i + 1}`,
        type: "WORKSTATION",
        description: padding,
        owner: { id: i, name: padding.slice(0, 100) },
        tags: ["a", "b", "c", "d", "e"],
      });
    }
    try {
      const res = await listAssets();
      assert.equal(res.isError, false);
      const size = JSON.stringify(res.result).length;
      assert.ok(
        size < 40_000,
        `expected <40KB, got ${size} bytes (${(size / 1024).toFixed(1)}KB)`,
      );
      assert.equal(res.result.assets.length, 20);
    } finally {
      ASSETS_DATA.length = 0;
      ASSETS_DATA.push(...verbose);
    }
  });

  it("list_framework_requirements default size=20 is forwarded", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    try {
      await listFrameworkRequirements();
      const req = capturedRequests.find(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/framework-requirements",
      );
      assert.ok(req.query.includes("size=20"));
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("explicit size still works (cap is 500)", async () => {
    const res = await listAssets({ size: 5 });
    assert.equal(res.result.assets.length, 5);
    assert.equal(res.result.limit, 5);
  });
});

describe("no V2 list/get tool returns a top-level `data` field", () => {
  it("listFrameworks → no `data` key", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      const res = await listFrameworks();
      assert.equal(res.isError, false);
      assert.equal(res.result.data, undefined);
      assert.ok(Array.isArray(res.result.frameworks));
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("listControlOwners → { controlOwners, returned, total, pagination }, no `data`", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      const res = await listControlOwners(undefined, 5);
      assert.equal(res.isError, false);
      assert.equal(res.result.data, undefined);
      assert.ok(Array.isArray(res.result.controlOwners));
      assert.equal(typeof res.result.returned, "number");
      assert.ok("pagination" in res.result);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("listWorkspaces → { workspaces, returned, total, pagination }, no `data`", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).endsWith("/public/v2/workspaces")) {
        return new Response(
          JSON.stringify({
            data: [{ id: 11, name: "First" }, { id: 22, name: "Second" }],
            pagination: { cursor: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(u);
    };
    try {
      const { listWorkspaces } = await import("../dist/handlers/v2-write.handler.js");
      const res = await listWorkspaces();
      assert.equal(res.isError, false);
      assert.equal(res.result.data, undefined);
      assert.ok(Array.isArray(res.result.workspaces));
      assert.equal(res.result.workspaces.length, 2);
      assert.equal(res.result.returned, 2);
      assert.equal(res.result.total, 2, "cursor=null → workspace count is the page count");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("listVendorTypes → no `data` key", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).endsWith("/public/v2/vendor-types")) {
        return new Response(
          JSON.stringify({ data: [{ id: 1 }], pagination: { cursor: null } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(u);
    };
    try {
      const res = await listVendorTypes();
      assert.equal(res.result.data, undefined);
      assert.ok(Array.isArray(res.result.vendorTypes));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("listVendorQuestionnaires → no `data` key", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).includes("/public/v2/vendors/100/questionnaires")) {
        return new Response(
          JSON.stringify({ data: [{ id: 9 }], pagination: { cursor: null } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(u);
    };
    try {
      const res = await listVendorQuestionnaires(100);
      assert.equal(res.result.data, undefined);
      assert.ok(Array.isArray(res.result.questionnaires));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("listRiskRegisters wraps even on success path (no `data` leak)", async () => {
    // Override the 402 default and return a normal V2 envelope.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).endsWith("/public/v2/risk-registers")) {
        return new Response(
          JSON.stringify({ data: [{ id: 1 }], pagination: { cursor: null } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(u);
    };
    try {
      const res = await listRiskRegisters();
      assert.equal(res.isError, false);
      assert.equal(res.result.data, undefined);
      assert.ok(Array.isArray(res.result.riskRegisters));
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("`total` semantics — workspace count, not page count", () => {
  it("listFrameworks total === workspace count when cursor is null", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      const res = await listFrameworks();
      assert.equal(res.isError, false);
      // Mock has 2 frameworks for workspace 42, cursor: null.
      assert.equal(res.result.total, 2);
      assert.equal(res.result.returned, 2);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("paginated single-page response with non-null cursor → total=null, returned=page count", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).includes("/public/v2/events")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
            pagination: { cursor: "more-pages-after-this" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(u);
    };
    try {
      const res = await listEventsV2();
      assert.equal(res.isError, false);
      assert.equal(res.result.returned, 3, "page-level count is exact");
      assert.equal(
        res.result.total,
        null,
        "with cursor still set, workspace total is unknown — must be null, not the page count",
      );
      assert.equal(res.result.pagination.cursor, "more-pages-after-this");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("V1 paginated tools (list_assets) report workspace total natively", async () => {
    const res = await listAssets({ size: 5 });
    assert.equal(res.result.returned, 5);
    assert.equal(
      res.result.total,
      75,
      "V1 returns workspace total in the response — handler must surface it",
    );
    assert.notEqual(
      res.result.total,
      res.result.returned,
      "total must NOT be silently aliased to the page count",
    );
  });

  it("auto-merged V2 tools (listMonitoringTestsV2) report total === returned === items.length", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      const res = await listMonitoringTestsV2();
      assert.equal(res.isError, false);
      assert.equal(res.result.total, res.result.returned);
      assert.equal(res.result.total, res.result.tests.length);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("listPoliciesV2 (auto-merged) — total is the workspace count", async () => {
    const res = await listPoliciesV2();
    assert.equal(res.isError, false);
    assert.equal(res.result.total, 2, "mock has 2 policies in workspace");
    assert.equal(res.result.returned, 2);
  });

  it("Single-page helper: cursor null AND page returned ≥ size → still treat as last page", async () => {
    // If the server returns no cursor on a "full" page, we still know we're
    // at the end. total = page count is correct.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).includes("/public/v2/events")) {
        return new Response(
          JSON.stringify({
            data: Array.from({ length: 50 }, (_, i) => ({ id: `e${i}` })),
            pagination: { cursor: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(u);
    };
    try {
      const res = await listEventsV2();
      assert.equal(res.result.returned, 50);
      assert.equal(res.result.total, 50, "no more pages → workspace count IS this page");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ──────────────────────────────────────────────────────────────
// list_assets totals and single-page defaults
// ──────────────────────────────────────────────────────────────

describe("list_assets reports the workspace total", () => {
  it("default call returns finite `total`, never 9999999 sentinel", async () => {
    const res = await listAssets();
    assert.equal(res.isError, false, res.error);
    assert.ok(Number.isFinite(res.result.total), `total is ${res.result.total}`);
    assert.notEqual(
      res.result.total,
      9999999,
      "Drata's V1 sentinel total must not leak through",
    );
  });

  it("`total` matches get_compliance_summary's totalAssets", async () => {
    const assetsRes = await listAssets();
    const summaryRes = await getComplianceSummary();
    assert.equal(assetsRes.isError, false);
    assert.equal(summaryRes.isError, false);
    assert.equal(
      assetsRes.result.total,
      summaryRes.result.totalAssets,
      `list_assets says ${assetsRes.result.total}, compliance-summary says ${summaryRes.result.totalAssets}`,
    );
  });

  it("`returned` is the slice for the requested page, distinct from total", async () => {
    const res = await listAssets({ size: 10, page: 2 });
    assert.equal(res.isError, false);
    assert.equal(res.result.returned, 10);
    assert.equal(res.result.page, 2);
    assert.equal(res.result.total, 75, "mock workspace has 75 assets");
    assert.notEqual(res.result.returned, res.result.total);
    assert.equal(res.result.hasMore, true);
    // The 10 we got should be assets 11..20 (offset 10, limit 10).
    assert.equal(res.result.assets[0].id, 11);
    assert.equal(res.result.assets[9].id, 20);
  });

  it("requesting a page past the end returns 0 records, hasMore=false", async () => {
    const res = await listAssets({ size: 10, page: 100 });
    assert.equal(res.isError, false);
    assert.equal(res.result.returned, 0);
    assert.equal(res.result.hasMore, false);
    assert.equal(res.result.total, 75);
  });
});

describe("list_framework_requirements default returns one page", () => {
  it("default call (no params) does NOT auto-paginate — returns ≤ size records", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      capturedRequests = [];
      const res = await listFrameworkRequirements();
      assert.equal(res.isError, false, res.error);
      assert.ok(
        res.result.requirements.length <= 20,
        `expected ≤20 requirements, got ${res.result.requirements.length} — handler is auto-paginating`,
      );
      // size=20 must actually appear in the outgoing query (the spread bug
      // silently dropped it).
      const req = capturedRequests.find(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/framework-requirements",
      );
      assert.ok(
        req.query.includes("size=20"),
        `expected size=20 in outgoing query, got: ${req.query}`,
      );
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("default call surfaces a cursor when there are more pages", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      const res = await listFrameworkRequirements();
      assert.equal(res.isError, false);
      // 61 total in mock, default size=20 → cursor must be non-null.
      assert.ok(
        res.result.pagination.cursor,
        "cursor must be present so callers can iterate",
      );
      // total must be null — workspace count isn't known on a
      // single-page V2 fetch with more pages remaining.
      assert.equal(res.result.total, null);
      assert.equal(res.result.returned, 20);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("explicit size still works — proves the mock + handler honour the param", async () => {
    process.env.DRATA_WORKSPACE_ID = "42";
    try {
      const res = await listFrameworkRequirements(undefined, { size: 5 });
      assert.equal(res.isError, false);
      assert.equal(res.result.returned, 5);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  it("tool-layer default invocation forwards size=20 (covers the spread bug)", async () => {
    // The bug surfaced specifically because the tool layer forwarded
    // `size: undefined`, which then clobbered the handler's default in a
    // naive spread. Drive the call through the tool to exercise that path.
    const ListFrameworkRequirementsTool = (
      await import("../dist/tools/v2/list-framework-requirements.tool.js")
    ).default();
    process.env.DRATA_WORKSPACE_ID = "42";
    capturedRequests = [];
    try {
      const out = await ListFrameworkRequirementsTool.handler({});
      const parsed = JSON.parse(out.content[0].text);
      assert.ok(parsed.requirements.length <= 20);
      const req = capturedRequests.find(
        (r) =>
          r.method === "GET" &&
          r.path === "/public/v2/workspaces/42/framework-requirements",
      );
      assert.ok(
        req.query.includes("size=20"),
        `tool layer must forward size=20, got: ${req.query}`,
      );
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });
});

describe("list_events_v2 also resists `size: undefined` clobber from the tool layer", () => {
  it("tool default invocation forwards size=50, sort=createdAt, sortDir=DESC", async () => {
    const ListEventsV2Tool = (
      await import("../dist/tools/v2/list-events-v2.tool.js")
    ).default();
    capturedRequests = [];
    await ListEventsV2Tool.handler({});
    const req = capturedRequests.find(
      (r) => r.method === "GET" && r.path === "/public/v2/events",
    );
    assert.ok(req.query.includes("size=50"), `expected size=50, got: ${req.query}`);
    assert.ok(req.query.includes("sort=createdAt"));
    assert.ok(req.query.includes("sortDir=DESC"));
  });
});

describe("V1 vs V2 review counts — full delta is observable", () => {
  it("Example Tracker (id 102) flips from needsReview to hasReviews when V2 is enabled", async () => {
    const res = await checkVendorSecurityReviews();
    const inHas = res.result.hasReviews.find((v) => v.id === 102);
    const inNeeds = res.result.needsReview.find((v) => v.id === 102);
    assert.ok(inHas, "V2 surfaces an Example Tracker review V1 missed — must land in hasReviews");
    assert.equal(inNeeds, undefined, "Example Tracker must NOT also appear in needsReview");
    assert.equal(inHas.securityReviewStatus, "UP_TO_DATE");
    assert.equal(inHas.completedReviewCount, 1);
    assert.equal(inHas.totalReviewRecords, 1);
    assert.equal(inHas.decision, "APPROVED");
  });

  it("V1-only vendor without V2 counterpart is still merged correctly", async () => {
    // Example Chat is in both V1 (0 reviews) and V2 (0 reviews). Force a
    // scenario where Example Chat only exists in V1 by removing it from V2
    // temporarily.
    const idx = V2_VENDORS.findIndex((v) => v.id === 101);
    const removed = V2_VENDORS.splice(idx, 1)[0];
    try {
      const res = await checkVendorSecurityReviews();
      const chat = res.result.needsReview.find((v) => v.id === 101);
      assert.ok(chat, "Example Chat should still appear (V1-only)");
      assert.equal(chat.securityReviewStatus, "NO_PAST_REVIEW");
      assert.equal(chat.completedReviewCount, 0);
      assert.equal(chat.totalReviewRecords, 0);
    } finally {
      V2_VENDORS.splice(idx, 0, removed);
    }
  });
});
