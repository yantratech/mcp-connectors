import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Association } from "xero-node/dist/gen/model/files/association.js";
import { ObjectType } from "xero-node/dist/gen/model/files/objectType.js";

interface CreateFileAssociationInput {
  fileId: string;
  objectId: string;
  objectType?: ObjectType;
}

export async function createXeroFileAssociation(
  input: CreateFileAssociationInput,
): Promise<XeroClientResponse<Association>> {
  try {
    await xeroClient.authenticate();

    const association: Association = {
      objectId: input.objectId,
      objectType: input.objectType,
    };

    const response = await xeroClient.filesApi.createFileAssociation(
      xeroClient.tenantId,
      input.fileId,
      association,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Failed to create file association.",
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
