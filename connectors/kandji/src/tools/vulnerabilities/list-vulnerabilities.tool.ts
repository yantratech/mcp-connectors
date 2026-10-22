import { z } from "zod";
import { listVulnerabilities } from "../../handlers/list-vulnerabilities.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListVulnerabilitiesTool = CreateKandjiTool(
  "list_vulnerabilities",
  "List CVEs detected across the fleet by Kandji Vulnerability Management. Filter by severity (low|medium|high|critical). Cap with max_results. License-gated — if Kandji Vulnerability Management isn't enabled on the tenant this returns a non-error result { count: 0, vulnerabilities: [], license_gated: true, note } rather than failing.",
  {
    severity: z
      .enum(["low", "medium", "high", "critical"])
      .optional()
      .describe("Filter by CVSS severity band"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total CVEs returned"),
  },
  async ({ severity, max_results }) => {
    const response = await listVulnerabilities({ severity }, max_results);
    if (response.isError) {
      return renderToolError(response);
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default ListVulnerabilitiesTool;
