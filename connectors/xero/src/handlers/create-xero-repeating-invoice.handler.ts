import { xeroClient } from "../clients/xero-client.js";
import { CurrencyCode, RepeatingInvoice, Schedule } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

interface LineItemInput {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  taxType?: string;
  itemCode?: string;
}

interface ScheduleInput {
  period: number;
  unit: "WEEKLY" | "MONTHLY";
  dueDate: number;
  dueDateType: "DAYSAFTERBILLDATE" | "DAYSAFTERBILLMONTH" | "OFCURRENTMONTH" | "OFFOLLOWINGMONTH";
  startDate: string;
  nextScheduledDate?: string;
  endDate?: string;
}

export async function createXeroRepeatingInvoice(
  contactId: string,
  lineItems: LineItemInput[],
  type: "ACCREC" | "ACCPAY",
  schedule: ScheduleInput,
  reference?: string,
  status?: "DRAFT" | "AUTHORISED",
  currencyCode?: string,
): Promise<XeroClientResponse<RepeatingInvoice>> {
  try {
    await xeroClient.authenticate();

    const repeatingInvoice: RepeatingInvoice = {
      type: type === "ACCREC"
        ? RepeatingInvoice.TypeEnum.ACCREC
        : RepeatingInvoice.TypeEnum.ACCPAY,
      contact: { contactID: contactId },
      lineItems: lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        accountCode: item.accountCode,
        ...(item.taxType ? { taxType: item.taxType } : {}),
        itemCode: item.itemCode,
      })),
      schedule: {
        period: schedule.period,
        unit: schedule.unit === "WEEKLY"
          ? Schedule.UnitEnum.WEEKLY
          : Schedule.UnitEnum.MONTHLY,
        dueDate: schedule.dueDate,
        dueDateType: schedule.dueDateType as unknown as Schedule.DueDateTypeEnum,
        startDate: schedule.startDate,
        nextScheduledDate: schedule.nextScheduledDate,
        endDate: schedule.endDate,
      },
      status: status === "AUTHORISED"
        ? RepeatingInvoice.StatusEnum.AUTHORISED
        : RepeatingInvoice.StatusEnum.DRAFT,
    };

    if (reference) {
      repeatingInvoice.reference = reference;
    }
    if (currencyCode) {
      repeatingInvoice.currencyCode = currencyCode as unknown as CurrencyCode;
    }

    const response = await xeroClient.accountingApi.createRepeatingInvoices(
      xeroClient.tenantId,
      { repeatingInvoices: [repeatingInvoice] },
      undefined, // summarizeErrors
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    const created = response.body.repeatingInvoices?.[0];

    if (!created) {
      return {
        result: null,
        isError: true,
        error: "Failed to create repeating invoice.",
      };
    }

    return {
      result: created,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
