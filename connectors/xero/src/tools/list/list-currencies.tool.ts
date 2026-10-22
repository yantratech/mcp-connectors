import { listXeroCurrencies } from "../../handlers/list-xero-currencies.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListCurrenciesTool = CreateXeroTool(
  "list_currencies",
  "Lists all currencies set up in Xero. Use this tool to see which currencies are available for transactions.",
  {},
  async () => {
    const response = await listXeroCurrencies();
    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing currencies: ${response.error}`,
          },
        ],
      };
    }

    const currencies = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${currencies?.length || 0} currencies:`,
        },
        ...(currencies?.map((currency) => ({
          type: "text" as const,
          text: [
            `Code: ${currency.code || "No code"}`,
            `Description: ${currency.description || "No description"}`,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListCurrenciesTool;
