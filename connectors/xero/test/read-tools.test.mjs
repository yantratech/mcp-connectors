/**
 * Offline tests for the read-expansion tools:
 * get_history, get_files_inbox, get_file_associations_count,
 * list_users, get_user, get_tax_rate.
 *
 * Two layers, both offline:
 *  - zod input-schema validation (handlers never invoked);
 *  - MCP error-shape convention: each handler is invoked with deliberately
 *    invalid credentials against a loopback stand-in for Xero's token
 *    endpoint (test/helpers/loopback-token-endpoint.mjs) that rejects them,
 *    so the token exchange fails without any network access, and the catch
 *    branch must return isError: true with a single text content item
 *    rather than throwing.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { startRejectingTokenEndpoint } from "./helpers/loopback-token-endpoint.mjs";

// Dynamic imports so the env assignments above run first (static imports
// are hoisted ahead of them).
const { default: getHistoryFactory } = await import(
  "../dist/tools/get/get-history.tool.js"
);
const { default: getFilesInboxFactory } = await import(
  "../dist/tools/get/get-files-inbox.tool.js"
);
const { default: getFileAssociationsCountFactory } = await import(
  "../dist/tools/get/get-file-associations-count.tool.js"
);
const { default: listUsersFactory } = await import(
  "../dist/tools/list/list-users.tool.js"
);
const { default: getUserFactory } = await import(
  "../dist/tools/get/get-user.tool.js"
);
const { default: getTaxRateFactory } = await import(
  "../dist/tools/get/get-tax-rate.tool.js"
);
const { xeroClient } = await import("../dist/clients/xero-client.js");

const schemaOf = (factory) => z.object(factory().schema);

const accepts = (schema, input, message) =>
  assert.equal(schema.safeParse(input).success, true, message);
const rejects = (schema, input, message) =>
  assert.equal(schema.safeParse(input).success, false, message);

const HISTORY_ENTITY_TYPES = [
  "creditNotes",
  "payments",
  "purchaseOrders",
  "quotes",
  "items",
  "manualJournals",
  "bankTransfers",
  "prepayments",
  "overpayments",
  "receipts",
  "repeatingInvoices",
];

describe("get_history schema", () => {
  const s = schemaOf(getHistoryFactory);

  it("accepts every supported entityType", () => {
    for (const entityType of HISTORY_ENTITY_TYPES) {
      accepts(
        s,
        { entityType, entityId: "e-1" },
        `entityType ${entityType} must be accepted`,
      );
    }
  });

  it("rejects garbage and dedicated-tool entity types", () => {
    rejects(s, { entityType: "spaceships", entityId: "e-1" });
    // These three keep their dedicated history tools and must not be
    // accepted by the dispatcher.
    rejects(s, { entityType: "invoices", entityId: "e-1" });
    rejects(s, { entityType: "contacts", entityId: "e-1" });
    rejects(s, { entityType: "bankTransactions", entityId: "e-1" });
  });

  it("rejects a missing entityId or entityType", () => {
    rejects(s, { entityType: "payments" });
    rejects(s, { entityId: "e-1" });
    rejects(s, {});
  });
});

describe("get_files_inbox schema", () => {
  const s = schemaOf(getFilesInboxFactory);

  it("accepts empty input (no parameters)", () => {
    accepts(s, {});
  });
});

describe("get_file_associations_count schema", () => {
  const s = schemaOf(getFileAssociationsCountFactory);

  it("accepts 1 and 50 objectIds (array bounds)", () => {
    accepts(s, { objectIds: ["o-1"] });
    accepts(s, { objectIds: Array.from({ length: 50 }, (_, i) => `o-${i}`) });
  });

  it("rejects an empty array and more than 50 objectIds", () => {
    rejects(s, { objectIds: [] });
    rejects(s, { objectIds: Array.from({ length: 51 }, (_, i) => `o-${i}`) });
  });

  it("rejects non-array and non-string entries", () => {
    rejects(s, {});
    rejects(s, { objectIds: "o-1" });
    rejects(s, { objectIds: [42] });
  });
});

describe("list_users schema", () => {
  const s = schemaOf(listUsersFactory);

  it("accepts empty input and optional where/order", () => {
    accepts(s, {});
    accepts(s, {
      where: 'OrganisationRole=="STANDARD"',
      order: "LastName ASC",
    });
  });

  it("rejects non-string where/order", () => {
    rejects(s, { where: 42 });
    rejects(s, { order: ["LastName"] });
  });
});

describe("get_user schema", () => {
  const s = schemaOf(getUserFactory);

  it("requires userId", () => {
    accepts(s, { userId: "u-1" });
    rejects(s, {});
    rejects(s, { userId: 42 });
  });
});

describe("get_tax_rate schema", () => {
  const s = schemaOf(getTaxRateFactory);

  it("requires taxType", () => {
    accepts(s, { taxType: "OUTPUT2" });
    rejects(s, {});
    rejects(s, { taxType: 42 });
  });
});

describe("read-tool annotations", () => {
  it("all six tools are annotated read-only and idempotent", () => {
    const factories = [
      getHistoryFactory,
      getFilesInboxFactory,
      getFileAssociationsCountFactory,
      listUsersFactory,
      getUserFactory,
      getTaxRateFactory,
    ];
    for (const factory of factories) {
      const tool = factory();
      assert.equal(
        tool.annotations?.readOnlyHint,
        true,
        `${tool.name}: readOnlyHint must be true`,
      );
      assert.equal(
        tool.annotations?.idempotentHint,
        true,
        `${tool.name}: idempotentHint must be true`,
      );
    }
  });
});

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
}

const ERROR_CASES = [
  [
    getHistoryFactory,
    {
      entityType: "payments",
      entityId: "00000000-0000-0000-0000-000000000000",
    },
  ],
  [getFilesInboxFactory, {}],
  [
    getFileAssociationsCountFactory,
    { objectIds: ["00000000-0000-0000-0000-000000000000"] },
  ],
  [listUsersFactory, {}],
  [getUserFactory, { userId: "00000000-0000-0000-0000-000000000000" }],
  [getTaxRateFactory, { taxType: "OUTPUT2" }],
];

describe("read-tool MCP error result convention", () => {
  let endpoint;

  before(async () => {
    endpoint = await startRejectingTokenEndpoint(xeroClient);
  });

  after(async () => {
    await endpoint.stop();
  });

  for (const [factory, args] of ERROR_CASES) {
    const tool = factory();
    it(`${tool.name} returns isError: true with one text item on failure`, async () => {
      endpoint.reset();
      const result = await tool.handler(args);
      assertErrorResult(result, tool.name);
      assert.equal(
        endpoint.requests.length,
        1,
        `${tool.name}: the token exchange must hit the loopback endpoint`,
      );
    });
  }
});
