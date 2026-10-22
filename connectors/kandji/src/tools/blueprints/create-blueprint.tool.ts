import { z } from "zod";
import { KandjiId } from "../../helpers/kandji-id.js";
import { createBlueprint } from "../../handlers/blueprint-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const CreateBlueprintTool = CreateKandjiTool(
  "create_blueprint",
  "Create a new blueprint — the unit of fleet configuration that bundles library items, enrolment settings, and a default device assignment. Sends POST /blueprints with the supplied name and optional description. Optionally clones from one of Kandji's curated templates (run list_blueprint_templates to find a template_id) or from another existing blueprint by setting source_type+source_id; the resulting blueprint is pre-populated with that source's library items. Returns the created blueprint record including its new ID. Use list_blueprints first to avoid duplicating an existing one. NOTE: type='classic' is currently broken upstream (Kandji returns HTTP 500); use type='map' until that is resolved.",
  {
    name: z.string().min(1).describe("Blueprint name (must be unique)"),
    description: z
      .string()
      .optional()
      .describe("Optional human-readable description"),
    type: z
      .enum(["classic", "map"])
      .optional()
      .describe(
        "Blueprint type. Defaults to 'map' here because creating a 'classic' blueprint currently 500s upstream on Kandji's side (and the server-side default also resolves to classic, which 500s). Pass 'classic' explicitly only if you've confirmed Kandji has fixed the upstream bug.",
      ),
    template_id: z.union([KandjiId, z.number()])
      .optional()
      .describe(
        "Convenience: clone from a curated template. Equivalent to source_type='template' + source_id=<this>. Use list_blueprint_templates to discover IDs. Mutually exclusive with source_*; if both are supplied, source_* wins.",
      ),
    source_type: z
      .enum(["template", "blueprint"])
      .optional()
      .describe(
        "Set together with source_id to clone from a curated template ('template') or another existing blueprint ('blueprint'). When type='map' and source_type='blueprint', the source blueprint must also be a map.",
      ),
    source_id: z.union([KandjiId, z.number()])
      .optional()
      .describe(
        "ID of the template or blueprint to clone from. Required when source_type is set.",
      ),
    enrollment_code_is_active: z
      .boolean()
      .optional()
      .describe(
        "Toggle the manual-enrollment portal for this blueprint. Defaults to true (the API actually requires this flag and rejects requests without it).",
      ),
    enrollment_code: z
      .string()
      .optional()
      .describe(
        "Optional explicit 6-digit numeric enrollment code (e.g. '123456'). If omitted, Kandji generates one server-side and returns it on the response.",
      ),
  },
  async ({
    name,
    description,
    type,
    template_id,
    source_type,
    source_id,
    enrollment_code_is_active,
    enrollment_code,
  }) => {
    const payload: Record<string, unknown> = { name };
    if (description !== undefined) payload.description = description;
    // Default to 'map' — see schema description; classic 500s upstream.
    payload.type = type ?? "map";

    // enrollment_code is a nested object the API parses from form-encoded
    // dotted keys (`enrollment_code.is_active=true`). The client adds the
    // is_active default if we don't, but we set it here too so the payload
    // we hand off is complete and self-describing.
    const ec: Record<string, unknown> = {
      is_active: enrollment_code_is_active ?? true,
    };
    if (enrollment_code !== undefined) ec.code = enrollment_code;
    payload.enrollment_code = ec;

    // source.{type,id} clones a template or another blueprint. Guard on the
    // RAW source_* pair BEFORE consulting the template_id shorthand: letting
    // template_id fill in a missing half would clone the WRONG source (e.g.
    // source_type:'blueprint' + template_id → clones a blueprint by the
    // template's id) — silent misdirection, worse than the silent drop this
    // guard replaced. A half-specified pair always fails loudly.
    if ((source_type === undefined) !== (source_id === undefined)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              "Error: cloning requires BOTH source_type and source_id (or template_id alone). " +
              `Got source_type=${JSON.stringify(source_type)} and source_id=${JSON.stringify(source_id)} — ` +
              "refusing to guess the missing half (template_id is not used to fill it).",
          },
        ],
      };
    }
    // Full source_* pair wins over template_id (documented precedence);
    // template_id applies only when BOTH source_* fields are absent.
    if (source_type !== undefined && source_id !== undefined) {
      payload.source = { type: source_type, id: source_id };
    } else if (template_id !== undefined) {
      payload.source = { type: "template", id: template_id };
    }

    const response = await createBlueprint(payload);
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
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
);

export default CreateBlueprintTool;
