import { z } from "zod";
import { getXeroQuote } from "../../handlers/get-xero-quote.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetQuoteTool = CreateXeroTool(
  "get_quote",
  "Get a specific quote by ID from Xero. \
  Use this to see full details including contact, amounts, and expiry date.",
  {
    quoteId: z
      .string()
      .describe(
        "The ID of the quote to retrieve. Can be obtained from list_quotes.",
      ),
  },
  async ({ quoteId }) => {
    const response = await getXeroQuote(quoteId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting quote: ${response.error}`,
          },
        ],
      };
    }

    const q = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Quote details:",
            `Quote ID: ${q.quoteID}`,
            q.quoteNumber ? `Quote Number: ${q.quoteNumber}` : null,
            q.status ? `Status: ${q.status}` : null,
            q.contact ? `Contact: ${q.contact.name}` : null,
            q.date ? `Date: ${q.date}` : null,
            q.expiryDate ? `Expiry Date: ${q.expiryDate}` : null,
            q.total !== undefined ? `Total: ${q.total}` : null,
            q.reference ? `Reference: ${q.reference}` : null,
            q.currencyCode ? `Currency: ${q.currencyCode}` : null,
            q.title ? `Title: ${q.title}` : null,
            q.summary ? `Summary: ${q.summary}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetQuoteTool;
