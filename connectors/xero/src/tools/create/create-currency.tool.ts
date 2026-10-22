import { createXeroCurrency } from "../../handlers/create-xero-currency.handler.js";
import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateCurrencyTool = CreateXeroTool(
  "create_currency",
  "Add a new currency to Xero. Requires a valid ISO 4217 currency code (e.g. USD, EUR, GBP).",
  {
    code: z.string().describe("ISO 4217 currency code, e.g. USD, EUR, GBP"),
    description: z.string().optional().describe("Description of the currency"),
  },
  async ({ code, description }: { code: string; description?: string }) => {
    const response = await createXeroCurrency(code, description);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating currency: ${response.error}`,
          },
        ],
      };
    }

    const currency = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Currency created: ${currency.code}`,
            currency.description ? `Description: ${currency.description}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateCurrencyTool;
