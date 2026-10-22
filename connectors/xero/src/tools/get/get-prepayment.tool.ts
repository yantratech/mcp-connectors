import { z } from "zod";
import { getXeroPrepayment } from "../../handlers/get-xero-prepayment.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetPrepaymentTool = CreateXeroTool(
  "get_prepayment",
  "Get a specific prepayment by ID from Xero. \
  Use this to see full details including line items and allocations.",
  {
    prepaymentId: z
      .string()
      .describe(
        "The ID of the prepayment to retrieve. Can be obtained from list_prepayments.",
      ),
  },
  async ({ prepaymentId }) => {
    const response = await getXeroPrepayment(prepaymentId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting prepayment: ${response.error}`,
          },
        ],
      };
    }

    const p = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Prepayment details:",
            `Prepayment ID: ${p.prepaymentID}`,
            p.type ? `Type: ${p.type}` : null,
            p.status ? `Status: ${p.status}` : null,
            p.contact
              ? `Contact: ${p.contact.name} (${p.contact.contactID})`
              : null,
            p.date ? `Date: ${p.date}` : null,
            p.subTotal !== undefined ? `Sub Total: ${p.subTotal}` : null,
            p.totalTax !== undefined ? `Total Tax: ${p.totalTax}` : null,
            p.total !== undefined ? `Total: ${p.total}` : null,
            p.remainingCredit !== undefined
              ? `Remaining Credit: ${p.remainingCredit}`
              : null,
            p.currencyCode ? `Currency: ${p.currencyCode}` : null,
            p.allocations && p.allocations.length > 0
              ? `Allocations: ${p.allocations.map((a) => `${a.amount} to Invoice ${a.invoice?.invoiceNumber || a.invoice?.invoiceID}`).join(", ")}`
              : null,
            p.lineItems && p.lineItems.length > 0
              ? `Line Items: ${p.lineItems.length}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetPrepaymentTool;
