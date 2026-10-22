import { z } from "zod";
import { listXeroOverpayments } from "../../handlers/list-xero-overpayments.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListOverpaymentsTool = CreateXeroTool(
  "list_overpayments",
  "List overpayments in Xero. Overpayments occur when a payment is made for more \
  than the amount of an invoice, or a payment is made without an invoice. \
  Ask the user if they want the next page if 10 results are returned.",
  {
    page: z.number().optional().describe("The page number to retrieve, starting from 1. Defaults to 1."),
  },
  async ({ page }) => {
    const response = await listXeroOverpayments(page ?? 1);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing overpayments: ${response.error}`,
          },
        ],
      };
    }

    const overpayments = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${overpayments?.length || 0} overpayments:`,
        },
        ...(overpayments?.map((o) => ({
          type: "text" as const,
          text: [
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
            o.updatedDateUTC
              ? `Last Updated: ${o.updatedDateUTC}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListOverpaymentsTool;
