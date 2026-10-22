import { listPolicies } from "../../handlers/list-entities.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListPoliciesTool = CreateDrataTool(
  "list_policies",
  "List ACTIVE policies (V1). Drata's V1 endpoint hides REPLACED and " +
    "ARCHIVED policies — for the full picture including replaced versions, " +
    "use list_policies_v2 with no status filter.",
  {},
  async () => {
    const response = await listPolicies();
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListPoliciesTool;
