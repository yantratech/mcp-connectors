import { listWorkspaces } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListWorkspacesTool = CreateDrataTool(
  "list_workspaces",
  "List all workspaces available to this API key (V2).",
  {},
  async () => {
    const response = await listWorkspaces();
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListWorkspacesTool;
