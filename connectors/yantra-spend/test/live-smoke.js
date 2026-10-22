/**
 * Live end-to-end smoke runner. Loads creds from connectors/yantra-spend/.env
 * via dotenv, then drives every read tool against real provider APIs.
 *
 * Checked into git because there are no secrets in this file, only handler
 * invocations. Run:
 *
 *   npm run build --workspace=connectors/yantra-spend
 *   node connectors/yantra-spend/test/live-smoke.js
 *
 * Output goes to stdout. Provider-internal IDs and user emails surface in
 * grouped output — review before pasting into a public report.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the connector dir regardless of where this script is run from.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });

const { healthCheck } = await import("../dist/handlers/health.handler.js");
const { spendBySource } = await import(
  "../dist/handlers/spend-by-source.handler.js"
);
const { spendSummary } = await import(
  "../dist/handlers/spend-summary.handler.js"
);
const { topMovers } = await import("../dist/handlers/top-movers.handler.js");
const { anomalies } = await import("../dist/handlers/anomalies.handler.js");
const { forecastMonthEnd } = await import(
  "../dist/handlers/forecast-month-end.handler.js"
);
const { YantraSpendMcpServer } = await import(
  "../dist/server/yantra-spend-mcp-server.js"
);
const { ToolFactory } = await import("../dist/tools/tool-factory.js");

// Window: last 7 days, end-of-yesterday to today midnight UTC.
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const end = today;
const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

function banner(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function summarise(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { count: 0, total_usd: 0 };
  }
  const total = lines.reduce((acc, l) => acc + l.amount_usd, 0);
  return {
    count: lines.length,
    total_usd: Math.round(total * 10000) / 10000,
    first_period: lines[0].period_start,
    last_period: lines[lines.length - 1].period_start,
    sample_groups: [
      ...new Set(
        lines
          .slice(0, 5)
          .map((l) => l.group_by_value)
          .filter(Boolean),
      ),
    ],
  };
}

banner(`window: ${start.toISOString()} → ${end.toISOString()}`);

// ── 1. health ─────────────────────────────────────────────────────────────
banner("1. health()");
const health = await healthCheck();
console.log(JSON.stringify(health.result, null, 2));

const enabledSources = Object.entries(health.result)
  .filter(([, ok]) => ok)
  .map(([name]) => name);

// ── 2. tool registration ──────────────────────────────────────────────────
banner("2. tool registration");
YantraSpendMcpServer.ResetForTests();
const server = YantraSpendMcpServer.GetServer();
const registered = [];
const original = server.tool.bind(server);
// ToolFactory uses two call shapes: 4-arg (no annotations) or 5-arg
// (name, description, schema, annotations, handler).
server.tool = (name, description, schema, ...rest) => {
  registered.push({
    name,
    description_first_120: description.slice(0, 120),
    schema_keys: Object.keys(schema),
  });
  return original(name, description, schema, ...rest);
};
ToolFactory(server);
console.log(JSON.stringify(registered, null, 2));
console.log(`tool count: ${registered.length}`);

// ── 3. per-source ungrouped + grouped ─────────────────────────────────────
const DEFAULT_GROUPING = {
  aws: "service",
  azure: "service",
  anthropic: "description",
  openai: "line_item",
  cursor: "user",
};

for (const sourceName of enabledSources) {
  banner(`3.${sourceName} — spend_by_source`);
  const ungrouped = await spendBySource({
    source: sourceName,
    start,
    end,
    currency: "USD",
  });
  console.log(`ungrouped ${sourceName}:`, ungrouped.isError ? `ERROR ${ungrouped.error}` : summarise(ungrouped.result.lines));
  if (!ungrouped.isError && ungrouped.result.warnings.length) {
    console.log(" warnings:", ungrouped.result.warnings);
  }

  const groupAxis = DEFAULT_GROUPING[sourceName];
  if (groupAxis) {
    const grouped = await spendBySource({
      source: sourceName,
      start,
      end,
      group_by: groupAxis,
      currency: "USD",
    });
    console.log(
      `grouped ${sourceName} by ${groupAxis}:`,
      grouped.isError ? `ERROR ${grouped.error}` : summarise(grouped.result.lines),
    );
    if (!grouped.isError && grouped.result.warnings.length) {
      console.log(" warnings:", grouped.result.warnings);
    }
    // Print top 5 lines (sorted by amount desc) for visibility.
    if (!grouped.isError) {
      const top = [...grouped.result.lines]
        .sort((a, b) => b.amount_usd - a.amount_usd)
        .slice(0, 5)
        .map((l) => ({
          period_start: l.period_start,
          group_by_value: l.group_by_value,
          amount_usd: l.amount_usd,
        }));
      console.log(" top 5 grouped lines:", top);
    }
  }
}

// ── 4. spend_summary USD ──────────────────────────────────────────────────
banner("4. spend_summary USD");
const summaryUsd = await spendSummary({ start, end, currency: "USD" });
console.log(JSON.stringify(summaryUsd.result, null, 2));

// ── 5. spend_summary GBP ──────────────────────────────────────────────────
banner("5. spend_summary GBP");
const summaryGbp = await spendSummary({ start, end, currency: "GBP" });
console.log(JSON.stringify(summaryGbp, null, 2));

// ── 6. top_movers ─────────────────────────────────────────────────────────
banner("6. top_movers");
const movers = await topMovers({ start, end, limit: 5, currency: "USD" });
console.log(JSON.stringify(movers.result, null, 2));

// ── 7. anomalies (AWS-only when wired) ────────────────────────────────────
banner("7. anomalies");
const anom = await anomalies({ window_days: 7 });
console.log(JSON.stringify(anom.result, null, 2));

// ── 8. forecast (AWS, Azure when wired) ───────────────────────────────────
banner("8. forecast_month_end");
const forecast = await forecastMonthEnd({ currency: "USD" });
console.log(JSON.stringify(forecast.result, null, 2));

banner("smoke complete");
