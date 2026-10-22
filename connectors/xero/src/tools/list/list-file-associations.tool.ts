import { z } from "zod";
import { listXeroFileAssociations } from "../../handlers/list-xero-file-associations.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListFileAssociationsTool = CreateXeroTool(
  "list_file_associations",
  "Lists all associations for a specific file in Xero Files. \
  Shows which Xero objects (invoices, contacts, etc.) a file is linked to.",
  {
    fileId: z
      .string()
      .describe(
        "The ID of the file to get associations for. Can be obtained from list_files.",
      ),
  },
  async ({ fileId }) => {
    const response = await listXeroFileAssociations(fileId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing file associations: ${response.error}`,
          },
        ],
      };
    }

    const associations = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${associations?.length || 0} associations for file ${fileId}:`,
        },
        ...(associations?.map((assoc) => ({
          type: "text" as const,
          text: [
            `File ID: ${assoc.fileId}`,
            `Object ID: ${assoc.objectId}`,
            assoc.objectType ? `Object Type: ${assoc.objectType}` : null,
            assoc.objectGroup ? `Object Group: ${assoc.objectGroup}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListFileAssociationsTool;
