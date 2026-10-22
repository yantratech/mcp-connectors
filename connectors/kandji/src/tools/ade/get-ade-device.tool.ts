import { KandjiId } from "../../helpers/kandji-id.js";
import { getAdeDevice } from "../../handlers/ade.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetAdeDeviceTool = CreateKandjiTool(
  "get_ade_device",
  "Get a single ADE device by its ADE-side ID — the record Apple sends during enrollment, not the MDM-side device ID.",
  {
    ade_device_id: KandjiId.describe("The ADE-side device ID"),
  },
  async ({ ade_device_id }) => {
    const response = await getAdeDevice(ade_device_id);
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

export default GetAdeDeviceTool;
