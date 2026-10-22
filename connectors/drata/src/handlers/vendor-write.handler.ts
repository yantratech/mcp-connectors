import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import type { VendorPayload } from "../clients/drata-client.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

const VENDOR_READ_ONLY_FIELDS = [
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "companyId",
  "documents",
  "securityReviews",
] as const;

function stripReadOnlyFields(
  vendor: Record<string, unknown>,
): Record<string, unknown> {
  const copy = { ...vendor };
  for (const field of VENDOR_READ_ONLY_FIELDS) {
    delete copy[field];
  }
  return copy;
}

export async function createVendor(
  payload: VendorPayload,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const vendor = await client.createVendor(payload);
    return { isError: false, result: vendor };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function updateVendor(
  vendorId: number,
  payload: Partial<VendorPayload>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();

    // Fetch existing vendor to avoid destructive overwrite
    const existing = await client.getVendor(vendorId);
    const base = stripReadOnlyFields(existing as unknown as Record<string, unknown>);

    // Merge: provided fields override existing values
    const merged = { ...base, ...payload };

    const vendor = await client.updateVendor(vendorId, merged as Partial<VendorPayload>);
    return { isError: false, result: vendor };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function archiveVendor(
  vendorId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();

    const existing = await client.getVendor(vendorId);
    const base = stripReadOnlyFields(existing as unknown as Record<string, unknown>);
    const merged = { ...base, archivedAt: new Date().toISOString() };

    const vendor = await client.updateVendor(vendorId, merged as Partial<VendorPayload>);
    return { isError: false, result: vendor };
  } catch (err) {
    return mapDrataError(err);
  }
}
