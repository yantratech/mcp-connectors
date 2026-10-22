import { z } from "zod";

/**
 * Tracking on a manual-journal line. Xero identifies the category and option
 * by name; the IDs are optional (Xero resolves by name when they are absent).
 * Names and IDs come from list_tracking_categories.
 */
export const manualJournalTrackingSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Tracking category name, e.g. 'Region'. Can be obtained from the list_tracking_categories tool.",
    ),
  option: z
    .string()
    .min(1)
    .describe(
      "Tracking option name within that category, e.g. 'North'. Can be obtained from the list_tracking_categories tool.",
    ),
  trackingCategoryID: z
    .string()
    .guid("trackingCategoryID must be a valid Xero GUID")
    .optional()
    .describe("Optional ID of the tracking category (from list_tracking_categories)."),
  trackingOptionID: z
    .string()
    .guid("trackingOptionID must be a valid Xero GUID")
    .optional()
    .describe("Optional ID of the tracking option (from list_tracking_categories)."),
});

/**
 * One manual-journal line, shared by create_manual_journal and
 * update_manual_journal so both accept the same shape.
 */
export const manualJournalLineSchema = z.object({
  lineAmount: z
    .number()
    .describe(
      "Total for manual journal line. Debits are positive, credits are negative value",
    ),
  accountCode: z.string().describe("Account code for the journal line"),
  description: z
    .string()
    .optional()
    .describe("Optional description for manual journal line"),
  taxType: z
    .string()
    .optional()
    .describe("Optional tax type for the manual journal line"),
  tracking: z
    .array(manualJournalTrackingSchema)
    .max(2, "A manual journal line can carry at most 2 tracking categories")
    .refine((tracking) => {
      const names = tracking.map((t) => t.name.trim().toLowerCase());
      const ids = tracking
        .map((t) => t.trackingCategoryID?.toLowerCase())
        .filter((id): id is string => id !== undefined);
      return (
        new Set(names).size === names.length && new Set(ids).size === ids.length
      );
    }, "Each tracking category may appear only once per manual journal line")
    .optional()
    .describe(
      "Optional tracking for the line: up to 2 tracking categories, each with one option. \
      Set it only if prompted by the user, or to preserve tracking the line already has \
      (update_manual_journal replaces lines wholesale, so omitting it clears existing tracking).",
    ),
});
