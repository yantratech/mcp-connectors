import { z } from "zod";
import { getXeroOverpayment } from "../../handlers/get-xero-overpayment.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetOverpaymentTool = CreateXeroTool(
  "get_overpayment",
  "Get a specific overpayment by ID from Xero. \
  Use this to see full details including line items and allocations.",
  {
    overpaymentId: z
      .string()
      .describe(
        "The ID of the overpayment to retrieve. Can be obtained from list_overpayments.",
      ),
  },
  async ({ overpaymentId }) => {
    const response = await getXeroOverpayment(overpaymentId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting overpayment: ${response.error}`,
          },
        ],
      };
    }

    const o = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Overpayment details:",
            `Overpayment ID: ${o.overpaymentID}`,
            o.type ? `Type: ${o.type}` : null,
            o.status ? `Status: ${o.status}` : null,
            o.contact
              ? `Contact: ${o.contact.name} (${o.contact.contactID})`
              : null,
            o.date ? `Date: ${o.date}` : null,
            o.subTotal !== undefined ? `Sub Total: ${o.subTotal}` : null,
            o.totalTax !== undefined ? `Total Tax: ${o.totalTax}` : null,
            o.total !== undefined ? `Total: ${o.total}` : null,
            o.remainingCredit !== undefined
              ? `Remaining Credit: ${o.remainingCredit}`
              : null,
            o.currencyCode ? `Currency: ${o.currencyCode}` : null,
            o.allocations && o.allocations.length > 0
              ? `Allocations: ${o.allocations.map((a) => `${a.amount} to Invoice ${a.invoice?.invoiceNumber || a.invoice?.invoiceID}`).join(", ")}`
              : null,
            o.lineItems && o.lineItems.length > 0
              ? `Line Items: ${o.lineItems.length}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetOverpaymentTool;
