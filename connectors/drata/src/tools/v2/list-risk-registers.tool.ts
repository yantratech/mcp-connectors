import { listRiskRegisters } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListRiskRegistersTool = CreateDrataTool(
  "list_risk_registers",
  "List all risk registers (V2). Requires Drata Risk Management add-on; " +
    "without it, returns a friendly 402 (\"Feature requires a paid Drata plan\").",
  {},
  async () => {
    const response = await listRiskRegisters();
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListRiskRegistersTool;
