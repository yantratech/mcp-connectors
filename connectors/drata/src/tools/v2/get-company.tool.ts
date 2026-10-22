import { getCompany } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const GetCompanyTool = CreateDrataTool(
  "get_company",
  "Get company information (V2).",
  {},
  async () => {
    const response = await getCompany();
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetCompanyTool;
