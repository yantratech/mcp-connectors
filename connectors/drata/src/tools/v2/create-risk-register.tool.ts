import { z } from "zod";
import { createRiskRegister } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateRiskRegisterTool = CreateDrataTool(
  "create_risk_register",
  "Create a new risk register (V2). Requires Drata Risk Management add-on.",
  {
    name: z.string().describe("Name of the risk register"),
    description: z.string().optional().describe("Description of the risk register"),
  },
  async (args) => {
    const response = await createRiskRegister(args);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateRiskRegisterTool;
