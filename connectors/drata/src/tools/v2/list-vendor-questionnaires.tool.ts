import { z } from "zod";
import { listVendorQuestionnaires } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListVendorQuestionnairesTool = CreateDrataTool(
  "list_vendor_questionnaires",
  "List all questionnaires for a vendor (V2).",
  {
    vendorId: z.number().describe("ID of the vendor"),
  },
  async ({ vendorId }) => {
    const response = await listVendorQuestionnaires(vendorId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListVendorQuestionnairesTool;
