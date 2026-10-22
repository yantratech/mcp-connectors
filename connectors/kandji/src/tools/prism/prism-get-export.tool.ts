import { KandjiId } from "../../helpers/kandji-id.js";
import { getPrismExport } from "../../handlers/prism-export.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const PrismGetExportTool = CreateKandjiTool(
  "prism_get_export",
  "Poll the status of a Prism export job (from prism_request_export). Returns job status, category, any error, and once completed, the file path/URL to download the CSV.",
  {
    export_id: KandjiId.describe("The Prism export job ID"),
  },
  async ({ export_id }) => {
    const response = await getPrismExport(export_id);
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
  { readOnlyHint: true, idempotentHint: true },
);

export default PrismGetExportTool;
