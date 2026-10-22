import { z } from "zod";
import { createVendorType } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateVendorTypeTool = CreateDrataTool(
  "create_vendor_type",
  "Create a new vendor type (V2).",
  {
    name: z.string().describe("Name of the vendor type"),
    description: z.string().optional().describe("Description of the vendor type"),
  },
  async (args) => {
    const response = await createVendorType(args);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateVendorTypeTool;
