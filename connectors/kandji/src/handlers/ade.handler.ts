import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function listAdeIntegrations(
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const integrations = await client.listAdeIntegrations(maxResults);
    return {
      isError: false,
      result: {
        count: integrations.length,
        integrations,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getAdeIntegration(
  tokenId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const integration = await client.getAdeIntegration(tokenId);
    return { isError: false, result: integration };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function listAdeDevicesForToken(
  tokenId: string,
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const devices = await client.listAdeDevicesForToken(
      tokenId,
      {},
      maxResults,
    );
    return {
      isError: false,
      result: { count: devices.length, devices },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function listAdeDevices(
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const devices = await client.listAdeDevices({}, maxResults);
    return {
      isError: false,
      result: { count: devices.length, devices },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getAdeDevice(
  adeDeviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const device = await client.getAdeDevice(adeDeviceId);
    return { isError: false, result: device };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getAdePublicKey(): Promise<
  KandjiClientResponse<unknown>
> {
  try {
    const client = getKandjiClient();
    const key = await client.getAdePublicKey();
    return { isError: false, result: key };
  } catch (err) {
    return formatKandjiError(err);
  }
}
