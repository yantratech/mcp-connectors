import { z } from "zod";
import { sendVendorQuestionnaire } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const SendVendorQuestionnaireTool = CreateDrataTool(
  "send_vendor_questionnaire",
  "Send a questionnaire to a vendor (V2). \
IRREVERSIBLE — Drata dispatches a real email to the vendor's inbox. The vendor sees it, the audit \
log records it, and there is no \"unsend\". Confirm vendor + recipient + message before calling.",
  {
    vendorId: z.number().describe("ID of the vendor"),
    recipientEmail: z.string().optional().describe("Email address of the questionnaire recipient"),
    message: z.string().optional().describe("Custom message to include"),
  },
  async ({ vendorId, ...fields }) => {
    const response = await sendVendorQuestionnaire(vendorId, fields);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
  // The HTTP call is an additive POST, but the side effect (an email landing
  // in a real vendor inbox) is irreversible — flag destructive so clients
  // gate the call behind explicit confirmation.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
);

export default SendVendorQuestionnaireTool;
