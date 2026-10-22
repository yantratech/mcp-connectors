import { z } from "zod";
import { updateRiskRegister } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const UpdateRiskRegisterTool = CreateDrataTool(
  "update_risk_register",
  "Update an existing risk register (V2). Requires Drata Risk Management add-on.",
  {
    riskRegisterId: z.number().describe("ID of the risk register to update"),
    name: z.string().optional().describe("Updated name"),
    description: z.string().optional().describe("Updated description"),
  },
  async ({ riskRegisterId, ...fields }) => {
    const response = await updateRiskRegister(riskRegisterId, fields);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default UpdateRiskRegisterTool;
