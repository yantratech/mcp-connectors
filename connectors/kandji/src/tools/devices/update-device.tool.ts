import { z } from "zod";
import { KandjiId, KandjiUuid, UUID_RE } from "../../helpers/kandji-id.js";
import { updateDevice } from "../../handlers/update-device.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

// Kandji identifies a user by UUID (current) or a legacy positive integer.
// Anything else — emails, display names, and above all the "clear" sentinels
// agents invent ("null", "NONE", "0", "") — must fail HERE with a message
// that names the real clear mechanism. The API's own responses to those
// values are misleading (400 "User_id should be int or UUID", 404 "User not
// found"), and a value dropped by a middle layer becomes a silent no-op:
// the caller believes the owner changed when nothing was sent.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const isValidUserId = (v: string): boolean =>
  (UUID_RE.test(v) && v.toLowerCase() !== NIL_UUID) || /^[1-9]\d*$/.test(v);

// Literal strings that only ever appear when a caller is trying to express
// "clear this field" through a string-typed parameter. The nil UUID is the
// same intent in UUID clothing.
const CLEAR_SENTINELS = new Set(["null", "none", "nil", "undefined", "0", ""]);
const isClearSentinel = (v: string): boolean => {
  const t = v.trim().toLowerCase();
  return CLEAR_SENTINELS.has(t) || t === NIL_UUID;
};

const toolError = (text: string) => ({
  isError: true,
  content: [{ type: "text" as const, text }],
});

const UpdateDeviceTool = CreateKandjiTool(
  "update_device",
  "Update a device record in Kandji: asset tag, blueprint assignment, assigned user, or tags. \
HIGH IMPACT — reassigning blueprint_id causes the device to receive a different config bundle: profiles \
install/remove, apps push, passcode policies change. Asset tag, user-assignment, and tag changes are safe. \
Use list_devices first to find the device ID. The `user` field is a Kandji user ID (the `id` from \
list_users), not an email or display name. \
CLEARING FIELDS: to unassign the user pass user: null (JSON null) or clear_user: true; to clear the \
asset tag pass asset_tag: null or clear_asset_tag: true; to remove all tags pass tags: [] or \
clear_tags: true. String values like \"null\", \"none\", or \"0\" are rejected — they are never sent to the API.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID to update"),
    asset_tag: z
      .string()
      .nullable()
      .optional()
      .describe(
        "New asset tag for the device. Pass JSON null (or clear_asset_tag: true) to clear it.",
      ),
    blueprint_id: KandjiId.optional()
      .describe("Blueprint ID to assign the device to"),
    user: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Kandji user ID to assign the device to (the `id` from list_users — a UUID or legacy integer, not an email or name). Pass JSON null (or clear_user: true) to unassign the current user.",
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        "Full replacement list of tag names (tags must already exist — see list_tags / create_tag). Pass [] (or clear_tags: true) to remove all tags from the device.",
      ),
    clear_user: z
      .boolean()
      .optional()
      .describe(
        "Set true to unassign the device's user. Equivalent to user: null.",
      ),
    clear_asset_tag: z
      .boolean()
      .optional()
      .describe(
        "Set true to clear the device's asset tag. Equivalent to asset_tag: null.",
      ),
    clear_tags: z
      .boolean()
      .optional()
      .describe("Set true to remove all tags. Equivalent to tags: []."),
  },
  async ({
    device_id,
    asset_tag,
    blueprint_id,
    user,
    tags,
    clear_user,
    clear_asset_tag,
    clear_tags,
  }) => {
    const payload: Record<string, unknown> = {};

    // --- user ---------------------------------------------------------
    if (clear_user && user !== undefined && user !== null) {
      return toolError(
        "Error: conflicting arguments — clear_user is true but a user value was also provided. Pass one or the other.",
      );
    }
    if (clear_user || user === null) {
      payload.user = null;
    } else if (user !== undefined) {
      if (!isValidUserId(user)) {
        if (isClearSentinel(user)) {
          return toolError(
            `Error: user ${JSON.stringify(user)} looks like an attempt to CLEAR the assigned user. ` +
              "To unassign, pass user: null (JSON null) or clear_user: true. " +
              "String sentinels are rejected because the API would 400/404 on them — or a dropped value would silently change nothing.",
          );
        }
        return toolError(
          `Error: user ${JSON.stringify(user)} is not a Kandji user ID. ` +
            "Expected a UUID or legacy positive-integer ID — the `id` field from list_users, not an email or display name.",
        );
      }
      payload.user = user;
    }

    // --- asset_tag ----------------------------------------------------
    if (clear_asset_tag && asset_tag !== undefined && asset_tag !== null) {
      return toolError(
        "Error: conflicting arguments — clear_asset_tag is true but an asset_tag value was also provided. Pass one or the other.",
      );
    }
    if (clear_asset_tag || asset_tag === null) {
      payload.asset_tag = null;
    } else if (asset_tag !== undefined) {
      if (isClearSentinel(asset_tag)) {
        return toolError(
          `Error: asset_tag ${JSON.stringify(asset_tag)} looks like an attempt to CLEAR the asset tag. ` +
            "To clear it, pass asset_tag: null (JSON null) or clear_asset_tag: true. " +
            "This tool never forwards the literal strings \"null\"/\"none\"/\"0\"/\"\" as an asset tag.",
        );
      }
      payload.asset_tag = asset_tag;
    }

    // --- tags ---------------------------------------------------------
    if (clear_tags && tags !== undefined && tags.length > 0) {
      return toolError(
        "Error: conflicting arguments — clear_tags is true but a non-empty tags list was also provided. Pass one or the other.",
      );
    }
    if (clear_tags) {
      payload.tags = [];
    } else if (tags !== undefined) {
      // [] is meaningful: it clears every tag. A non-empty array replaces
      // the device's tag set wholesale.
      payload.tags = tags;
    }

    // --- blueprint ----------------------------------------------------
    // A device ALWAYS belongs to a blueprint — there is no "clear" for this
    // field, so a sentinel here is pure confusion; reject it with that fact
    // rather than forwarding a string Kandji will 400/404 on.
    if (blueprint_id !== undefined) {
      if (isClearSentinel(blueprint_id)) {
        return toolError(
          `Error: blueprint_id ${JSON.stringify(blueprint_id)} looks like an attempt to detach the blueprint. ` +
            "Devices always belong to a blueprint in Kandji — it cannot be cleared, only reassigned to another blueprint_id (see list_blueprints).",
        );
      }
      payload.blueprint_id = blueprint_id;
    }

    if (Object.keys(payload).length === 0) {
      return toolError(
        "Error: nothing to update — provide at least one of asset_tag, blueprint_id, user, tags, or a clear_* flag",
      );
    }

    const response = await updateDevice(device_id, payload);

    if (response.isError) {
      return renderToolError(response);
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
      ],
    };
  },
  // Reassigning blueprint_id is a high-impact device action (config bundle
  // swap, profile install/remove, app push), so flag destructive even though
  // the underlying HTTP PATCH itself is additive. Clients should gate.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default UpdateDeviceTool;
