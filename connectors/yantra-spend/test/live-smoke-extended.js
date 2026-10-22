/**
 * Extended live smoke. Beyond the basic live-smoke.js driver, this exercises:
 *
 *   - The group_by axes in AXES_PER_SOURCE for each enabled source (AWS tag
 *     axes and Azure resource/meter are not included)
 *   - A 30-day Cursor window (the admin API's per-call maximum), printing
 *     per-user totals to compare with the Cursor dashboard by hand
 *   - 31-day window: Cursor's 30-day per-call cap is auto-chunked, so the
 *     call succeeds
 *   - Sum-of-parts consistency: spend_summary per-source totals must equal
 *     spend_by_source(source).lines summed independently
 *   - Edge cases: invalid date input, future-only window, single-day window
 *
 * Read-only: it only calls the providers' cost-reporting endpoints. Run after
 * the basic live-smoke.js passes. Reads creds from
 * connectors/yantra-spend/.env via dotenv (gitignored).
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });

const { healthCheck } = await import("../dist/handlers/health.handler.js");
const { spendBySource } = await import(
  "../dist/handlers/spend-by-source.handler.js"
);
const { spendSummary } = await import(
  "../dist/handlers/spend-summary.handler.js"
);

function banner(t) {
  console.log(`\n${"=".repeat(72)}\n${t}\n${"=".repeat(72)}`);
}

function summarise(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { count: 0, total_usd: 0 };
  }
  const total = lines.reduce((acc, l) => acc + l.amount_usd, 0);
  const labels = new Set(lines.map((l) => l.group_by_value).filter(Boolean));
  return {
    count: lines.length,
    total_usd: Math.round(total * 10000) / 10000,
    distinct_groups: labels.size,
  };
}

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const end = today;
const start7 = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
const start30 = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
const start31 = new Date(end.getTime() - 31 * 24 * 60 * 60 * 1000);
const start1 = new Date(end.getTime() - 1 * 24 * 60 * 60 * 1000);
// Future window: tomorrow → 8 days from now.
const futureStart = new Date(end.getTime() + 1 * 24 * 60 * 60 * 1000);
const futureEnd = new Date(end.getTime() + 8 * 24 * 60 * 60 * 1000);

const health = (await healthCheck()).result;
const enabled = Object.entries(health)
  .filter(([, ok]) => ok)
  .map(([name]) => name);
console.log("enabled sources:", enabled);

// ── 1. group_by axes per source ───────────────────────────────────────────
const AXES_PER_SOURCE = {
  aws: ["service", "region", "account", "usage_type"],
  azure: ["service", "resource_group", "subscription"],
  anthropic: ["workspace_id", "description"],
  openai: ["project_id", "line_item", "api_key_id"],
  cursor: ["user", "model", "kind"],
};

banner("1. group_by axes per enabled source (7-day window)");
for (const source of enabled) {
  if (!AXES_PER_SOURCE[source]) continue;
  for (const axis of AXES_PER_SOURCE[source]) {
    const r = await spendBySource({
      source,
      start: start7,
      end,
      group_by: axis,
      currency: "USD",
    });
    if (r.isError) {
      console.log(`  ${source}.${axis}: ERROR ${r.error}`);
      continue;
    }
    const s = summarise(r.result.lines);
    const top = [...r.result.lines]
      .sort((a, b) => b.amount_usd - a.amount_usd)
      .slice(0, 3)
      .map((l) => `${l.group_by_value}:$${l.amount_usd}`);
    console.log(
      `  ${source}.${axis}: lines=${s.count} groups=${s.distinct_groups} total=$${s.total_usd} top3=${top.join(", ")}`,
    );
  }
}

// ── 2. internal consistency: spend_summary vs sum-of spend_by_source ──────
banner("2. spend_summary vs sum-of spend_by_source (7-day, ungrouped)");
const summary = (
  await spendSummary({ start: start7, end, currency: "USD" })
).result;
for (const source of enabled) {
  const r = (
    await spendBySource({ source, start: start7, end, currency: "USD" })
  ).result;
  const summed = r.lines.reduce((a, l) => a + l.amount_usd, 0);
  const summedR = Math.round(summed * 10000) / 10000;
  const fromSummary = summary.sources.find((s) => s.source === source);
  const ok = Math.abs(summed - (fromSummary?.amount_usd ?? 0)) < 0.005;
  console.log(
    `  ${source}: by-source=$${summedR}, summary=$${fromSummary?.amount_usd ?? 0} ${ok ? "✓" : "✗ MISMATCH"}`,
  );
}

// ── 3. Cursor wide window (30 days) ───────────────────────────────────────
if (enabled.includes("cursor")) {
  banner("3. Cursor 30-day window (admin API max range)");
  const r30 = await spendBySource({
    source: "cursor",
    start: start30,
    end,
    group_by: "user",
    currency: "USD",
  });
  if (r30.isError) {
    console.log(`  ERROR: ${r30.error}`);
  } else {
    const s = summarise(r30.result.lines);
    console.log(`  30d cursor: lines=${s.count} groups=${s.distinct_groups} total=$${s.total_usd}`);
    // Print top users
    const byUser = new Map();
    for (const l of r30.result.lines) {
      const k = l.group_by_value ?? "(unknown)";
      byUser.set(k, (byUser.get(k) ?? 0) + l.amount_usd);
    }
    const ranked = [...byUser.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    console.log("  top 8 users (30d):");
    for (const [user, amt] of ranked) {
      console.log(`    ${user.padEnd(40)} $${amt.toFixed(2)}`);
    }
  }

  banner("4. Cursor 31-day window (auto-chunked past the 30-day cap)");
  const r31 = await spendBySource({
    source: "cursor",
    start: start31,
    end,
    currency: "USD",
  });
  if (r31.isError) {
    console.log(`  ERROR (expected success via chunking): ${r31.error}`);
  } else {
    const s = summarise(r31.result.lines);
    console.log(`  31d cursor: lines=${s.count} total=$${s.total_usd}`);
  }
}

function unwrapOrLog(label, response) {
  if (response.isError) {
    console.log(`  ${label}: ERROR ${response.error}`);
    return null;
  }
  return response.result;
}

// ── 5. single-day window ──────────────────────────────────────────────────
banner("5. single-day window (yesterday only)");
for (const source of enabled) {
  const r = unwrapOrLog(
    `${source} (yesterday)`,
    await spendBySource({
      source,
      start: start1,
      end,
      currency: "USD",
    }),
  );
  if (r) {
    const s = summarise(r.lines);
    console.log(
      `  ${source} (yesterday): lines=${s.count} total=$${s.total_usd}`,
    );
  }
}

// ── 6. future-only window (should be empty / skip) ────────────────────────
banner("6. future-only window (tomorrow → +7d)");
for (const source of enabled) {
  const r = unwrapOrLog(
    `${source} (future)`,
    await spendBySource({
      source,
      start: futureStart,
      end: futureEnd,
      currency: "USD",
    }),
  );
  if (r) {
    const s = summarise(r.lines);
    console.log(
      `  ${source} (future): lines=${s.count} total=$${s.total_usd}`,
    );
  }
}

// ── 7. invalid date input ─────────────────────────────────────────────────
banner("7. invalid date input — handler-level reverse window");
const reversed = await spendSummary({ start: end, end: start7, currency: "USD" });
console.log("  reversed window:", reversed);

const unknown = await spendBySource({
  source: "made-up",
  start: start7,
  end,
  currency: "USD",
});
console.log("  unknown source:", unknown);

banner("extended smoke complete");
