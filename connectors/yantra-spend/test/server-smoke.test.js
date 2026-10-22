/**
 * Server-level smoke tests. Stubs the source registry with deterministic
 * fakes, exercises the public handler API, and confirms:
 *   - Aggregation in spend_summary works across sources
 *   - Sources without creds yield warnings, not errors
 *   - currency=GBP populates amount_gbp via the FX module
 *   - Tool registration succeeds for all 6 tools
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { _setRegistryForTests } = await import("../dist/sources/registry.js");
const fx = await import("../dist/fx/fx.js");
const { spendSummary } = await import(
  "../dist/handlers/spend-summary.handler.js"
);
const { spendBySource } = await import(
  "../dist/handlers/spend-by-source.handler.js"
);
const { topMovers } = await import("../dist/handlers/top-movers.handler.js");
const { healthCheck } = await import("../dist/handlers/health.handler.js");
const { YantraSpendMcpServer } = await import(
  "../dist/server/yantra-spend-mcp-server.js"
);
const { ToolFactory } = await import("../dist/tools/tool-factory.js");

const START = new Date("2026-05-01T00:00:00Z");
const END = new Date("2026-05-08T00:00:00Z");

// Deterministic stub factory — `current` returns one shape, `prior` another,
// so spend_summary's WoW math is checkable.
function makeStub(name, available, currentTotal, priorTotal, group = []) {
  return {
    name,
    isAvailable: () => available,
    getCostLines: async (start, end) => {
      const isCurrent = end.getTime() === END.getTime();
      const total = isCurrent ? currentTotal : priorTotal;
      if (!available) return [];
      if (group.length === 0) {
        return [
          {
            source: name,
            period_start: start.toISOString(),
            period_end: end.toISOString(),
            amount_usd: total,
          },
        ];
      }
      // Spread the total across labels for top_movers exercises.
      const per = total / group.length;
      return group.map((label) => ({
        source: name,
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        amount_usd: isCurrent ? per : per * 0.5, // current 2× prior
        group_by_field: "service",
        group_by_value: label,
      }));
    },
    getAnomalies: async () => [],
    getForecastToMonthEnd: async () => null,
    probe: async () => ({ reachable: available }),
  };
}

beforeEach(() => {
  fx._resetFxCacheForTests();
  process.env.FX_GBP_PER_USD_OVERRIDE = "0.79";
});

after(() => {
  _setRegistryForTests(null);
  delete process.env.FX_GBP_PER_USD_OVERRIDE;
});

describe("spend_summary handler", () => {
  it("aggregates available sources and lists skipped sources with null amounts", async () => {
    _setRegistryForTests([
      makeStub("aws", true, 100, 80),
      makeStub("azure", true, 50, 40),
      makeStub("anthropic", false, 0, 0),
    ]);
    const response = await spendSummary({
      start: START,
      end: END,
      currency: "USD",
    });
    assert.equal(response.isError, false);
    const summary = response.result;
    assert.equal(summary.grand_total_usd, 150);
    assert.equal(summary.grand_total_gbp, undefined);
    // Post-fix: every source appears in `sources`. Failed/skipped ones have
    // amount_usd=null and line_count=null and don't contribute to grand_total.
    assert.equal(summary.sources.length, 3);
    const anthro = summary.sources.find((s) => s.source === "anthropic");
    assert.equal(anthro.amount_usd, null);
    assert.equal(anthro.line_count, null);
    assert.equal(summary.partial, true, "any-skip => partial");
    assert.ok(
      summary.warnings.some((w) =>
        w.includes("anthropic") && w.includes("no credentials"),
      ),
    );
    // wow_delta computed over the [aws, azure] intersection — anthropic
    // is unavailable so it isn't counted. partial=true, but wow is no
    // longer auto-nulled: 150 current vs 120 prior = +25%.
    assert.equal(summary.wow_delta_pct, 25);
    assert.ok(
      summary.warnings.some((w) =>
        /^wow_delta_pct computed over:.*aws.*azure|azure.*aws/.test(w),
      ),
      `expected intersection naming warning, got ${JSON.stringify(summary.warnings)}`,
    );
  });

  it("populates GBP totals when currency=GBP", async () => {
    _setRegistryForTests([makeStub("aws", true, 100, 100)]);
    const response = await spendSummary({
      start: START,
      end: END,
      currency: "GBP",
    });
    assert.equal(response.isError, false);
    assert.equal(response.result.fx_gbp_per_usd, 0.79);
    assert.equal(response.result.grand_total_gbp, 79);
    assert.equal(response.result.sources[0].amount_gbp, 79);
    assert.equal(response.result.partial, false);
  });

  it("handles a source that throws by reporting null amount and warning", async () => {
    const exploding = {
      name: "azure",
      isAvailable: () => true,
      getCostLines: async () => {
        throw new Error("AZURE_CLIENT_SECRET expired");
      },
      getAnomalies: async () => [],
      getForecastToMonthEnd: async () => null,
      probe: async () => ({ reachable: false, error: "test" }),
    };
    _setRegistryForTests([exploding, makeStub("aws", true, 200, 100)]);
    const response = await spendSummary({
      start: START,
      end: END,
      currency: "USD",
    });
    assert.equal(response.isError, false);
    assert.equal(response.result.grand_total_usd, 200);
    const azure = response.result.sources.find((s) => s.source === "azure");
    assert.equal(azure.amount_usd, null);
    assert.equal(azure.line_count, null);
    assert.equal(response.result.partial, true);
    assert.ok(
      response.result.warnings.some(
        (w) => w.includes("azure") && w.includes("AZURE_CLIENT_SECRET"),
      ),
    );
  });

  it("rejects when end <= start", async () => {
    _setRegistryForTests([makeStub("aws", true, 100, 100)]);
    const response = await spendSummary({
      start: END,
      end: START,
      currency: "USD",
    });
    assert.equal(response.isError, true);
    assert.match(response.error, /strictly greater/);
  });
});

describe("spend_by_source handler", () => {
  it("returns cost lines for one source (with day padding for aws)", async () => {
    _setRegistryForTests([
      makeStub("aws", true, 100, 100, ["EC2", "S3"]),
      makeStub("azure", true, 50, 50),
    ]);
    const response = await spendBySource({
      source: "aws",
      start: START,
      end: END,
      currency: "USD",
    });
    assert.equal(response.isError, false);
    // The stub emits 2 lines (one per group label) on a single day. With day
    // padding for AWS, missing days [START..END) get a zero-amount line each.
    // 7-day span - 1 stub day = 6 padded days, plus 2 stub lines = 8 lines.
    assert.equal(response.result.lines.length, 8);
    const real = response.result.lines.filter((l) => l.amount_usd > 0);
    assert.equal(real.length, 2);
    const padded = response.result.lines.filter((l) => l.amount_usd === 0);
    assert.equal(padded.length, 6);
    assert.ok(response.result.lines.every((l) => l.source === "aws"));
    assert.ok(
      response.result.lines.every((l) => !("raw" in l)),
      "raw should be stripped by default",
    );
  });

  it("rejects an invalid group_by with the exact allowlist error", async () => {
    _setRegistryForTests([makeStub("aws", true, 100, 100)]);
    const response = await spendBySource({
      source: "aws",
      start: START,
      end: END,
      group_by: "made-up",
      currency: "USD",
    });
    assert.equal(response.isError, true);
    assert.match(
      response.error,
      /^invalid group_by 'made-up' for source 'aws', allowed: service\|region\|account\|usage_type\|tag:project\|tag:env\|tag:owner$/,
    );
  });

  it("includes raw when include_raw=true", async () => {
    const stubWithRaw = {
      name: "aws",
      isAvailable: () => true,
      getCostLines: async () => [
        {
          source: "aws",
          period_start: START.toISOString(),
          period_end: END.toISOString(),
          amount_usd: 10,
          raw: { provider_native: "yes" },
        },
      ],
      getAnomalies: async () => [],
      getForecastToMonthEnd: async () => null,
      probe: async () => ({ reachable: true }),
    };
    _setRegistryForTests([stubWithRaw]);
    const response = await spendBySource({
      source: "aws",
      start: START,
      end: END,
      currency: "USD",
      include_raw: true,
    });
    assert.equal(response.isError, false);
    const real = response.result.lines.find((l) => l.amount_usd > 0);
    assert.deepEqual(real.raw, { provider_native: "yes" });
  });

  it("warns rather than throws when source has no creds", async () => {
    _setRegistryForTests([makeStub("aws", false, 0, 0)]);
    const response = await spendBySource({
      source: "aws",
      start: START,
      end: END,
      currency: "USD",
    });
    assert.equal(response.isError, false);
    assert.deepEqual(response.result.lines, []);
    assert.deepEqual(response.result.warnings, [
      "aws: skipped (no credentials)",
    ]);
  });

  it("rejects unknown source", async () => {
    _setRegistryForTests([makeStub("aws", true, 0, 0)]);
    const response = await spendBySource({
      source: "made-up",
      start: START,
      end: END,
      currency: "USD",
    });
    assert.equal(response.isError, true);
  });
});

describe("top_movers handler", () => {
  it("returns largest WoW positive deltas across sources", async () => {
    _setRegistryForTests([
      // current 100, prior 50 → delta 50, split across labels
      makeStub("aws", true, 100, 100, ["EC2", "S3"]),
      makeStub("azure", true, 80, 80, ["VirtualMachines"]),
    ]);
    const response = await topMovers({
      start: START,
      end: END,
      limit: 5,
      currency: "USD",
    });
    assert.equal(response.isError, false);
    assert.ok(response.result.movers.length >= 1);
    // The first mover should be the largest delta
    for (let i = 1; i < response.result.movers.length; i += 1) {
      assert.ok(
        response.result.movers[i - 1].delta_usd >=
          response.result.movers[i].delta_usd,
      );
    }
  });
});

describe("health handler", () => {
  it("returns availability for every source in the registry", async () => {
    _setRegistryForTests([
      makeStub("aws", true, 0, 0),
      makeStub("azure", false, 0, 0),
    ]);
    const response = await healthCheck();
    assert.equal(response.isError, false);
    assert.deepEqual(response.result, { aws: true, azure: false });
  });
});

describe("tool registration", () => {
  before(() => {
    YantraSpendMcpServer.ResetForTests();
  });

  it("registers all 6 tools with valid schemas", () => {
    const server = YantraSpendMcpServer.GetServer();
    const registered = [];
    const originalTool = server.tool.bind(server);
    // See bug-fixes.test.js — ToolFactory uses two call shapes.
    server.tool = (name, description, schema, ...rest) => {
      const handler = rest[rest.length - 1];
      const annotations = rest.length === 2 ? rest[0] : undefined;
      registered.push({ name, description, schema, handler, annotations });
      return originalTool(name, description, schema, ...rest);
    };
    ToolFactory(server);
    const names = registered.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "anomalies",
      "forecast_month_end",
      "health",
      "spend_by_source",
      "spend_summary",
      "top_movers",
    ]);
    for (const tool of registered) {
      assert.ok(tool.description.length > 30);
      assert.equal(typeof tool.handler, "function");
      assert.ok(tool.schema && typeof tool.schema === "object");
    }
  });
});
