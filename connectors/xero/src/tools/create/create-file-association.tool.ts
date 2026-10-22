import { z } from "zod";
import { ObjectType } from "xero-node/dist/gen/model/files/objectType.js";
import { createXeroFileAssociation } from "../../handlers/create-xero-file-association.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateFileAssociationTool = CreateXeroTool(
  "create_file_association",
  "Create an association between a file and a Xero object (e.g. invoice, contact). \
  This links a file in Xero Files to a specific business object.",
  {
    fileId: z
      .string()
      .describe("The ID of the file to associate. Can be obtained from list_files."),
    objectId: z
      .string()
      .describe("The ID of the Xero object to associate the file with (e.g. invoice ID, contact ID)."),
    objectType: z
      .enum([
        "Business",
        "BankTransaction",
        "Contact",
        "CreditNote",
        "Account",
        "Invoice",
        "Item",
        "ManualJournal",
        "Overpayment",
        "Payment",
        "Prepayment",
        "Quote",
        "Receipt",
        "RepeatingInvoice",
      ])
      .describe("The type of Xero object to associate the file with.")
      .optional(),
  },
  async ({ fileId, objectId, objectType }) => {
    const response = await createXeroFileAssociation({
      fileId,
      objectId,
      objectType: objectType as ObjectType | undefined,
    });

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating file association: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully created association between file ${fileId} and object ${objectId}.`,
        },
      ],
    };
  },
);

export default CreateFileAssociationTool;
