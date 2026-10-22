import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const RenewMdmProfileTool = CreateKandjiTool(
  "renew_mdm_profile",
  "Idempotent: requests the device to refresh its MDM enrolment profile — useful when an MDM cert is approaching expiry or the enrolment trust chain is broken. Sends POST /devices/{id}/action/renewmdmprofile. No user-visible effect on success. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await triggerDeviceAction(device_id, "renewmdmprofile");
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
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
);

export default RenewMdmProfileTool;
