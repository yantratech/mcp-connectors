// Unit tests for formatError's handling of xero-node's plain-object throwables
// ({ response: { statusCode, body, headers } }). These are NOT AxiosError
// instances, and must not fall through to a JSON.stringify of the whole
// object, headers included. Run: node --test test/format-error.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.XERO_CLIENT_ID = process.env.XERO_CLIENT_ID || "dummy";
process.env.XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || "dummy";
const { formatError } = await import("../dist/helpers/format-error.js");

describe("formatError: xero-node response-object throwables", () => {
  it("maps 404 to the friendly not-found message", () => {
    const msg = formatError({ response: { statusCode: 404, body: "The resource you're looking for cannot be found", headers: { noisy: "x" } } });
    assert.equal(msg, "The requested resource was not found in Xero.");
  });
  it("maps 401/403/429 to friendly messages", () => {
    assert.match(formatError({ response: { statusCode: 401, body: "" } }), /Authentication failed/);
    assert.match(formatError({ response: { statusCode: 403, body: "" } }), /permission/);
    assert.match(formatError({ response: { statusCode: 429, body: "" } }), /Too many requests/);
  });
  it("includes status and body — but never headers — for other statuses", () => {
    const msg = formatError({ response: { statusCode: 500, body: { Message: "boom" }, headers: { "set-cookie": "secret" } } });
    assert.match(msg, /Xero API error 500/);
    assert.match(msg, /boom/);
    assert.doesNotMatch(msg, /set-cookie|secret/);
  });
  it("still stringifies unrecognised object throwables", () => {
    assert.match(formatError({ weird: true }), /unexpected error/i);
  });
  it("still passes through Error instances", () => {
    assert.equal(formatError(new Error("plain")), "plain");
  });
});

describe("formatError: JSON-string throwables (xero-node string rejections)", () => {
  it("maps a stringified 404 response to the friendly message", () => {
    const msg = formatError(JSON.stringify({ response: { statusCode: 404, body: "The resource you're looking for cannot be found", headers: { h: "x" } } }));
    assert.equal(msg, "The requested resource was not found in Xero.");
  });
  it("includes status+body for stringified non-mapped statuses, no headers", () => {
    const msg = formatError(JSON.stringify({ response: { statusCode: 503, body: "down", headers: { h: "x" } } }));
    assert.match(msg, /Xero API error 503/); assert.match(msg, /down/); assert.doesNotMatch(msg, /headers/);
  });
  it("leaves non-JSON strings on the fallback path", () => {
    assert.match(formatError("plain failure"), /plain failure/);
  });
});
