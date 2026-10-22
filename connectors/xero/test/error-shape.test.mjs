/**
 * Error-convention test.
 *
 * Every tool handler must return a structured MCP error result — isError:
 * true plus a single text content item — rather than throwing. We invoke a
 * representative sample of handlers from compiled dist/ (a list, a get, a
 * create, and a destructive void) with deliberately invalid credentials so
 * the Xero token exchange fails, and no Xero data can be touched.
 *
 * Hermetic: the client's token endpoint (xeroClient.tokenUrl) is pointed at
 * a loopback HTTP server, so the REAL client_credentials exchange code runs
 * but never leaves the machine. Both failure branches of that exchange are
 * exercised:
 *
 *  - "rejected": the loopback server answers 401 invalid_client, like Xero's
 *    identity service does for bad credentials;
 *  - "unreachable": the token URL points at a closed loopback port, so the
 *    request fails at the socket.
 *
 * Every case also asserts the loopback server saw exactly the expected
 * number of token requests, which proves the exchange went to the injected
 * URL and not to identity.xero.com.
 *
 * Deliberately does NOT assert on exact error message text — messages may
 * change between builds; the result shape is the contract. The only textual
 * checks are a short branch marker per failure path ("HTTP 401" vs "could
 * not be reached", proving which branch ran) and a negative one: the client
 * secret must never appear in the result.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  startRejectingTokenEndpoint,
  useUnreachableTokenEndpoint,
} from "./helpers/loopback-token-endpoint.mjs";

// Dynamic imports so the dummy-credential assignments above run first
// (static imports are hoisted ahead of them). Overriding the env in-process
// guarantees no real credentials from a local .env can leak in.
const { default: listInvoicesFactory } = await import(
  "../dist/tools/list/list-invoices.tool.js"
);
const { default: getInvoiceFactory } = await import(
  "../dist/tools/get/get-invoice.tool.js"
);
const { default: createContactFactory } = await import(
  "../dist/tools/create/create-contact.tool.js"
);
const { default: voidInvoiceFactory } = await import(
  "../dist/tools/update/void-invoice.tool.js"
);
const { xeroClient, XERO_TOKEN_URL, CustomConnectionsXeroClient } =
  await import("../dist/clients/xero-client.js");

function assertErrorResult(result, toolName) {
  assert.equal(
    result.isError,
    true,
    `${toolName}: error results must set isError: true`,
  );
  assert.ok(
    Array.isArray(result.content),
    `${toolName}: content must be an array`,
  );
  assert.equal(
    result.content.length,
    1,
    `${toolName}: error results must carry a single content item`,
  );
  assert.equal(
    result.content[0].type,
    "text",
    `${toolName}: error content must be of type text`,
  );
  assert.equal(
    typeof result.content[0].text,
    "string",
    `${toolName}: error text must be a string`,
  );
  assert.ok(
    result.content[0].text.length > 0,
    `${toolName}: error text must not be empty`,
  );
  assert.doesNotMatch(
    result.content[0].text,
    /offline-test-secret/,
    `${toolName}: error text must never echo the client secret`,
  );
}

const CASES = [
  [listInvoicesFactory, { page: 1 }],
  [getInvoiceFactory, { invoiceId: "00000000-0000-0000-0000-000000000000" }],
  [createContactFactory, { name: "Offline Test Co" }],
  [voidInvoiceFactory, { invoiceId: "00000000-0000-0000-0000-000000000000" }],
];

describe("token endpoint injection", () => {
  it("the singleton is a client-credentials client defaulting to Xero's endpoint", () => {
    assert.ok(xeroClient instanceof CustomConnectionsXeroClient);
    assert.equal(XERO_TOKEN_URL, "https://identity.xero.com/connect/token");
    assert.equal(xeroClient.tokenUrl, XERO_TOKEN_URL);
  });

  it("accepts a tokenUrl constructor option", () => {
    const client = new CustomConnectionsXeroClient({
      clientId: "id",
      clientSecret: "secret",
      grantType: "client_credentials",
      tokenUrl: "http://127.0.0.1:1/connect/token",
    });
    assert.equal(client.tokenUrl, "http://127.0.0.1:1/connect/token");
  });
});

describe("MCP error result convention (token endpoint rejects the credentials)", () => {
  let endpoint;

  before(async () => {
    endpoint = await startRejectingTokenEndpoint(xeroClient);
  });

  after(async () => {
    await endpoint.stop();
  });

  beforeEach(() => {
    endpoint.reset();
  });

  for (const [factory, args] of CASES) {
    const tool = factory();
    it(`${tool.name} returns isError: true with one text item on failure`, async () => {
      const result = await tool.handler(args);
      assertErrorResult(result, tool.name);
      assert.equal(
        endpoint.requests.length,
        1,
        `${tool.name}: the token exchange must hit the injected loopback endpoint exactly once`,
      );
      // Branch marker: the HTTP-status path of getClientCredentialsToken.
      assert.match(result.content[0].text, /HTTP 401/);
    });
  }

  it("sends a well-formed client_credentials request to the injected endpoint", async () => {
    await listInvoicesFactory().handler({ page: 1 });
    const [request] = endpoint.requests;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/connect/token");
    assert.equal(
      request.headers.authorization,
      `Basic ${Buffer.from("offline-test-id:offline-test-secret").toString("base64")}`,
    );
    assert.match(request.body, /^grant_type=client_credentials&scope=/);
  });
});

describe("MCP error result convention (token endpoint unreachable)", () => {
  let endpoint;

  before(async () => {
    endpoint = await useUnreachableTokenEndpoint(xeroClient);
  });

  after(async () => {
    await endpoint.stop();
  });

  for (const [factory, args] of CASES) {
    const tool = factory();
    it(`${tool.name} returns isError: true with one text item when the endpoint is down`, async () => {
      const result = await tool.handler(args);
      assertErrorResult(result, tool.name);
      // Branch marker: the no-response (socket failure) path of
      // getClientCredentialsToken, distinct from the HTTP-status path above.
      assert.match(result.content[0].text, /could not be reached/);
      assert.doesNotMatch(result.content[0].text, /HTTP \d{3}/);
    });
  }
});
