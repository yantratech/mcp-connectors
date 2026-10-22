import { z } from "zod";
import { deleteXeroPayment } from "../../handlers/delete-xero-payment.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeletePaymentTool = CreateXeroTool(
  "delete_payment",
  "Delete a payment in Xero. This performs a soft delete by setting the payment status to DELETED. Once deleted, a payment cannot be restored — you would need to create a new payment instead.",
  {
    paymentId: z.string().describe("The ID of the payment to delete"),
  },
  async (params: { paymentId: string }) => {
    const { paymentId } = params;
    const response = await deleteXeroPayment(paymentId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error deleting payment: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully deleted payment with ID: ${paymentId}`,
        },
      ],
    };
  },
);

export default DeletePaymentTool;
