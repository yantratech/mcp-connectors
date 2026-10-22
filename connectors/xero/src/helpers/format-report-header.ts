import { ReportWithRow } from "xero-node";

/**
 * Shared header for report tools.
 *
 * Xero's `reportDate` field is the report GENERATION date (always "today"),
 * NOT the reporting period. The true period is only carried inside
 * `reportTitles` (e.g. "As at 31 March 2026", "From 1 January 2026 to
 * 31 March 2026"), so the titles must lead the output and the generation
 * date must never be labelled "Date" / "Date Range".
 */
export function formatReportHeader(
  report:
    | Pick<
        ReportWithRow,
        "reportName" | "reportTitles" | "reportDate" | "updatedDateUTC"
      >
    | null
    | undefined,
  options?: { showBasis?: boolean; paymentsOnly?: boolean },
): string {
  const titles = (report?.reportTitles ?? []).filter(Boolean);
  const lines: string[] = [
    titles.length > 0
      ? `Report: ${titles.join(" | ")}`
      : `Report: ${report?.reportName ?? "Unnamed"} (Xero returned no report titles — reporting period not stated)`,
  ];
  if (options?.showBasis) {
    lines.push(
      options.paymentsOnly
        ? "Basis: cash (paymentsOnly=true — only cash/payment transactions are included)"
        : "Basis: accrual (Xero default; set paymentsOnly=true for cash basis)",
    );
  }
  lines.push(
    `Generated: ${report?.reportDate ?? "Unknown"} (when Xero produced this report — NOT the reporting period; the period is on the Report line above)`,
  );
  if (report?.updatedDateUTC) {
    lines.push(`Updated At: ${new Date(report.updatedDateUTC).toISOString()}`);
  }
  return lines.join("\n");
}
