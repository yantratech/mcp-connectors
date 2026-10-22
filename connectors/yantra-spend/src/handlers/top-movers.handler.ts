import { gbpPerUsd, roundCurrency, usdToGbp } from "../fx/fx.js";
import { allSources } from "../sources/registry.js";
import { SourceModule } from "../sources/source-module.js";
import { Currency, Source, TopMover } from "../types/cost-line.js";
import { YantraSpendClientResponse } from "../types/client-response.js";
import { formatError } from "../helpers/format-error.js";

export interface TopMoversArgs {
  start: Date;
  end: Date;
  limit: number;
  currency: Currency;
}

const DEFAULT_GROUP_BY: Record<Source, string | undefined> = {
  aws: "service",
  gcp: undefined, // not supported
  azure: "service",
  // Anthropic accepts only workspace_id|description as group_by axes — use
  // description so movers surface per-model and per-cost-type rows.
  anthropic: "description",
  openai: "line_item",
  // Cursor: "user" surfaces per-engineer attribution, the central reason
  // this connector wraps Cursor at all.
  cursor: "user",
};

export async function topMovers(
  args: TopMoversArgs,
): Promise<
  YantraSpendClientResponse<{ warnings: string[]; movers: TopMover[] }>
> {
  try {
    const span = args.end.getTime() - args.start.getTime();
    if (span <= 0) {
      return {
        isError: true,
        error: "top_movers: end must be strictly greater than start",
      };
    }
    const priorStart = new Date(args.start.getTime() - span);
    const priorEnd = new Date(args.start.getTime());
    const fxRate = args.currency === "GBP" ? await gbpPerUsd() : undefined;
    const sources = allSources().filter((source) => source.isAvailable());

    const warnings: string[] = [];
    const pairs = await Promise.all(
      sources.map(async (source) => {
        const groupBy = DEFAULT_GROUP_BY[source.name];
        try {
          const [current, prior] = await Promise.all([
            source.getCostLines(args.start, args.end, groupBy),
            source.getCostLines(priorStart, priorEnd, groupBy),
          ]);
          return { source, current, prior };
        } catch (err) {
          warnings.push(`${source.name}: ${formatError(err)}`);
          return { source, current: [], prior: [] };
        }
      }),
    );

    const movers: TopMover[] = [];
    for (const { source, current, prior } of pairs) {
      movers.push(...computeMovers(source, current, prior, fxRate));
    }
    movers.sort((a, b) => b.delta_usd - a.delta_usd);
    // warnings serialize before the movers array (signal-first convention).
    return {
      isError: false,
      result: { warnings, movers: movers.slice(0, args.limit) },
    };
  } catch (err) {
    return { isError: true, error: formatError(err) };
  }
}

function computeMovers(
  source: SourceModule,
  current: Array<{ group_by_value?: string | null; amount_usd: number }>,
  prior: Array<{ group_by_value?: string | null; amount_usd: number }>,
  fxRate?: number,
): TopMover[] {
  const sumByLabel = (
    rows: Array<{ group_by_value?: string | null; amount_usd: number }>,
  ): Map<string, number> => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const label = row.group_by_value ?? "(unlabeled)";
      map.set(label, (map.get(label) ?? 0) + row.amount_usd);
    }
    return map;
  };
  const cur = sumByLabel(current);
  const old = sumByLabel(prior);
  const movers: TopMover[] = [];
  for (const [label, amount] of cur) {
    const priorAmount = old.get(label) ?? 0;
    const delta = amount - priorAmount;
    if (delta <= 0) continue;
    // null when prior was zero — there's no defined % change without a
    // baseline. Avoids leaking Infinity (which JSON-serialises to null and
    // breaks the typed `number` contract).
    const pct =
      priorAmount > 0
        ? roundCurrency(((amount - priorAmount) / priorAmount) * 100)
        : null;
    movers.push({
      source: source.name,
      label: `${source.name}: ${label}`,
      delta_usd: roundCurrency(delta),
      delta_gbp: fxRate !== undefined ? usdToGbp(delta, fxRate) : undefined,
      pct_change: pct,
      current_period_usd: roundCurrency(amount),
      prior_period_usd: roundCurrency(priorAmount),
    });
  }
  return movers;
}
