import { z } from "zod";
import { createXeroPayment } from "../../handlers/create-xero-payment.handler.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreatePaymentTool = CreateXeroTool(
  "create_payment",
  "Create a payment against an invoice in Xero.\
 This tool records a payment transaction against an invoice. \
 You'll need to provide the invoice ID, account ID to make the payment from, and the amount. \
 The amount must be positive and should not exceed the remaining amount due on the invoice. \
 A payment can only be created for an invoice that is status AUTHORIZED \
 A payment can only be created for an invoice that is not fully paid \
 When a payment is created, a deep link to the payment in Xero is returned. \
 This deep link can be used to view the payment in Xero directly. \
 This link should be displayed to the user.",
  {
    invoiceId: z.string().describe("The ID of the invoice to pay"),
    accountId: z
      .string()
      .describe("The ID of the account the payment is made from"),
    amount: z
      .number()
      .positive()
      .describe("The amount of the payment (must be positive)"),
    date: z
      .string()
      .optional()
      .describe("Optional payment date in YYYY-MM-DD format"),
    reference: z
      .string()
      .optional()
      .describe("Optional payment reference/description"),
  },
  async ({ invoiceId, accountId, amount, date, reference }) => {
    const result = await createXeroPayment({
      invoiceId,
      accountId,
      amount,
      date,
      reference,
    });
    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating payment: ${result.error}`,
          },
        ],
      };
    }

    const payment = result.result;

    // The payment is already created at this point. The deep-link lookup
    // makes a second Xero call (org short code) that can throw; if it does,
    // the model never learns the payment succeeded and may retry, creating a
    // duplicate. Swallow the deep-link failure instead.
    let deepLink: string | null = null;
    if (payment.paymentID) {
      try {
        deepLink = await getDeepLink(DeepLinkType.PAYMENT, payment.paymentID);
      } catch {
        deepLink = null;
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Payment created successfully:",
            `ID: ${payment?.paymentID}`,
            `Reference: ${payment?.reference}`,
            `Invoice Number: ${payment?.invoiceNumber}`,
            `Amount: ${payment?.amount}`,
            `Status: ${payment?.status}`,
            deepLink ? `Link to view: ${deepLink}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreatePaymentTool;
