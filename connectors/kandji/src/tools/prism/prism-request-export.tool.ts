import { z } from "zod";
import { KandjiId } from "../../helpers/kandji-id.js";
import { requestPrismExport } from "../../handlers/prism-export.handler.js";
import { PRISM_CATEGORIES } from "../../clients/kandji-client.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const PrismRequestExportTool = CreateKandjiTool(
  "prism_request_export",
  "Request an async CSV export of a Prism category — returns an export_id. Poll with prism_get_export until status transitions to completed, then read the download path. Use this instead of the inline prism-* tools when a category is too large to fit in a single response (e.g. fleet-wide apps). REQUIRED: device_families (which device classes to include) and blueprint_ids (which blueprints to scope to; defaults to all blueprints).",
  {
    category: z
      .enum(PRISM_CATEGORIES)
      .describe(
        "Prism category to export — one of the 16 known categories (e.g. 'apps', 'filevault', 'device_information').",
      ),
    device_families: z
      .array(z.enum(["Mac", "iPhone", "iPad", "AppleTV", "VisionPro"]))
      .min(1)
      .describe(
        "Required. Device families to include — Kandji's API rejects the request without this.",
      ),
    blueprint_ids: z.array(KandjiId)
      .default(["*"])
      .describe(
        "Required. Blueprint IDs to scope the export to. Use ['*'] (the default) to mean all blueprints.",
      ),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Optional additional filter args passed through to the export job. Must NOT contain category, device_families, or blueprint_ids — pass those as the dedicated top-level parameters (a collision is rejected).",
      ),
  },
  async ({ category, device_families, blueprint_ids, filters }) => {
    // Reserved keys collide with the validated top-level parameters. Any
    // precedence rule here is silently wrong for someone: filters-wins lets a
    // passthrough bypass validation; params-win lets the blueprint_ids
    // DEFAULT (["*"]) clobber an explicit filters.blueprint_ids and widen a
    // scoped export to the whole fleet. Reject the collision loudly instead.
    const reserved = ["category", "device_families", "blueprint_ids"].filter(
      (k) => filters !== undefined && k in filters,
    );
    if (reserved.length > 0) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error: filters must not contain ${reserved.join(", ")} — pass ${reserved.length === 1 ? "it" : "them"} as the dedicated top-level parameter${reserved.length === 1 ? "" : "s"} instead.`,
          },
        ],
      };
    }
    const response = await requestPrismExport(category, {
      ...(filters ?? {}),
      device_families,
      blueprint_ids,
    });
    if (response.isError) {
      return renderToolError(response);
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
  // POSTs /prism/export, creating a new server-side export job per call —
  // a write (so not readOnly), non-destructive (creates, never overwrites or
  // deletes), and not idempotent (each call spawns a fresh job). This must
  // stay explicit: the `prism_` name prefix would otherwise infer readOnly.
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
);

export default PrismRequestExportTool;
