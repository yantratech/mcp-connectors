import { z } from "zod";
import { createXeroContactHistoryNote } from "../../handlers/create-xero-contact-history-note.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateContactHistoryNoteTool = CreateXeroTool(
  "create_contact_history_note",
  "Add a note to the history of a specific contact in Xero. \
  Use this to annotate contacts with additional context or comments.",
  {
    contactId: z
      .string()
      .describe(
        "The ID of the contact to add a history note to. Can be obtained from list_contacts or get_contact.",
      ),
    details: z
      .string()
      .describe("The note text to add to the contact history."),
  },
  async ({ contactId, details }) => {
    const response = await createXeroContactHistoryNote(contactId, details);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating contact history note: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Contact history note created successfully.",
            `Details: ${response.result.details}`,
            response.result.dateUTC
              ? `Date: ${response.result.dateUTC}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateContactHistoryNoteTool;
