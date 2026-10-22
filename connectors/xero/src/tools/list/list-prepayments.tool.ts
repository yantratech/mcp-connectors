import { z } from "zod";
import { listXeroPrepayments } from "../../handlers/list-xero-prepayments.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListPrepaymentsTool = CreateXeroTool(
  "list_prepayments",
  "List prepayments in Xero. Prepayments are advance payments made to suppliers \
  or received from customers before an invoice is raised. \
  Ask the user if they want the next page if 10 results are returned.",
  {
    page: z.number().optional().describe("The page number to retrieve, starting from 1. Defaults to 1."),
  },
  async ({ page }) => {
    const response = await listXeroPrepayments(page ?? 1);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing prepayments: ${response.error}`,
          },
        ],
      };
    }

    const prepayments = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${prepayments?.length || 0} prepayments:`,
        },
        ...(prepayments?.map((p) => ({
          type: "text" as const,
          text: [
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
            p.updatedDateUTC
              ? `Last Updated: ${p.updatedDateUTC}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListPrepaymentsTool;
