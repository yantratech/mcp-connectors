import { getLicensing } from "../../handlers/get-licensing.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetLicensingTool = CreateKandjiTool(
  "get_licensing",
  "Get the tenant's license entitlements — device seat count, EDR add-on, Vulnerability Management, region, and renewal dates.",
  {},
  async () => {
    const response = await getLicensing();
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
);

export default GetLicensingTool;
