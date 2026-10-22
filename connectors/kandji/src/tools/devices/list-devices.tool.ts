import { z } from "zod";
import { KandjiFilterId } from "../../helpers/kandji-id.js";
import { listDevices } from "../../handlers/list-devices.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListDevicesTool = CreateKandjiTool(
  "list_devices",
  "List devices enrolled in Kandji. Returns device ID, serial number, model, OS version, blueprint, assigned user, and last_check_in — note last_check_in is the Kandji AGENT's check-in clock; MDM check-in is a separate clock (get_device_details → mdm.last_check_in) and the two can differ by minutes. is_missing is a Kandji-managed flag, not proof of a recent check-in (devices weeks stale can still show is_missing: false). Auto-paginates; use max_results to cap large fleets (a capped response says truncated: true — its count is NOT the fleet size). Filter by platform, blueprint, serial, asset tag, user email, or FileVault state.",
  {
    platform: z
      .enum(["Mac", "iPhone", "iPad", "AppleTV", "VisionPro", "Windows"])
      .optional()
      .describe(
        "Filter by platform. Case- and spelling-sensitive — must be exactly one of: Mac, iPhone, iPad, AppleTV, VisionPro, Windows. (Windows devices appear in tenants using Kandji's Windows/Iru agent.)",
      ),
    blueprint_id: KandjiFilterId.optional().describe("Filter by blueprint ID"),
    serial_number: z
      .string()
      .optional()
      .describe("Filter by exact serial number"),
    asset_tag: z.string().optional().describe("Filter by exact asset tag"),
    user_email: z
      .string()
      .optional()
      .describe("Filter by assigned user email"),
    filevault_enabled: z
      .boolean()
      .optional()
      .describe("Filter macOS devices by FileVault enabled state"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total devices returned across all pages"),
  },
  async ({
    platform,
    blueprint_id,
    serial_number,
    asset_tag,
    user_email,
    filevault_enabled,
    max_results,
  }) => {
    const response = await listDevices(
      {
        platform,
        blueprintId: blueprint_id,
        serialNumber: serial_number,
        assetTag: asset_tag,
        userEmail: user_email,
        filevaultEnabled: filevault_enabled,
      },
      max_results,
    );

    if (response.isError) {
      return renderToolError(response);
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
      ],
    };
  },
);

export default ListDevicesTool;
