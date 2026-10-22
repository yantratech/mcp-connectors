import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getBlueprintOtaEnrollmentProfile } from "../../handlers/get-blueprint.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetBlueprintOtaEnrollmentProfileTool = CreateKandjiTool(
  "get_blueprint_ota_enrollment_profile",
  "Fetch the manual (OTA) enrollment profile for a blueprint — the .mobileconfig a Mac downloads from the enrollment portal to enrol into MDM. Idempotent read of GET /blueprints/{blueprint_id}/ota-enrollment-profile. By default returns { content_type, filename, encoding: 'base64', note, mobileconfig_base64 } — the profile is a signed CMS/PKCS#7 BINARY blob, so it is base64-encoded; decode it to raw bytes and save as the .mobileconfig file (it is not XML text, and it embeds the tenant's OTA enrollment challenge secret). With sso=true, returns the JSON {url, ...} that points at the SSO auth flow for blueprints requiring authentication. Use this to re-enrol a wiped/erased device without touching the Kandji web UI.",
  {
    blueprint_id: KandjiUuid.describe("The Kandji blueprint ID"),
    sso: z
      .boolean()
      .optional()
      .describe(
        "If the blueprint requires SSO authentication, request the SSO URL JSON instead of the raw mobileconfig. If the blueprint doesn't require auth, the mobileconfig is returned regardless.",
      ),
  },
  async ({ blueprint_id, sso }) => {
    const response = await getBlueprintOtaEnrollmentProfile(blueprint_id, sso);
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
  { readOnlyHint: true, idempotentHint: true },
);

export default GetBlueprintOtaEnrollmentProfileTool;
