import { z } from "zod";
import { listXeroObjectAssociations } from "../../handlers/list-xero-object-associations.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListObjectAssociationsTool = CreateXeroTool(
  "list_object_associations",
  "Lists all file associations for a specific Xero object (e.g. an invoice or contact). \
  Use this to find which files are linked to a particular object.",
  {
    objectId: z
      .string()
      .describe(
        "The ID of the Xero object (e.g. invoice ID, contact ID) to get file associations for.",
      ),
    page: z.number().describe("Page number for pagination.").optional(),
    pageSize: z.number().describe("Number of results per page.").optional(),
  },
  async ({ objectId, page, pageSize }) => {
    const response = await listXeroObjectAssociations(objectId, page, pageSize);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing object associations: ${response.error}`,
          },
        ],
      };
    }

    const associations = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${associations?.length || 0} file associations for object ${objectId}:`,
        },
        ...(associations?.map((assoc) => ({
          type: "text" as const,
          text: [
            `File ID: ${assoc.fileId}`,
            `Object ID: ${assoc.objectId}`,
            assoc.objectType ? `Object Type: ${assoc.objectType}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListObjectAssociationsTool;
