import { listCustomConnections } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListCustomConnectionsTool = CreateDrataTool(
  "list_custom_connections",
  "List all custom connections (V2).",
  {},
  async () => {
    const response = await listCustomConnections();
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListCustomConnectionsTool;
