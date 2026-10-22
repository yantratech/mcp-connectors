import { listConnections } from "../../handlers/list-entities.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListConnectionsTool = CreateDrataTool(
  "list_connections",
  "List all integrations/connections configured in Drata (AWS, GitHub, Okta, etc.).",
  {},
  async () => {
    const response = await listConnections();
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListConnectionsTool;
