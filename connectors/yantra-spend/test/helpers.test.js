/**
 * Unit tests for the small helpers — parse-iso-utc and format-error. Pure
 * functions with no I/O, so no fixtures.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseIsoUtc, utcDateOnly } = await import(
  "../dist/helpers/parse-iso-utc.js"
);
const { formatError, maskCredentials } = await import(
  "../dist/helpers/format-error.js"
);

describe("parseIsoUtc", () => {
  it("parses a date-only input as UTC midnight", () => {
    const { iso } = parseIsoUtc("2026-05-01");
    assert.equal(iso, "2026-05-01T00:00:00.000Z");
  });

  it("interprets a naive datetime as UTC", () => {
    const { iso } = parseIsoUtc("2026-05-01T10:30:00");
    assert.equal(iso, "2026-05-01T10:30:00.000Z");
  });

  it("preserves a timezone-aware datetime", () => {
    const { iso } = parseIsoUtc("2026-05-01T10:30:00-04:00");
    assert.equal(iso, "2026-05-01T14:30:00.000Z");
  });

  it("rejects invalid input", () => {
    assert.throws(() => parseIsoUtc("not-a-date"));
    assert.throws(() => parseIsoUtc(""));
  });

  it("formats a Date as YYYY-MM-DD in UTC", () => {
    const d = new Date("2026-05-01T23:59:59.000Z");
    assert.equal(utcDateOnly(d), "2026-05-01");
  });
});

describe("maskCredentials", () => {
  it("redacts AWS access key IDs", () => {
    assert.equal(
      maskCredentials("error from AKIAIOSFODNN7EXAMPLE bucket"),
      "error from [REDACTED] bucket",
    );
  });

  it("redacts Anthropic admin keys", () => {
    assert.equal(
      maskCredentials("auth failed for sk-ant-admin-AbCdEf12345"),
      "auth failed for [REDACTED]",
    );
  });

  it("redacts Stripe restricted keys", () => {
    assert.equal(
      maskCredentials("invalid api key rk_live_abc123def456ghi789"), // gitleaks:allow
      "invalid api key [REDACTED]",
    );
  });

  it("redacts JWT-shaped tokens", () => {
    assert.equal(
      maskCredentials(
        "Authorization eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.zsdAB-3a_-JZJa0Y",
      ),
      "Authorization [REDACTED]",
    );
  });

  it("redacts Cursor admin API keys (key_… format)", () => {
    // The Cursor source is the one that interpolated the raw upstream body
    // into a thrown error; a 401/403 body can reflect the submitted key.
    assert.equal(
      maskCredentials("Cursor 401: key_aB3kZ9qWxYtR7mNpLs0vUcDeFgHiJk leaked"),
      "Cursor 401: [REDACTED] leaked",
    );
  });

  it("redacts Authorization: Basic blobs (Cursor base64(KEY:) auth)", () => {
    assert.equal(
      maskCredentials(
        "request had Authorization: Basic a2V5XzEyMzQ1Njc4OTpibGFua3Bhc3N3b3Jk here",
      ),
      "request had [REDACTED] here",
    );
  });

  it("redacts Authorization: Bearer blobs", () => {
    assert.equal(
      maskCredentials(
        "Authorization: Bearer sk-proj-abcdefghijklmnop1234567890ABCDEF",
      ),
      "[REDACTED]",
    );
  });

  it("redacts a space-delimited high-entropy secret (no quote/= boundary)", () => {
    // AWS secret-access-key / Azure client secret can appear space-delimited
    // in an SDK auth error — the old generic rule required quote/= delimiters
    // and would have missed this.
    assert.equal(
      maskCredentials(
        "AccessDenied secret wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY99 rejected",
      ),
      "AccessDenied secret [REDACTED] rejected",
    );
  });

  it("leaves benign text alone", () => {
    assert.equal(
      maskCredentials("expected status 200 got 401"),
      "expected status 200 got 401",
    );
  });

  it("does not over-redact ordinary multi-word prose", () => {
    const prose =
      "AccessDenied: user is not authorized to perform ce:GetCostAndUsage";
    assert.equal(maskCredentials(prose), prose);
  });

  it("formatError stringifies and masks Error objects", () => {
    const err = new Error("AKIAIOSFODNN7EXAMPLE refused");
    assert.equal(formatError(err), "[REDACTED] refused");
  });
});
