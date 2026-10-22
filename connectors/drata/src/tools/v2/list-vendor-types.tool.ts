import { listVendorTypes } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListVendorTypesTool = CreateDrataTool(
  "list_vendor_types",
  "List all vendor types (V2).",
  {},
  async () => {
    const response = await listVendorTypes();
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListVendorTypesTool;
