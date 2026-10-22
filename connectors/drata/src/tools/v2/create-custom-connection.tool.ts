import { z } from "zod";
import { createCustomConnection } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateCustomConnectionTool = CreateDrataTool(
  "create_custom_connection",
  "Create a new custom connection (V2).",
  {
    name: z.string().describe("Name of the custom connection"),
    description: z.string().optional().describe("Description of the connection"),
  },
  async (args) => {
    const response = await createCustomConnection(args);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateCustomConnectionTool;
