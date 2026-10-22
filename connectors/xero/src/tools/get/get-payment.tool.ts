import { z } from "zod";
import { getXeroPayment } from "../../handlers/get-xero-payment.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatPayment } from "../list/list-payments.tool.js";

const GetPaymentTool = CreateXeroTool(
  "get_payment",
  "Get a specific payment by ID from Xero. \
  Use this to see full details including amount, invoice, and account info. \
  Amounts are in the invoice's currency (code shown when known); for cross-currency \
  payments the Bank Amount line shows the amount in the bank account's currency.",
  {
    paymentId: z
      .string()
      .describe(
        "The ID of the payment to retrieve. Can be obtained from list_payments.",
      ),
  },
  async ({ paymentId }) => {
    const response = await getXeroPayment(paymentId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting payment: ${response.error}`,
          },
        ],
      };
    }

    const p = response.result;

    return {
      content: [
        {
          type: "text" as const,
          // Same renderer as list_payments: currency-labelled amounts,
          // Bank Amount/Currency Rate on cross-currency payments, and no
          // literal "undefined" when the account has no code.
          text: ["Payment details:", formatPayment(p)].join("\n"),
        },
      ],
    };
  },
);

export default GetPaymentTool;
