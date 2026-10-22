import { z } from "zod";
import { getXeroFileAssociationsCount } from "../../handlers/get-xero-file-associations-count.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetFileAssociationsCountTool = CreateXeroTool(
  "get_file_associations_count",
  "Get the number of files associated with each of a list of Xero objects \
  (e.g. invoices, purchase orders, bank transactions). \
  Use this as a batch check for whether documents are attached before \
  fetching details with list_object_associations.",
  {
    objectIds: z
      .array(z.string())
      .min(1)
      .max(50)
      .describe(
        "The IDs of the Xero objects (e.g. invoice IDs, purchase order IDs) to count file associations for. Between 1 and 50 IDs per call.",
      ),
  },
  async ({ objectIds }) => {
    const response = await getXeroFileAssociationsCount(objectIds);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting file associations count: ${response.error}`,
          },
        ],
      };
    }

    const counts = response.result;
    const entries = Object.entries(counts);

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `File association counts for ${entries.length} object${entries.length === 1 ? "" : "s"}:`,
            ...entries.map(
              ([objectId, count]) => `${objectId}: ${count} file association${count === 1 ? "" : "s"}`,
            ),
          ].join("\n"),
        },
      ],
    };
  },
);

export default GetFileAssociationsCountTool;
