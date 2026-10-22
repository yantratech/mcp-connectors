import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Task } from "xero-node/dist/gen/model/projects/task.js";
import type { TaskCreateOrUpdate } from "xero-node/dist/gen/model/projects/taskCreateOrUpdate.js";
import type { Amount } from "xero-node/dist/gen/model/projects/amount.js";
import { ChargeType } from "xero-node/dist/gen/model/projects/chargeType.js";
import { CurrencyCode } from "xero-node/dist/gen/model/projects/currencyCode.js";

interface CreateProjectTaskInput {
  projectId: string;
  name: string;
  rateCurrency?: string;
  rateValue?: number;
  chargeType: "TIME" | "FIXED" | "NON_CHARGEABLE";
  estimateMinutes?: number;
}

export async function createXeroProjectTask(
  input: CreateProjectTaskInput,
): Promise<XeroClientResponse<Task>> {
  try {
    await xeroClient.authenticate();

    const rate: Amount = {
      currency: (input.rateCurrency ?? "GBP") as unknown as CurrencyCode,
      value: input.rateValue,
    };

    const chargeTypeMap: Record<string, ChargeType> = {
      TIME: ChargeType.TIME,
      FIXED: ChargeType.FIXED,
      NON_CHARGEABLE: ChargeType.NONCHARGEABLE,
    };

    const taskCreateOrUpdate: TaskCreateOrUpdate = {
      name: input.name,
      rate,
      chargeType: chargeTypeMap[input.chargeType],
      estimateMinutes: input.estimateMinutes,
    };

    const response = await xeroClient.projectApi.createTask(
      xeroClient.tenantId,
      input.projectId,
      taskCreateOrUpdate,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Failed to create task.",
      };
    }

    return {
      result: response.body,
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
