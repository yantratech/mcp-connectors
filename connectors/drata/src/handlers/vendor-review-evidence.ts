import { getDrataClient, type Vendor } from "../clients/drata-client.js";
import { getRememberedVendorSecurityReviewIds } from "../helpers/local-state.js";
import { mapWithConcurrency, retryOnceOn429 } from "./v2-write.handler.js";

/**
 * One security-review record with the fields callers need to judge whether it
 * is a real (completed) past review or just a scheduled shell. Drata creates
 * NOT_YET_STARTED reviews with decision PENDING as placeholders; the app's
 * "Security review status" column does NOT count those as past reviews.
 */
export interface VendorReviewRecord {
  id: number | null;
  status: string | null;
  decision: string | null;
  title: string | null;
  requestedAt: string | null;
  reviewDeadlineAt: string | null;
  source: string;
}

export interface VendorReviewEvidence {
  reviewCount: number;
  reviewIds: number[];
  reviewSources: string[];
  eventIds: string[];
  reviews: VendorReviewRecord[];
}

function readReviews(vendor: Vendor): unknown[] {
  if (Array.isArray(vendor.reviews)) return vendor.reviews as unknown[];
  if (Array.isArray(vendor.securityReviews)) return vendor.securityReviews as unknown[];
  if (Array.isArray(vendor.latestSecurityReviews)) {
    return vendor.latestSecurityReviews as unknown[];
  }
  return [];
}

function addSource(evidence: VendorReviewEvidence, source: string): void {
  if (!evidence.reviewSources.includes(source)) evidence.reviewSources.push(source);
}

function baseEvidence(): VendorReviewEvidence {
  return {
    reviewCount: 0,
    reviewIds: [],
    reviewSources: [],
    eventIds: [],
    reviews: [],
  };
}

function toReviewRecord(review: unknown, source: string): VendorReviewRecord {
  const r = (review && typeof review === "object" ? review : {}) as Record<
    string,
    unknown
  >;
  const id = Number(r.id);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    id: Number.isFinite(id) ? id : null,
    // The list endpoint uses `status`; the single-review GET (and the create
    // DTO) have used `securityReviewStatus` — accept either.
    status: str(r.status) ?? str(r.securityReviewStatus),
    decision: str(r.decision),
    title: str(r.title),
    requestedAt: str(r.requestedAt),
    reviewDeadlineAt: str(r.reviewDeadlineAt),
    source,
  };
}

/**
 * Merge review records into the evidence, deduplicating by review id. A record
 * WITH a status wins over a same-id record without one (fallback sources like
 * the event log cannot see status).
 */
function mergeReviewRecords(
  evidence: VendorReviewEvidence,
  records: VendorReviewRecord[],
): void {
  for (const record of records) {
    const existing =
      record.id !== null
        ? evidence.reviews.find((r) => r.id === record.id)
        : undefined;
    if (!existing) {
      evidence.reviews.push(record);
      if (record.id !== null && !evidence.reviewIds.includes(record.id)) {
        evidence.reviewIds.push(record.id);
      }
      continue;
    }
    if (existing.status === null && record.status !== null) {
      Object.assign(existing, { ...record, source: existing.source });
    }
  }
  evidence.reviewCount = Math.max(evidence.reviewCount, evidence.reviews.length);
}

// Last-resort heuristic, used only when a vendor's list call fails: free-text
// vendor notes that mention "security review" (any case) count as at least
// one review of unknown status.
function noteHasSecurityReview(vendor: Vendor): boolean {
  return typeof vendor.notes === "string" && /SECURITY REVIEW/i.test(vendor.notes);
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function metadataMatchesVendor(
  metadata: unknown,
  vendor: Vendor,
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const fields = metadata as Record<string, unknown>;
  const vendorId = Number(fields.vendorId ?? fields.vendor_id ?? fields.id);
  if (Number.isFinite(vendorId) && vendorId === vendor.id) return true;

  const name = normalizeName(vendor.name);
  const metadataName = normalizeName(
    fields.vendorName ?? fields.vendor_name ?? fields.name,
  );
  return metadataName.length > 0 && (name.includes(metadataName) || metadataName.includes(name));
}

function eventMatchesVendor(event: Record<string, unknown>, vendor: Vendor): boolean {
  if (metadataMatchesVendor(event.metadata, vendor)) return true;

  const description = normalizeName(event.description);
  const vendorName = normalizeName(vendor.name);
  if (!description || !vendorName) return false;
  if (description.includes(vendorName) || vendorName.includes(description)) return true;

  const aliases = String(vendor.name)
    .match(/\(([^)]+)\)/g)
    ?.map((alias) => normalizeName(alias.replace(/[()]/g, "")))
    .filter((alias) => alias.length >= 2) ?? [];
  return aliases.some((alias) => description.includes(alias));
}

// One-time stderr nudge: the local state file is only a fallback for review
// IDs recorded by pre-release builds; Drata's official per-vendor
// security-review list endpoint is the primary source.
let warnedDeprecatedLocalState = false;

function warnDeprecatedLocalStateOnce(): void {
  if (warnedDeprecatedLocalState) return;
  warnedDeprecatedLocalState = true;
  console.error(
    "[drata-mcp] DEPRECATED: vendor security-review local state (persisted_get_by_id fallback) will be removed in a future release. Reviews are discovered via GET /public/v2/vendors/{vendorId}/security-reviews; no new review IDs are written to the state file.",
  );
}

export async function resolveVendorReviewEvidence(
  vendors: Vendor[],
): Promise<Map<number, VendorReviewEvidence>> {
  const client = getDrataClient();
  const byVendor = new Map<number, VendorReviewEvidence>();

  for (const vendor of vendors) {
    const evidence = baseEvidence();
    const reviews = readReviews(vendor);
    if (reviews.length > 0) {
      mergeReviewRecords(
        evidence,
        reviews.map((r) => toReviewRecord(r, "api_expand")),
      );
      addSource(evidence, "api_expand");
    }
    byVendor.set(vendor.id, evidence);
  }

  // PRIMARY: Drata's official per-vendor security-review list endpoint.
  // Capped fan-out + a single 429 retry so large vendor sets don't trip
  // rate limits.
  const listFailedVendors: Vendor[] = [];
  const listed = await mapWithConcurrency(vendors, 4, async (vendor) => {
    try {
      const reviews = await retryOnceOn429(() =>
        client.fetchAllV2<Record<string, unknown>>(
          `/public/v2/vendors/${vendor.id}/security-reviews`,
        ),
      );
      return { vendor, reviews };
    } catch {
      return { vendor, reviews: null };
    }
  });
  for (const { vendor, reviews } of listed) {
    if (reviews === null) {
      listFailedVendors.push(vendor);
      continue;
    }
    const evidence = byVendor.get(vendor.id) ?? baseEvidence();
    // The official list is an evidence source even when every ID it returned
    // was already known from expand=reviews — only the IDs are deduped.
    if (reviews.length > 0) addSource(evidence, "api_list");
    mergeReviewRecords(
      evidence,
      reviews.map((r) => toReviewRecord(r, "api_list")),
    );
    byVendor.set(vendor.id, evidence);
  }

  // DEPRECATED FALLBACK: review IDs recorded by pre-release builds. Only IDs
  // the official list did not already surface are verified via GET-by-ID.
  for (const vendor of vendors) {
    const evidence = byVendor.get(vendor.id) ?? baseEvidence();
    const rememberedIds = getRememberedVendorSecurityReviewIds(vendor.id).filter(
      (id) => !evidence.reviewIds.includes(id),
    );
    if (rememberedIds.length > 0) warnDeprecatedLocalStateOnce();
    for (const reviewId of rememberedIds) {
      try {
        const review = await client.getV2<Record<string, unknown>>(
          `/public/v2/vendors/${vendor.id}/security-reviews/${reviewId}`,
          { expand: ["user", "requesterUser"] },
        );
        if (review?.id !== undefined) {
          mergeReviewRecords(evidence, [
            toReviewRecord(review, "persisted_get_by_id"),
          ]);
          addSource(evidence, "persisted_get_by_id");
        }
      } catch {
        // A remembered ID can become inaccessible if Drata deletes or migrates
        // a review. Keep the read path best-effort and fall through to events.
      }
    }
    evidence.reviewIds = [...new Set(evidence.reviewIds)].sort((a, b) => a - b);
    evidence.reviewCount = Math.max(evidence.reviewCount, evidence.reviews.length);
    byVendor.set(vendor.id, evidence);
  }

  // ERROR FALLBACK: event-log and vendor-notes heuristics, demoted to run
  // only for vendors whose official list call failed. These sources cannot
  // see review status — their records carry status: null.
  if (listFailedVendors.length > 0) {
    const events = await client
      .getV2<{ data?: Record<string, unknown>[] }>("/public/v2/events", {
        size: 500,
        sort: "createdAt",
        sortDir: "ASC",
        type: "VENDOR_SECURITY_REVIEW_STARTED",
        expand: ["metadata", "user"],
      })
      .catch(() => ({ data: [] }));

    for (const vendor of listFailedVendors) {
      const evidence = byVendor.get(vendor.id) ?? baseEvidence();
      const matchingEvents = (events.data ?? []).filter((event) =>
        eventMatchesVendor(event, vendor),
      );
      if (matchingEvents.length > 0) {
        evidence.reviewCount = Math.max(evidence.reviewCount, matchingEvents.length);
        evidence.eventIds = matchingEvents
          .map((event) => String(event.id ?? ""))
          .filter(Boolean);
        addSource(evidence, "event_log");
      }
      if (noteHasSecurityReview(vendor)) {
        evidence.reviewCount = Math.max(evidence.reviewCount, 1);
        addSource(evidence, "vendor_notes");
      }
      byVendor.set(vendor.id, evidence);
    }
  }

  return byVendor;
}
