/**
 * Tool-level regression tests. Each test exercises the relevant tool via its
 * registered MCP callback (i.e. through the tool-factory registration path)
 * rather than calling handlers directly. The clock is pinned to
 * 2026-05-08T00:00:00Z so windows are deterministic.
 */
import {
  describe,
  it,
  before,
  beforeEach,
  afterEach,
  mock,
} from "node:test";
import assert from "node:assert/strict";

const { _setRegistryForTests } = await import("../dist/sources/registry.js");
const { YantraSpendMcpServer } = await import(
  "../dist/server/yantra-spend-mcp-server.js"
);
const { ToolFactory } = await import("../dist/tools/tool-factory.js");
const { AwsSource } = await import("../dist/sources/aws.source.js");
const { AnthropicSource } = await import(
  "../dist/sources/anthropic.source.js"
);
const { CursorSource } = await import("../dist/sources/cursor.source.js");
const { GcpSource } = await import("../dist/sources/gcp.source.js");
const fx = await import("../dist/fx/fx.js");

const PINNED_NOW = new Date("2026-05-08T00:00:00.000Z").getTime();

/**
 * Register all tools on a fresh McpServer, capture each tool's callback by
 * name, and return a `call(name, args)` helper that invokes the callback
 * the same way the MCP transport would (passing the args object plus an
 * extra arg for tool metadata).
 */
function makeToolCaller() {
  YantraSpendMcpServer.ResetForTests();
  const server = YantraSpendMcpServer.GetServer();
  const registry = new Map();
  const schemas = new Map();
  const original = server.tool.bind(server);
  // ToolFactory uses two call shapes:
  //   server.tool(name, description, schema, handler)            // no annotations
  //   server.tool(name, description, schema, annotations, handler) // with annotations
  // Pull `handler` from the last position regardless of arity.
  server.tool = (name, description, schema, ...rest) => {
    const handler = rest[rest.length - 1];
    const annotations = rest.length === 2 ? rest[0] : undefined;
    registry.set(name, handler);
    schemas.set(name, { description, schema, annotations });
    return original(name, description, schema, ...rest);
  };
  ToolFactory(server);
  const extra = {
    signal: new AbortController().signal,
    requestId: "test-1",
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return {
    schemas,
    call: async (name, args = {}) => {
      const cb = registry.get(name);
      if (!cb) throw new Error(`tool not registered: ${name}`);
      return cb(args, extra);
    },
    parseJson: (response) => JSON.parse(response.content[0].text),
  };
}

/** Build a stub source. `result` is { lines } | { error: string }. */
function stubSource(name, available, result) {
  const linesArg = result?.lines ?? [];
  return {
    name,
    requiredEnv: result?.requiredEnv ?? [],
    isAvailable: () => available,
    getCostLines: async () => {
      if (result?.error) throw new Error(result.error);
      return linesArg;
    },
    getAnomalies: async () => {
      if (result?.anomaliesError) throw new Error(result.anomaliesError);
      return result?.anomalies ?? [];
    },
    getForecastToMonthEnd: async () => result?.forecast ?? null,
    probe: async () => result?.probe ?? { reachable: available },
  };
}

before(() => {
  process.env.FX_GBP_PER_USD_OVERRIDE = "0.79";
});

beforeEach(() => {
  fx._resetFxCacheForTests();
  mock.timers.enable({ apis: ["Date"], now: PINNED_NOW });
});

afterEach(() => {
  mock.timers.reset();
  _setRegistryForTests(null);
});

// ── helpers for building stub lines ─────────────────────────────────────
const day = (dayOfMay) =>
  `2026-05-${String(dayOfMay).padStart(2, "0")}T00:00:00.000Z`;

// ────────────────────────────────────────────────────────────────────────
// spend_summary: failed sources surface as null amounts; partial flag;
// wow_delta_pct null with reason in warnings
// ────────────────────────────────────────────────────────────────────────
describe("spend_summary partial flag and wow_delta_pct rules", () => {
  it("a successful source + a failing source: partial=true, wow computed over the intersection", async () => {
    _setRegistryForTests([
      stubSource("aws", true, {
        lines: [
          {
            source: "aws",
            period_start: day(1),
            period_end: day(8),
            amount_usd: 100,
          },
        ],
      }),
      stubSource("anthropic", true, { error: "API 503: upstream blew up" }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_summary", {
        start: "2026-05-01",
        end: "2026-05-08",
        currency: "USD",
      }),
    );
    assert.equal(result.partial, true);
    assert.equal(result.grand_total_usd, 100, "failed source excluded from grand total");
    const anthro = result.sources.find((s) => s.source === "anthropic");
    assert.equal(anthro.amount_usd, null);
    assert.equal(anthro.line_count, null);
    const aws = result.sources.find((s) => s.source === "aws");
    assert.equal(aws.amount_usd, 100);
    assert.equal(aws.line_count, 1);
    // AWS succeeded in both current and prior (same 100 returned regardless
    // of window), so the intersection is [aws] and wow = 0%, NOT null.
    assert.equal(result.wow_delta_pct, 0);
    assert.ok(
      result.warnings.some((w) =>
        /^wow_delta_pct computed over:.*aws/.test(w),
      ),
      `expected intersection naming warning, got ${JSON.stringify(result.warnings)}`,
    );
    assert.ok(
      !result.warnings.some((w) => w.startsWith("wow_delta_pct: null")),
      "partial alone must not null out wow",
    );
    assert.ok(
      result.warnings.some((w) => w.includes("anthropic") && w.includes("503")),
    );
  });

  it("zero intersection grand_total → wow_delta_pct null with 'zero' reason", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { lines: [] }),
      stubSource("anthropic", true, { lines: [] }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_summary", {
        start: "2026-05-01",
        end: "2026-05-08",
        currency: "USD",
      }),
    );
    assert.equal(result.grand_total_usd, 0);
    assert.equal(result.wow_delta_pct, null);
    assert.ok(
      result.warnings.some(
        (w) => w.includes("intersection") && w.includes("zero"),
      ),
      `expected zero-intersection reason, got ${JSON.stringify(result.warnings)}`,
    );
    // No source failed and no source was skipped → partial=false.
    assert.equal(result.partial, false);
  });

  it("clean current window but prior fails → empty intersection, wow=null", async () => {
    // Source returns lines for the current window (start-end) but throws
    // for the prior (priorStart-priorEnd). Distinguish by start argument.
    const currentStart = new Date("2026-05-01T00:00:00.000Z").getTime();
    const flaky = {
      name: "aws",
      isAvailable: () => true,
      getCostLines: async (start) => {
        if (start.getTime() === currentStart) {
          return [
            {
              source: "aws",
              period_start: day(1),
              period_end: day(8),
              amount_usd: 100,
            },
          ];
        }
        throw new Error("prior window blew up");
      },
      getAnomalies: async () => [],
      getForecastToMonthEnd: async () => null,
      probe: async () => ({ reachable: true }),
    };
    _setRegistryForTests([flaky]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_summary", {
        start: "2026-05-01",
        end: "2026-05-08",
        currency: "USD",
      }),
    );
    assert.equal(result.partial, false, "current window is clean");
    assert.equal(result.grand_total_usd, 100);
    // AWS is not in intersection (prior failed) → no source had data in
    // both windows → wow null.
    assert.equal(result.wow_delta_pct, null);
    assert.ok(
      result.warnings.some(
        (w) =>
          w.startsWith("wow_delta_pct: null because") &&
          w.includes("no source returned data in both windows"),
      ),
      `expected empty-intersection reason, got ${JSON.stringify(result.warnings)}`,
    );
  });

  it("unsupported GCP + Azure missing creds: partial=true, wow_delta_pct still computed over the live intersection", async () => {
    // Scenario: a call with GCP (unsupported) + Azure unavailable forces
    // partial=true but should NOT null the WoW delta — it should be
    // computed over the [aws, anthropic, openai, cursor] intersection.
    // Stub data shaped so the intersection current/prior produces -25%
    // exactly.
    const currentStart = new Date("2026-05-01T00:00:00.000Z").getTime();
    const dateAwareStub = (name, currentUsd, priorUsd) => ({
      name,
      isAvailable: () => true,
      getCostLines: async (start) => {
        const usd = start.getTime() === currentStart ? currentUsd : priorUsd;
        if (usd === 0) return [];
        return [
          {
            source: name,
            period_start: day(1),
            period_end: day(8),
            amount_usd: usd,
          },
        ];
      },
      getAnomalies: async () => [],
      getForecastToMonthEnd: async () => null,
      probe: async () => ({ reachable: true }),
    });
    _setRegistryForTests([
      new GcpSource(), // unsupported: isAvailable=false → not in intersection
      {
        name: "azure",
        isAvailable: () => false, // missing creds → not in intersection
        getCostLines: async () => [],
        getAnomalies: async () => [],
        getForecastToMonthEnd: async () => null,
        probe: async () => ({ reachable: false, error: "no credentials" }),
      },
      dateAwareStub("aws", 750, 1000), // current 750 vs prior 1000 = -25%
      // The other live sources are available and in intersection but
      // contribute 0 to both sums — keeps the intersection size > 1 while
      // the math stays clean.
      dateAwareStub("anthropic", 0, 0),
      dateAwareStub("openai", 0, 0),
      dateAwareStub("cursor", 0, 0),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_summary", {
        start: "2026-05-01",
        end: "2026-05-08",
        currency: "USD",
      }),
    );

    assert.equal(result.partial, true, "unsupported GCP + Azure missing → partial");
    assert.equal(result.grand_total_usd, 750);
    assert.equal(
      result.wow_delta_pct,
      -25,
      "(750 - 1000) / 1000 * 100 = -25%, computed over intersection",
    );
    const intersectionWarning = result.warnings.find((w) =>
      w.startsWith("wow_delta_pct computed over:"),
    );
    assert.ok(intersectionWarning, "expected intersection naming warning");
    for (const s of ["aws", "anthropic", "openai", "cursor"]) {
      assert.ok(
        intersectionWarning.includes(s),
        `intersection warning must name ${s}`,
      );
    }
    // GCP / Azure must NOT appear in the intersection list.
    assert.ok(!intersectionWarning.includes("gcp"), "gcp not in intersection");
    assert.ok(
      !intersectionWarning.includes("azure"),
      "azure not in intersection",
    );
    // The skip warnings for the unavailable sources should still surface.
    assert.ok(
      result.warnings.some((w) => w === "gcp: unsupported"),
    );
    assert.ok(
      result.warnings.some((w) => w === "azure: skipped (no credentials)"),
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// Anthropic ungrouped 500 retry — workspace-grouped fallback summed
// ────────────────────────────────────────────────────────────────────────
describe("Anthropic 500 retry and workspace-grouped collapse", () => {
  it("ungrouped path always queries workspace-grouped and collapses to one line per day", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const seenParams = [];
    const fetcher = async (url) => {
      const u = new URL(url);
      seenParams.push({
        group_by: u.searchParams.getAll("group_by[]"),
        starting_at: u.searchParams.get("starting_at"),
        ending_at: u.searchParams.get("ending_at"),
      });
      return new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-05-01T00:00:00Z",
              ending_at: "2026-05-02T00:00:00Z",
              results: [
                { amount: "1500.00", currency: "USD", workspace_id: "ws_a" },
                { amount: "1054.00", currency: "USD", workspace_id: "ws_b" },
              ],
            },
            {
              starting_at: "2026-05-02T00:00:00Z",
              ending_at: "2026-05-03T00:00:00Z",
              results: [
                { amount: "200.00", currency: "USD", workspace_id: "ws_a" },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new AnthropicSource(fetcher);
    const lines = await source.getCostLines(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-08T00:00:00.000Z"),
    );
    // Verify the request was workspace-grouped, not ungrouped.
    assert.deepEqual(seenParams[0].group_by, ["workspace_id"]);
    // Verify collapse: 2 days of input → 2 lines, each summed across workspaces.
    assert.equal(lines.length, 2);
    // 1500 cents + 1054 cents = 2554 cents = $25.54
    assert.equal(lines[0].amount_usd, 25.54);
    // 200 cents = $2.00
    assert.equal(lines[1].amount_usd, 2);
    // Day 1 + Day 2 = $27.54 for the stubbed window. Lines have no
    // group_by_field after collapse.
    assert.ok(lines.every((l) => l.group_by_field === undefined));
  });

  it("retries exactly once on 500, then succeeds", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("upstream 500", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-05-01T00:00:00Z",
              ending_at: "2026-05-02T00:00:00Z",
              results: [{ amount: "100", currency: "USD", workspace_id: "w" }],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new AnthropicSource(fetcher);
    const lines = await source.getCostLines(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-02T00:00:00.000Z"),
      "workspace_id",
    );
    assert.equal(attempts, 2, "retried once on 500");
    assert.equal(lines.length, 1);
  });

  it("does NOT retry on 4xx (client error)", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return new Response("bad request", { status: 400 });
    };
    const source = new AnthropicSource(fetcher);
    await assert.rejects(
      () =>
        source.getCostLines(
          new Date("2026-05-01T00:00:00.000Z"),
          new Date("2026-05-02T00:00:00.000Z"),
        ),
      /400/,
    );
    assert.equal(attempts, 1, "no retry on 4xx");
  });
});

// ────────────────────────────────────────────────────────────────────────
// anthropic: future-only window returns zeros instead of a 400
// ────────────────────────────────────────────────────────────────────────
describe("anthropic future-only window", () => {
  // Mimics the live API: it clamps ending_at to the present, so any window
  // starting after "now" (PINNED_NOW, 2026-05-08) is a degenerate range.
  const futureRejectingFetcher = async () =>
    new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Invalid date range: ending date must be after starting date",
        },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );

  it("spend_by_source pads a future-only window to zero lines with no warning", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    _setRegistryForTests([new AnthropicSource(futureRejectingFetcher)]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "anthropic",
        start: "2026-05-09",
        end: "2026-05-16",
      }),
    );
    assert.deepEqual(result.warnings, []);
    assert.equal(result.lines.length, 7);
    assert.ok(result.lines.every((l) => l.amount_usd === 0));
    assert.equal(result.zero_pad_line_count, 7);
  });
});

// ────────────────────────────────────────────────────────────────────────
// spend_by_source: group_by allowlist
// ────────────────────────────────────────────────────────────────────────
describe("spend_by_source group_by validation", () => {
  it("throws with the documented format for an unknown axis", async () => {
    _setRegistryForTests([stubSource("aws", true, { lines: [] })]);
    const { call } = makeToolCaller();
    const response = await call("spend_by_source", {
      source: "aws",
      start: "2026-05-01",
      end: "2026-05-08",
      group_by: "department",
    });
    const text = response.content[0].text;
    assert.match(
      text,
      /Error: invalid group_by 'department' for source 'aws', allowed: service\|region\|account\|usage_type\|tag:project\|tag:env\|tag:owner/,
    );
  });

  it("accepts a valid axis without throwing", async () => {
    _setRegistryForTests([stubSource("aws", true, { lines: [] })]);
    const { call, parseJson } = makeToolCaller();
    const response = await call("spend_by_source", {
      source: "aws",
      start: "2026-05-01",
      end: "2026-05-08",
      group_by: "region",
    });
    const result = parseJson(response);
    assert.deepEqual(result.warnings, []);
  });
});

// ────────────────────────────────────────────────────────────────────────
// include_raw flag
// ────────────────────────────────────────────────────────────────────────
describe("include_raw flag", () => {
  function rawStubSource() {
    return stubSource("aws", true, {
      lines: [
        {
          source: "aws",
          period_start: day(1),
          period_end: day(2),
          amount_usd: 1.23,
          raw: { provider_native: "yes" },
        },
      ],
    });
  }

  it("spend_by_source omits raw by default", async () => {
    _setRegistryForTests([rawStubSource()]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-01",
        end: "2026-05-02",
      }),
    );
    const real = result.lines.find((l) => l.amount_usd > 0);
    assert.ok(!("raw" in real), "raw stripped");
  });

  it("spend_by_source includes raw when include_raw=true", async () => {
    _setRegistryForTests([rawStubSource()]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-01",
        end: "2026-05-02",
        include_raw: true,
      }),
    );
    const real = result.lines.find((l) => l.amount_usd > 0);
    assert.deepEqual(real.raw, { provider_native: "yes" });
  });

  it("spend_summary accepts include_raw without error (forward-compatibility no-op)", async () => {
    _setRegistryForTests([rawStubSource()]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_summary", {
        start: "2026-05-01",
        end: "2026-05-02",
        include_raw: true,
      }),
    );
    assert.equal(result.partial, false);
    // SourceTotal shape doesn't include raw — the flag is a no-op for
    // spend_summary and the schema isn't extended.
    for (const s of result.sources) {
      assert.ok(!("raw" in s));
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Day padding for ungrouped queries on aws/anthropic/openai/cursor
// ────────────────────────────────────────────────────────────────────────
describe("day padding", () => {
  it("ungrouped: pads missing days with zero-amount lines", async () => {
    _setRegistryForTests([
      stubSource("aws", true, {
        lines: [
          {
            source: "aws",
            period_start: day(3),
            period_end: day(4),
            amount_usd: 12.34,
          },
        ],
      }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-01",
        end: "2026-05-08",
      }),
    );
    // 7-day window = 7 daily slots; 1 real + 6 zero-padded.
    assert.equal(result.lines.length, 7);
    assert.equal(result.lines.filter((l) => l.amount_usd === 0).length, 6);
    // Lines are sorted by period_start.
    const starts = result.lines.map((l) => l.period_start);
    for (let i = 1; i < starts.length; i++) {
      assert.ok(starts[i - 1] <= starts[i]);
    }
  });

  it("does NOT pad gcp (not in PAD_SOURCES)", async () => {
    // gcp is in the default registry but not supported; isAvailable=false
    // so the unavailable path returns immediately without calling padding.
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "gcp",
        start: "2026-05-01",
        end: "2026-05-08",
      }),
    );
    assert.equal(result.lines.length, 0);
    // The unavailable warning for GCP must surface it as unsupported, not
    // as "no credentials" — adding creds wouldn't help.
    assert.deepEqual(result.warnings, ["gcp: unsupported"]);
  });

  it("spend_summary surfaces gcp as 'unsupported', not 'no credentials'", async () => {
    // Isolate the registry to just the GCP source so the assertion is
    // independent of ambient credential env vars.
    _setRegistryForTests([new GcpSource()]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_summary", {
        start: "2026-05-01",
        end: "2026-05-08",
        currency: "USD",
      }),
    );
    assert.ok(
      result.warnings.some((w) => w === "gcp: unsupported"),
      `expected 'gcp: unsupported' in warnings, got ${JSON.stringify(result.warnings)}`,
    );
    assert.ok(
      !result.warnings.some((w) => w.startsWith("gcp: skipped")),
      "must not surface gcp as a creds-skip",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cursor auto-chunking >30 days
// ────────────────────────────────────────────────────────────────────────
describe("Cursor auto-chunks windows >30 days", () => {
  it("a 60-day window is split into 2× 30-day chunks", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "k";
    const seen = [];
    const fetcher = async (_url, init) => {
      const body = JSON.parse(init.body);
      seen.push({ start: body.startDate, end: body.endDate });
      return new Response(
        JSON.stringify({
          totalUsageEventsCount: 0,
          pagination: { hasNextPage: false },
          usageEvents: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new CursorSource(fetcher);
    const start = new Date("2026-03-09T00:00:00.000Z");
    const end = new Date("2026-05-08T00:00:00.000Z");
    await source.getCostLines(start, end);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].start, start.getTime());
    assert.equal(seen[0].end, start.getTime() + 30 * 24 * 60 * 60 * 1000);
    assert.equal(seen[1].end, end.getTime());
  });
});

// ────────────────────────────────────────────────────────────────────────
// ISO-8601 timestamps include milliseconds
// ────────────────────────────────────────────────────────────────────────
describe("ISO-8601 timestamps with milliseconds and Z", () => {
  it("AWS source emits period_start with .000Z form", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    const fakeClient = {
      send: async () => ({
        ResultsByTime: [
          {
            TimePeriod: { Start: "2026-05-01", End: "2026-05-02" },
            Total: { UnblendedCost: { Amount: "10.00" } },
          },
        ],
      }),
    };
    const source = new AwsSource(() => fakeClient);
    const lines = await source.getCostLines(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-02T00:00:00.000Z"),
    );
    assert.equal(lines[0].period_start, "2026-05-01T00:00:00.000Z");
    assert.equal(lines[0].period_end, "2026-05-02T00:00:00.000Z");
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cursor serviceAccountName attribution — covered separately in
// test/sources.test.js. Reproduce the assertion through the tool layer.
// ────────────────────────────────────────────────────────────────────────
describe("Cursor serviceAccount attribution via the tool layer", () => {
  it("group_by=user maps null userEmail + serviceAccountName to serviceAccount:<name>", async () => {
    _setRegistryForTests([
      stubSource("cursor", true, {
        lines: [
          {
            source: "cursor",
            period_start: day(1),
            period_end: day(2),
            amount_usd: 5,
            group_by_field: "user",
            group_by_value: "alice@example.com",
          },
          {
            source: "cursor",
            period_start: day(1),
            period_end: day(2),
            amount_usd: 3,
            group_by_field: "user",
            group_by_value: "serviceAccount:ci-runner",
          },
        ],
      }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "cursor",
        start: "2026-05-01",
        end: "2026-05-02",
        group_by: "user",
      }),
    );
    const labels = result.lines
      .filter((l) => l.amount_usd > 0)
      .map((l) => l.group_by_value)
      .sort();
    assert.deepEqual(labels, [
      "alice@example.com",
      "serviceAccount:ci-runner",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// forecast_month_end: period_start from response.ForecastResultsByTime,
// unsupported sources are omitted from the response.
// ────────────────────────────────────────────────────────────────────────
describe("forecast_month_end period_start + omit unsupported", () => {
  it("AWS forecast period_start derives from response.ForecastResultsByTime[0].TimePeriod.Start", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    const fakeClient = {
      send: async () => ({
        Total: { Amount: "400.00" },
        ForecastResultsByTime: [
          {
            TimePeriod: {
              Start: "2026-05-08",
              End: "2026-06-01",
            },
            MeanValue: "400.00",
          },
        ],
      }),
    };
    const source = new AwsSource(() => fakeClient);
    const forecast = await source.getForecastToMonthEnd();
    assert.equal(forecast.period_start, "2026-05-08T00:00:00.000Z");
    assert.equal(forecast.period_end, "2026-06-01T00:00:00.000Z");
    assert.equal(forecast.amount_usd, 400);
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  it("forecast_month_end omits sources whose getForecastToMonthEnd returned null", async () => {
    _setRegistryForTests([
      stubSource("aws", true, {
        forecast: {
          source: "aws",
          period_start: day(8),
          period_end: "2026-06-01T00:00:00.000Z",
          amount_usd: 400,
          group_by_field: "forecast",
          group_by_value: "month_end",
        },
      }),
      stubSource("anthropic", true, { forecast: null }),
      stubSource("cursor", true, { forecast: null }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("forecast_month_end", {}));
    assert.deepEqual(Object.keys(result.forecasts).sort(), ["aws"]);
    assert.equal(result.forecasts.aws.amount_usd, 400);
  });

  it("AWS forecast errors propagate to handler warnings (no longer silently null)", async () => {
    // Previously aws.source caught all errors in getForecastToMonthEnd and
    // returned null — making an auth failure indistinguishable from "source
    // doesn't forecast". Now errors should reach the handler and land in
    // warnings, with the source omitted from forecasts.
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    const explodingClient = {
      send: async () => {
        throw new Error("AccessDeniedException: ce:GetCostForecast not permitted");
      },
    };
    _setRegistryForTests([
      {
        name: "aws",
        isAvailable: () => true,
        getCostLines: async () => [],
        getAnomalies: async () => [],
        getForecastToMonthEnd: async () => {
          const real = new AwsSource(() => explodingClient);
          return real.getForecastToMonthEnd();
        },
        probe: async () => ({ reachable: true }),
      },
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("forecast_month_end", {}));
    assert.equal(
      result.forecasts.aws,
      undefined,
      "aws should be omitted on error",
    );
    assert.ok(
      result.warnings.some((w) =>
        w.includes("aws") && w.includes("AccessDenied"),
      ),
      `expected aws AccessDenied warning, got ${JSON.stringify(result.warnings)}`,
    );
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  it("forecast_month_end strips `raw` by default; include_raw=true attaches it", async () => {
    const awsForecastWithRaw = {
      source: "aws",
      period_start: day(8),
      period_end: "2026-06-01T00:00:00.000Z",
      amount_usd: 400,
      group_by_field: "forecast",
      group_by_value: "month_end",
      raw: {
        Total: { Amount: "400.00", Unit: "USD" },
        ForecastResultsByTime: [
          {
            TimePeriod: { Start: "2026-05-08", End: "2026-06-01" },
            MeanValue: "400.00",
            PredictionIntervalLowerBound: "380.00",
            PredictionIntervalUpperBound: "420.00",
          },
        ],
        $metadata: { httpStatusCode: 200 },
      },
    };
    _setRegistryForTests([stubSource("aws", true, { forecast: awsForecastWithRaw })]);
    const { call, parseJson } = makeToolCaller();

    const stripped = parseJson(await call("forecast_month_end", {}));
    assert.ok(stripped.forecasts.aws, "aws forecast present");
    assert.ok(
      !("raw" in stripped.forecasts.aws),
      "raw stripped by default",
    );

    _setRegistryForTests([stubSource("aws", true, { forecast: awsForecastWithRaw })]);
    const attached = parseJson(
      await call("forecast_month_end", { include_raw: true }),
    );
    assert.deepEqual(
      attached.forecasts.aws.raw,
      awsForecastWithRaw.raw,
      "raw attached when include_raw=true",
    );
  });
});

describe("anomalies include_raw flag", () => {
  it("anomalies strips `raw` by default; include_raw=true attaches it", async () => {
    const anomalyWithRaw = {
      source: "aws",
      detected_at: "2026-05-01T00:00:00.000Z",
      description:
        "Amazon Simple Storage Service anomaly — USW2-TimedStorage-ByteHrs in us-west-2 (account: example-dev)",
      impact_usd: 12.5,
      raw: {
        AnomalyStartDate: "2026-05-01T00:00:00Z",
        AnomalyEndDate: "2026-05-08T00:00:00Z",
        DimensionValue: "Amazon Simple Storage Service",
        Impact: { TotalImpact: 12.5 },
        RootCauses: [
          {
            Service: "Amazon Simple Storage Service",
            Region: "us-west-2",
            LinkedAccountName: "example-dev",
            UsageType: "USW2-TimedStorage-ByteHrs",
          },
        ],
      },
    };
    _setRegistryForTests([stubSource("aws", true, { anomalies: [anomalyWithRaw] })]);
    const { call, parseJson } = makeToolCaller();

    const stripped = parseJson(
      await call("anomalies", { window_days: 7 }),
    );
    assert.equal(stripped.anomalies.length, 1);
    assert.ok(
      !("raw" in stripped.anomalies[0]),
      "raw stripped by default",
    );
    // Non-raw fields preserved.
    assert.equal(stripped.anomalies[0].source, "aws");
    assert.equal(stripped.anomalies[0].impact_usd, 12.5);

    _setRegistryForTests([
      stubSource("aws", true, { anomalies: [anomalyWithRaw] }),
    ]);
    const attached = parseJson(
      await call("anomalies", { window_days: 7, include_raw: true }),
    );
    assert.deepEqual(
      attached.anomalies[0].raw,
      anomalyWithRaw.raw,
      "raw attached when include_raw=true",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// AWS anomaly description normalisation
// ────────────────────────────────────────────────────────────────────────
describe("AWS anomaly description format", () => {
  it("formats with DimensionValue + RootCause UsageType / Region / account", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    const fakeClient = {
      send: async () => ({
        Anomalies: [
          {
            AnomalyStartDate: "2026-04-22T00:00:00Z",
            DimensionValue: "Amazon EC2",
            Impact: { TotalImpact: 50 },
            RootCauses: [
              {
                Service: "Amazon EC2",
                UsageType: "BoxUsage:m5.large",
                Region: "us-east-1",
                LinkedAccountName: "prod",
              },
            ],
          },
          {
            // No RootCauses — falls back to "<DimensionValue> anomaly".
            AnomalyStartDate: "2026-05-01T00:00:00Z",
            DimensionValue: "AWS Lambda",
            Impact: { TotalImpact: 1.5 },
            RootCauses: [],
          },
        ],
      }),
    };
    const source = new AwsSource(() => fakeClient);
    const anomalies = await source.getAnomalies(7);
    assert.equal(
      anomalies[0].description,
      "Amazon EC2 anomaly — BoxUsage:m5.large in us-east-1 (account: prod)",
    );
    assert.equal(anomalies[1].description, "AWS Lambda anomaly");
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });
});

// ────────────────────────────────────────────────────────────────────────
// health probe parameter
// ────────────────────────────────────────────────────────────────────────
describe("health probe parameter", () => {
  it("probe=false returns a flat boolean map (default behaviour)", async () => {
    _setRegistryForTests([
      stubSource("aws", true, {}),
      stubSource("anthropic", false, {}),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("health", {}));
    assert.deepEqual(result, { aws: true, anthropic: false });
  });

  it("probe=true returns {available, reachable, error?} per source", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { probe: { reachable: true } }),
      stubSource("anthropic", true, {
        probe: { reachable: false, error: "HTTP 500" },
      }),
      stubSource("cursor", false, {}),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("health", { probe: true }));
    assert.deepEqual(result.aws, { available: true, reachable: true });
    assert.deepEqual(result.anthropic, {
      available: true,
      reachable: false,
      error: "HTTP 500",
    });
    assert.deepEqual(result.cursor, {
      available: false,
      reachable: false,
      error: "no credentials",
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Tool surface sanity: the registered tool list has the right shape.
// ────────────────────────────────────────────────────────────────────────
describe("tool registration and descriptions", () => {
  it("registers exactly 6 tools", () => {
    const { schemas } = makeToolCaller();
    const names = [...schemas.keys()].sort();
    assert.deepEqual(names, [
      "anomalies",
      "forecast_month_end",
      "health",
      "spend_by_source",
      "spend_summary",
      "top_movers",
    ]);
  });

  it("annotates every tool as read-only and idempotent", () => {
    const { schemas } = makeToolCaller();
    for (const [name, { annotations }] of schemas) {
      assert.deepEqual(
        annotations,
        { readOnlyHint: true, idempotentHint: true },
        `${name} must be annotated read-only`,
      );
    }
  });

  it("spend_summary description mentions partial / wow_delta_pct rules", () => {
    const { schemas } = makeToolCaller();
    const desc = schemas.get("spend_summary").description;
    assert.match(desc, /partial: bool/);
    assert.match(desc, /wow_delta_pct/);
  });

  it("spend_by_source description mentions include_raw and the allowlist", () => {
    const { schemas } = makeToolCaller();
    const desc = schemas.get("spend_by_source").description;
    assert.match(desc, /include_raw=true/);
    assert.match(desc, /aws=service\|region\|account/);
  });

  it("health description mentions probe parameter", () => {
    const { schemas } = makeToolCaller();
    const desc = schemas.get("health").description;
    assert.match(desc, /probe=true/);
  });

  it("health description names the endpoint the Cursor probe actually hits", () => {
    const { schemas } = makeToolCaller();
    const desc = schemas.get("health").description;
    assert.match(desc, /filtered-usage-events/);
    assert.doesNotMatch(desc, /team metadata/i);
  });

  it("tool descriptions state GCP is not supported and carry no roadmap labels", () => {
    const { schemas } = makeToolCaller();
    for (const name of ["health", "spend_by_source", "top_movers"]) {
      assert.match(schemas.get(name).description, /GCP is not supported/);
    }
    for (const [name, { description }] of schemas) {
      assert.doesNotMatch(description, /\bphase\b/i, `${name} description`);
    }
  });
});

// ── health: missing_env hints + credential masking ─────────────────────────
describe("health surfaces missing_env and masks probe errors", () => {
  it("unavailable source reports the env var(s) to set in missing_env", async () => {
    _setRegistryForTests([
      stubSource("anthropic", false, {
        requiredEnv: ["ANTHROPIC_ADMIN_KEY"],
      }),
      stubSource("azure", false, {
        requiredEnv: [
          "AZURE_TENANT_ID",
          "AZURE_CLIENT_ID",
          "AZURE_CLIENT_SECRET",
          "AZURE_SUBSCRIPTION_IDS",
        ],
      }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("health", { probe: true }));
    assert.deepEqual(result.anthropic, {
      available: false,
      reachable: false,
      error: "no credentials",
      missing_env: ["ANTHROPIC_ADMIN_KEY"],
    });
    assert.deepEqual(result.azure.missing_env, [
      "AZURE_TENANT_ID",
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET",
      "AZURE_SUBSCRIPTION_IDS",
    ]);
  });

  it("an unsupported source with no requiredEnv (GCP) omits missing_env", async () => {
    _setRegistryForTests([new GcpSource()]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("health", { probe: true }));
    assert.equal(result.gcp.available, false);
    assert.ok(
      !("missing_env" in result.gcp),
      "GCP must not carry missing_env",
    );
  });

  it("probe=true reports GCP as unsupported, not as missing credentials", async () => {
    // No credentials enable GCP, so "no credentials" would send the caller
    // looking for env vars that do not exist. An unconfigured source in the
    // same call still reports "no credentials".
    _setRegistryForTests([
      new GcpSource(),
      stubSource("cursor", false, { requiredEnv: ["CURSOR_ADMIN_API_KEY"] }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("health", { probe: true }));
    assert.deepEqual(result.gcp, {
      available: false,
      reachable: false,
      error: "unsupported",
    });
    assert.deepEqual(result.cursor, {
      available: false,
      reachable: false,
      error: "no credentials",
      missing_env: ["CURSOR_ADMIN_API_KEY"],
    });
  });

  it("masks a credential reflected in a probe error string", async () => {
    _setRegistryForTests([
      stubSource("aws", true, {
        probe: {
          reachable: false,
          // SDK auth error echoing an access key id — must be masked.
          error: "auth failed for AKIAIOSFODNN7EXAMPLE",
        },
      }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("health", { probe: true }));
    assert.equal(result.aws.reachable, false);
    assert.doesNotMatch(result.aws.error, /AKIAIOSFODNN7EXAMPLE/);
    assert.match(result.aws.error, /\[REDACTED\]/);
  });

  it("health tool description enumerates per-source required env vars", () => {
    const { schemas } = makeToolCaller();
    const desc = schemas.get("health").description;
    assert.match(desc, /ANTHROPIC_ADMIN_KEY/);
    assert.match(desc, /CURSOR_ADMIN_API_KEY/);
    assert.match(desc, /AZURE_SUBSCRIPTION_IDS/);
    assert.match(desc, /missing_env/);
  });
});

// ── spend_by_source: row cap + truncation reporting ────────────────────────
describe("spend_by_source caps lines and reports truncation", () => {
  function manyGroupedLines(n) {
    const lines = [];
    for (let i = 0; i < n; i++) {
      lines.push({
        source: "aws",
        period_start: day(1),
        period_end: day(2),
        amount_usd: i + 1, // distinct amounts so the top-N is deterministic
        group_by_field: "usage_type",
        group_by_value: `usage-${i}`,
      });
    }
    return lines;
  }

  it("returns total_line_count and truncated=false under the limit", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { lines: manyGroupedLines(3) }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-01",
        end: "2026-05-02",
        group_by: "usage_type",
      }),
    );
    assert.equal(result.truncated, false);
    assert.equal(result.total_line_count, 3);
    assert.equal(result.lines.length, 3);
  });

  it("caps to `limit`, keeps the highest-spend lines, flags truncation", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { lines: manyGroupedLines(50) }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-01",
        end: "2026-05-02",
        group_by: "usage_type",
        limit: 5,
      }),
    );
    assert.equal(result.truncated, true);
    assert.equal(result.total_line_count, 50);
    assert.equal(result.lines.length, 5);
    // Top 5 by amount_usd are 50,49,48,47,46.
    const amounts = result.lines.map((l) => l.amount_usd).sort((a, b) => b - a);
    assert.deepEqual(amounts, [50, 49, 48, 47, 46]);
    assert.ok(
      result.warnings.some((w) => /truncated: returned the top 5/.test(w)),
      `expected truncation warning, got ${JSON.stringify(result.warnings)}`,
    );
  });
});

// ── forecast_month_end / anomalies: outer try/catch on FX failure ──────────
describe("forecast + anomalies return the uniform error shape", () => {
  it("forecast_month_end FX failure returns isError, not a raw rejection", async () => {
    _setRegistryForTests([
      stubSource("aws", true, {
        forecast: {
          source: "aws",
          period_start: day(8),
          period_end: "2026-06-01T00:00:00.000Z",
          amount_usd: 100,
        },
      }),
    ]);
    const prev = process.env.FX_GBP_PER_USD_OVERRIDE;
    // A non-numeric override makes gbpPerUsd() throw — this call runs OUTSIDE
    // the per-source catch, so without the outer try/catch it would reject.
    process.env.FX_GBP_PER_USD_OVERRIDE = "not-a-number";
    try {
      const { call } = makeToolCaller();
      const response = await call("forecast_month_end", { currency: "GBP" });
      assert.equal(response.isError, true);
      assert.match(response.content[0].text, /Error:/);
    } finally {
      process.env.FX_GBP_PER_USD_OVERRIDE = prev;
    }
  });

  it("anomalies returns the uniform error shape and masks the message", async () => {
    // Force an escaping failure by making allSources() throw via a getter that
    // explodes — simplest is a source whose isAvailable throws (runs before
    // the per-source catch). The thrown message carries a credential.
    _setRegistryForTests([
      {
        name: "aws",
        requiredEnv: [],
        isAvailable: () => {
          throw new Error("boot failure near AKIAIOSFODNN7EXAMPLE");
        },
        getCostLines: async () => [],
        getAnomalies: async () => [],
        getForecastToMonthEnd: async () => null,
        probe: async () => ({ reachable: false }),
      },
    ]);
    const { call } = makeToolCaller();
    const response = await call("anomalies", { window_days: 7 });
    assert.equal(response.isError, true);
    assert.doesNotMatch(response.content[0].text, /AKIAIOSFODNN7EXAMPLE/);
    assert.match(response.content[0].text, /\[REDACTED\]/);
  });
});

// ── spend_summary description matches the intersection-based wow logic ──────
describe("spend_summary description matches wow_delta_pct logic", () => {
  it("description states wow is over the both-window intersection, non-null when partial", () => {
    const { schemas } = makeToolCaller();
    const desc = schemas.get("spend_summary").description;
    assert.match(desc, /intersection/i);
    assert.match(desc, /non-null even when partial/i);
    // It must not claim wow is null whenever the current window is partial.
    assert.doesNotMatch(desc, /null when the current window is partial/i);
  });
});
