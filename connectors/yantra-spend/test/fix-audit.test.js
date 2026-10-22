/**
 * Response-shape and output-size tests: signals-first serialization, the
 * default line cap, zero-pad markers, line_count reconciliation, forecast
 * skip reporting and forecast basis labels. Same conventions as
 * bug-fixes.test.js: tools are exercised via their registered MCP callbacks
 * with a stubbed source registry — never live APIs. The clock is pinned so
 * windows are deterministic.
 */
import { describe, it, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

const { _setRegistryForTests } = await import("../dist/sources/registry.js");
const { YantraSpendMcpServer } = await import(
  "../dist/server/yantra-spend-mcp-server.js"
);
const { ToolFactory } = await import("../dist/tools/tool-factory.js");
const { DEFAULT_LINE_LIMIT } = await import(
  "../dist/handlers/spend-by-source.handler.js"
);
const { AwsSource } = await import("../dist/sources/aws.source.js");
const { AzureSource } = await import("../dist/sources/azure.source.js");
const { AnthropicSource } = await import(
  "../dist/sources/anthropic.source.js"
);
const fx = await import("../dist/fx/fx.js");

const PINNED_NOW = new Date("2026-05-08T00:00:00.000Z").getTime();

/** See bug-fixes.test.js — capture registered tool callbacks by name. */
function makeToolCaller() {
  YantraSpendMcpServer.ResetForTests();
  const server = YantraSpendMcpServer.GetServer();
  const registry = new Map();
  const schemas = new Map();
  const original = server.tool.bind(server);
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

/** Stub source. `result` is { lines } | { error } | { forecast } | { forecastError }. */
function stubSource(name, available, result) {
  return {
    name,
    requiredEnv: result?.requiredEnv ?? [],
    isAvailable: () => available,
    getCostLines: async () => {
      if (result?.error) throw new Error(result.error);
      return result?.lines ?? [];
    },
    getAnomalies: async () => [],
    getForecastToMonthEnd: async () => {
      if (result?.forecastError) throw new Error(result.forecastError);
      return result?.forecast ?? null;
    },
    probe: async () => ({ reachable: available }),
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

const day = (dayOfMay) =>
  `2026-05-${String(dayOfMay).padStart(2, "0")}T00:00:00.000Z`;

const groupedLine = (value, amount, d = 3) => ({
  source: "aws",
  period_start: day(d),
  period_end: day(d + 1),
  amount_usd: amount,
  group_by_field: "service",
  group_by_value: value,
});

// ────────────────────────────────────────────────────────────────────────
// Truncation/warning signals serialize BEFORE the lines array.
// ────────────────────────────────────────────────────────────────────────
describe("spend_by_source signals-first serialization", () => {
  it("emits total/returned/pad counts, truncated and warnings before lines", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { lines: [groupedLine("EC2", 12.5)] }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-03",
        end: "2026-05-04",
        group_by: "service",
      }),
    );
    // JSON.parse preserves key insertion order for non-numeric keys.
    assert.deepEqual(Object.keys(result), [
      "total_line_count",
      "returned_line_count",
      "zero_pad_line_count",
      "truncated",
      "warnings",
      "lines",
    ]);
  });

  it("keeps signals-first shape on the no-credentials path", async () => {
    _setRegistryForTests([stubSource("aws", false, {})]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-03",
        end: "2026-05-04",
      }),
    );
    assert.deepEqual(Object.keys(result), [
      "total_line_count",
      "returned_line_count",
      "zero_pad_line_count",
      "truncated",
      "warnings",
      "lines",
    ]);
    assert.deepEqual(result.warnings, ["aws: skipped (no credentials)"]);
  });

  it("spend_summary serializes partial/warnings before the sources array", async () => {
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
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_summary", {
        start: "2026-05-01",
        end: "2026-05-08",
        currency: "USD",
      }),
    );
    const keys = Object.keys(result);
    assert.ok(keys.indexOf("partial") < keys.indexOf("sources"));
    assert.ok(keys.indexOf("warnings") < keys.indexOf("sources"));
  });

  it("top_movers and anomalies serialize warnings before their arrays", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { lines: [groupedLine("EC2", 10)] }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const movers = parseJson(
      await call("top_movers", {
        start: "2026-05-01",
        end: "2026-05-08",
      }),
    );
    assert.deepEqual(Object.keys(movers), ["warnings", "movers"]);
    const anomalies = parseJson(await call("anomalies", {}));
    assert.deepEqual(Object.keys(anomalies), ["warnings", "anomalies"]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Default cap sized for token budgets; clear guidance when it is hit.
// ────────────────────────────────────────────────────────────────────────
describe("spend_by_source default cap and truncation guidance", () => {
  it("default limit is 150", () => {
    assert.equal(DEFAULT_LINE_LIMIT, 150);
  });

  it("caps an omitted-limit high-cardinality call at 150 with narrowing guidance", async () => {
    const lines = [];
    for (let i = 0; i < 400; i += 1) {
      lines.push(groupedLine(`usage-${i}`, i + 1));
    }
    _setRegistryForTests([stubSource("aws", true, { lines })]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-03",
        end: "2026-05-04",
        group_by: "service",
      }),
    );
    assert.equal(result.truncated, true);
    assert.equal(result.total_line_count, 400);
    assert.equal(result.returned_line_count, 150);
    assert.equal(result.lines.length, 150);
    // Highest-spend lines kept: the smallest kept amount beats every elided one.
    const minKept = Math.min(...result.lines.map((l) => l.amount_usd));
    assert.equal(minKept, 400 - 150 + 1);
    assert.ok(
      result.warnings.some((w) =>
        /truncated: returned the top 150 .* of 400 total/.test(w) &&
        /narrow the window/.test(w) &&
        /drop or coarsen group_by/.test(w),
      ),
      `expected truncation guidance, got ${JSON.stringify(result.warnings)}`,
    );
  });

  it("serializes compact (no pretty-print indent) to cut payload size", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { lines: [groupedLine("EC2", 12.5)] }),
    ]);
    const { call } = makeToolCaller();
    const response = await call("spend_by_source", {
      source: "aws",
      start: "2026-05-03",
      end: "2026-05-04",
      group_by: "service",
    });
    assert.equal(response.content[0].text.includes("\n"), false);
  });

  it("description states the 150 default and the signal-first shape", () => {
    const { schemas } = makeToolCaller();
    const desc = schemas.get("spend_by_source").description;
    assert.match(desc, /default 150/);
    assert.match(desc, /total_line_count, returned_line_count, zero_pad_line_count, truncated, warnings, lines/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Grouped zero-pad lines carry an explicit group_by_value: null.
// ────────────────────────────────────────────────────────────────────────
describe("zero-pad lines are explicitly marked in grouped responses", () => {
  it("grouped pads have group_by_value === null (key present after JSON round-trip)", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { lines: [groupedLine("EC2", 12.5)] }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-01",
        end: "2026-05-08",
        group_by: "service",
      }),
    );
    const pads = result.lines.filter((l) => l.amount_usd === 0);
    assert.equal(pads.length, 6);
    assert.equal(result.zero_pad_line_count, 6);
    for (const pad of pads) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(pad, "group_by_value"),
        "pad line must carry the group_by_value key",
      );
      assert.equal(pad.group_by_value, null);
      assert.equal(pad.group_by_field, "service");
    }
    const real = result.lines.find((l) => l.amount_usd > 0);
    assert.equal(real.group_by_value, "EC2");
  });

  it("ungrouped pads carry neither group_by key (matching real ungrouped lines)", async () => {
    _setRegistryForTests([
      stubSource("aws", true, {
        lines: [
          {
            source: "aws",
            period_start: day(3),
            period_end: day(4),
            amount_usd: 9.99,
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
    const pads = result.lines.filter((l) => l.amount_usd === 0);
    assert.equal(pads.length, 6);
    for (const pad of pads) {
      assert.equal("group_by_value" in pad, false);
      assert.equal("group_by_field" in pad, false);
    }
  });

  it("anthropic getCostLines throws loudly on a non-USD line instead of dropping it", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-05-01T00:00:00Z",
              ending_at: "2026-05-02T00:00:00Z",
              results: [{ amount: "100.00", currency: "EUR" }],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const source = new AnthropicSource(fetcher);
    await assert.rejects(
      () =>
        source.getCostLines(
          new Date("2026-05-01T00:00:00Z"),
          new Date("2026-05-08T00:00:00Z"),
        ),
      /unsupported currency 'EUR'.*only USD/,
    );
    delete process.env.ANTHROPIC_ADMIN_KEY;
  });
});

// ────────────────────────────────────────────────────────────────────────
// spend_summary line_count vs spend_by_source padded counts reconcile.
// ────────────────────────────────────────────────────────────────────────
describe("line_count reconciliation between the two tools", () => {
  it("total_line_count - zero_pad_line_count equals spend_summary's line_count", async () => {
    const providerLines = [
      {
        source: "aws",
        period_start: day(3),
        period_end: day(4),
        amount_usd: 42,
      },
    ];
    _setRegistryForTests([stubSource("aws", true, { lines: providerLines })]);
    const { call, parseJson } = makeToolCaller();
    const bySource = parseJson(
      await call("spend_by_source", {
        source: "aws",
        start: "2026-05-01",
        end: "2026-05-08",
      }),
    );
    assert.equal(bySource.total_line_count, 7); // 1 provider row + 6 pads
    assert.equal(bySource.zero_pad_line_count, 6);

    const summary = parseJson(
      await call("spend_summary", {
        start: "2026-05-01",
        end: "2026-05-08",
        currency: "USD",
      }),
    );
    const aws = summary.sources.find((s) => s.source === "aws");
    assert.equal(aws.line_count, 1); // provider rows only, no padding
    assert.equal(
      aws.line_count,
      bySource.total_line_count - bySource.zero_pad_line_count,
    );
  });

  it("both tool descriptions state the padding difference is not a discrepancy", () => {
    const { schemas } = makeToolCaller();
    assert.match(
      schemas.get("spend_summary").description,
      /PROVIDER-RETURNED rows only/,
    );
    assert.match(
      schemas.get("spend_by_source").description,
      /total_line_count - zero_pad_line_count/,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// forecast_month_end reports every source absent from `forecasts`, with the
// skip list serializing first.
// ────────────────────────────────────────────────────────────────────────
describe("forecast_month_end accounts for every skipped source", () => {
  const awsForecast = {
    source: "aws",
    period_start: "2026-05-01T00:00:00.000Z",
    period_end: "2026-06-01T00:00:00.000Z",
    amount_usd: 400,
    group_by_field: "forecast",
    group_by_value: "month_end",
  };

  it("lists creds-missing, unsupported, no-forecast and errored sources with reasons", async () => {
    _setRegistryForTests([
      stubSource("aws", true, { forecast: awsForecast }),
      stubSource("azure", false, {}),
      stubSource("gcp", false, {}),
      stubSource("cursor", true, { forecast: null }),
      stubSource("anthropic", true, { forecastError: "API 503: boom" }),
    ]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("forecast_month_end", {}));

    // Skip signals serialize before the forecasts map.
    assert.deepEqual(Object.keys(result), [
      "sources_skipped",
      "warnings",
      "forecasts",
    ]);
    assert.deepEqual(Object.keys(result.forecasts), ["aws"]);

    const reasonOf = (name) =>
      result.sources_skipped.find((s) => s.source === name)?.reason;
    assert.equal(reasonOf("azure"), "skipped (no credentials)");
    assert.equal(reasonOf("gcp"), "unsupported");
    assert.match(reasonOf("cursor"), /no forecast available/);
    assert.equal(reasonOf("anthropic"), "api error (see warnings)");
    assert.ok(
      result.warnings.some((w) => w.startsWith("anthropic:")),
      `expected anthropic error warning, got ${JSON.stringify(result.warnings)}`,
    );
    // The one source that DID forecast is not in the skip list.
    assert.equal(reasonOf("aws"), undefined);
  });

  it("a fully-successful registry yields an empty sources_skipped, not a missing key", async () => {
    _setRegistryForTests([stubSource("aws", true, { forecast: awsForecast })]);
    const { call, parseJson } = makeToolCaller();
    const result = parseJson(await call("forecast_month_end", {}));
    assert.deepEqual(result.sources_skipped, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.forecasts.aws.amount_usd, 400);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Forecast amounts are labeled with what they cover.
// ────────────────────────────────────────────────────────────────────────
describe("forecast_basis labels the differing provider semantics", () => {
  it("AWS forecast carries a full-current-month basis label", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    const fakeClient = {
      send: async () => ({
        Total: { Amount: "1000.00" },
        ForecastResultsByTime: [
          { TimePeriod: { Start: "2026-05-01", End: "2026-06-01" } },
        ],
      }),
    };
    const source = new AwsSource(() => fakeClient);
    const forecast = await source.getForecastToMonthEnd();
    assert.match(forecast.forecast_basis, /full current calendar month/);
    assert.match(forecast.forecast_basis, /month-to-date actuals/);
    assert.match(forecast.forecast_basis, /NOT remaining spend from today/);
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  it("Azure forecast carries a remaining-month basis label", async () => {
    process.env.AZURE_TENANT_ID = "t";
    process.env.AZURE_CLIENT_ID = "c";
    process.env.AZURE_CLIENT_SECRET = "s";
    process.env.AZURE_SUBSCRIPTION_IDS = "sub-a";
    // SDK-shaped ForecastResult: the SDK hoists the wire `properties`
    // envelope, so columns/rows sit at the top level.
    const now = new Date();
    const today = Number(
      now.toISOString().slice(0, 10).replaceAll("-", ""),
    );
    const fakeFactory = () => ({
      query: { usage: async () => undefined },
      forecast: {
        usage: async () => ({
          columns: [
            { name: "PreTaxCost", type: "Number" },
            { name: "UsageDate", type: "Number" },
            { name: "CostStatus", type: "String" },
            { name: "Currency", type: "String" },
          ],
          rows: [[1234.56, today, "Forecast", "USD"]],
        }),
      },
    });
    const source = new AzureSource(fakeFactory);
    const forecast = await source.getForecastToMonthEnd();
    assert.match(forecast.forecast_basis, /remaining month/);
    assert.match(forecast.forecast_basis, /excluding month-to-date/);
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CLIENT_SECRET;
    delete process.env.AZURE_SUBSCRIPTION_IDS;
  });

  it("tool description spells out both semantics", () => {
    const { schemas } = makeToolCaller();
    const desc = schemas.get("forecast_month_end").description;
    assert.match(desc, /FULL current calendar month/);
    assert.match(desc, /REMAINING spend from today/);
    assert.match(desc, /sources_skipped/);
  });
});
