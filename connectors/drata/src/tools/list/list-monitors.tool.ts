import { listMonitors } from "../../handlers/list-entities.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListMonitorsTool = CreateDrataTool(
  "list_monitors",
  "List all automated monitoring tests with results and descriptions.",
  {},
  async () => {
    const response = await listMonitors();
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListMonitorsTool;
