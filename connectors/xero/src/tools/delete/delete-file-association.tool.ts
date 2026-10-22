import { z } from "zod";
import { deleteXeroFileAssociation } from "../../handlers/delete-xero-file-association.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteFileAssociationTool = CreateXeroTool(
  "delete_file_association",
  "Delete an association between a file and a Xero object. \
  This unlinks a file from a business object without deleting the file itself.",
  {
    fileId: z
      .string()
      .describe("The ID of the file to remove the association from."),
    objectId: z
      .string()
      .describe("The ID of the Xero object to remove the association with."),
  },
  async (params: { fileId: string; objectId: string }) => {
    const { fileId, objectId } = params;
    const response = await deleteXeroFileAssociation(fileId, objectId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error deleting file association: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully deleted association between file ${fileId} and object ${objectId}.`,
        },
      ],
    };
  },
);

export default DeleteFileAssociationTool;
