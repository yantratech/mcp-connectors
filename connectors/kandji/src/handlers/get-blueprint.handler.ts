import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getBlueprint(
  blueprintId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const blueprint = await client.getBlueprint(blueprintId);
    return { isError: false, result: blueprint };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getBlueprintOtaEnrollmentProfile(
  blueprintId: string,
  sso?: boolean,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const profile = await client.getBlueprintOtaEnrollmentProfile(
      blueprintId,
      sso,
    );
    return { isError: false, result: profile };
  } catch (err) {
    return formatKandjiError(err);
  }
}
