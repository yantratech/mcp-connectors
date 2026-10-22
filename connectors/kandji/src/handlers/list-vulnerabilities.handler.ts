import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import {
  formatKandjiError,
  isLicenseGated,
} from "../helpers/format-kandji-error.js";

const VM_LICENSE_GATED_NOTE =
  "Kandji Vulnerability Management is not enabled for this tenant.";

export async function listVulnerabilities(
  filters: { severity?: string } = {},
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const params: Record<string, string> = {};
    if (filters.severity) params.severity = filters.severity;

    const vulns = await client.listVulnerabilities(params, maxResults);
    return {
      isError: false,
      result: {
        count: vulns.length,
        vulnerabilities: vulns,
        license_gated: false,
      },
    };
  } catch (err) {
    if (isLicenseGated(err)) {
      return {
        isError: false,
        result: {
          count: 0,
          vulnerabilities: [],
          license_gated: true,
          note: VM_LICENSE_GATED_NOTE,
        },
      };
    }
    return formatKandjiError(err);
  }
}
