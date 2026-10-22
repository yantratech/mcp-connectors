import { ManualJournalLine } from "xero-node";

/**
 * Manual-journal line amounts use Xero's sign convention: positive = debit,
 * negative = credit (the same convention the posted ledger's netAmount uses).
 * Render the explicit Dr/Cr split — mirroring formatJournalLine in
 * list_journals — so agents never have to guess which side a signed amount
 * sits on.
 */
export const formatManualJournalLineDrCr = (line: ManualJournalLine): string => {
  const amount = line.lineAmount ?? 0;
  return `Dr:${amount > 0 ? amount : 0} Cr:${amount < 0 ? Math.abs(amount) : 0}`;
};

/**
 * Renders a manual-journal line's tracking as "Region: North, Dept: Sales",
 * or null when the line carries none (so callers can drop the row).
 */
export const formatManualJournalLineTracking = (
  line: ManualJournalLine,
): string | null => {
  if (!line.tracking || line.tracking.length === 0) {
    return null;
  }
  return line.tracking
    .map(
      (tracking) =>
        `${tracking.name ?? "Unknown category"}: ${tracking.option ?? "Unknown option"}`,
    )
    .join(", ");
};

/**
 * The tracking as a display row (`${label}Region: North, ...`), or null when
 * the line has none, so list-style renderers can `.filter(Boolean)` it away.
 */
export const formatManualJournalLineTrackingRow = (
  line: ManualJournalLine,
  label: string = "Tracking: ",
): string | null => {
  const tracking = formatManualJournalLineTracking(line);
  return tracking === null ? null : `${label}${tracking}`;
};
