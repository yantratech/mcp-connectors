/**
 * Behavior tests: register the real tools against a fake Revolut client and
 * drive them through an in-memory MCP transport. Exercises read-tool shaping
 * and every create_payment_draft guard without any network.
 *
 * Run: node --test test/tools-behavior.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerAccountTools } from "../dist/tools/accounts.js";
import { registerTransactionTools } from "../dist/tools/transactions.js";
import { registerCounterpartyTools } from "../dist/tools/counterparties.js";
import { registerPaymentDraftTools } from "../dist/tools/payment-drafts.js";
import { RevolutApiError } from "../dist/client.js";

const CP = "11111111-1111-1111-1111-111111111111";
const ACC = "22222222-2222-2222-2222-222222222222";
const RCV1 = "33333333-3333-3333-3333-333333333333";
const RCV2 = "44444444-4444-4444-4444-444444444444";
const CARD1 = "55555555-5555-5555-5555-555555555555";
const DRAFT = "66666666-6666-6666-6666-666666666666";

function baseClient() {
  const captured = {};
  const client = {
    captured,
    listAccounts: async () => [{ id: ACC, state: "active" }],
    getAccount: async () => ({ id: ACC, state: "active" }),
    getAccountBankDetails: async () => [{ iban: "GB00REVO..." }],
    listTransactions: async () => [],
    getTransaction: async () => ({ id: "t1" }),
    listCounterparties: async () => [],
    getCounterparty: async () => ({
      id: CP,
      state: "created",
      accounts: [{ id: RCV1, currency: "GBP", iban: "GB00REVO..." }],
      cards: [],
    }),
    listPaymentDrafts: async () => ({ payment_orders: [] }),
    getPaymentDraft: async () => ({ payments: [] }),
    createPaymentDraft: async (body) => {
      captured.body = body;
      return { id: "draft-abc" };
    },
  };
  return client;
}

async function harness(client) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const ctx = { config: { operator: "alice" }, client, log: () => {} };
  registerAccountTools(server, ctx);
  registerTransactionTools(server, ctx);
  registerCounterpartyTools(server, ctx);
  registerPaymentDraftTools(server, ctx);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "test-client", version: "0.0.0" }, {});
  await mcp.connect(clientTransport);
  return {
    call: (name, args = {}) => mcp.callTool({ name, arguments: args }),
    raw: (params) => mcp.callTool(params),
    list: () => mcp.listTools(),
    close: async () => {
      await mcp.close();
      await server.close();
    },
  };
}

function parse(res) {
  return JSON.parse(res.content[0].text);
}

async function withHarness(client, fn) {
  const h = await harness(client);
  try {
    return await fn(h);
  } finally {
    await h.close();
  }
}

describe("read tools", () => {
  it("list_payment_drafts forwards every documented source and preserves omission", async () => {
    const client = baseClient();
    const seen = [];
    client.listPaymentDrafts = async (source) => {
      seen.push(source);
      return { payment_orders: source === "all" ? [{ id: DRAFT }] : [] };
    };
    await withHarness(client, async (h) => {
      for (const source of [undefined, "api", "integration", "email", "all"]) {
        const res = await h.call("list_payment_drafts", source ? { source } : {});
        assert.notEqual(res.isError, true);
        assert.equal(parse(res).payment_orders.length, source === "all" ? 1 : 0);
      }
      const bad = await h.call("list_payment_drafts", { source: "scheduled" });
      assert.equal(bad.isError, true);
      assert.deepEqual(seen, [undefined, "api", "integration", "email", "all"]);
    });
  });

  it("get_account merges bank_details as an array when requested", async () => {
    await withHarness(baseClient(), async (h) => {
      const res = await h.call("get_account", {
        account_id: ACC,
        include_bank_details: true,
      });
      const data = parse(res);
      assert.ok(Array.isArray(data.bank_details));
      assert.equal(data.bank_details.length, 1);
    });
  });

  it("list_transactions sets next_page_to only on a full page", async () => {
    const client = baseClient();
    client.listTransactions = async () => [
      { id: "a", created_at: "2026-01-02T00:00:00Z" },
      { id: "b", created_at: "2026-01-01T00:00:00Z" },
    ];
    await withHarness(client, async (h) => {
      const full = parse(await h.call("list_transactions", { count: 2 }));
      assert.equal(full.next_page_to, "2026-01-01T00:00:00Z");

      client.listTransactions = async () => [
        { id: "a", created_at: "2026-01-02T00:00:00Z" },
      ];
      const partial = parse(await h.call("list_transactions", { count: 2 }));
      assert.equal(partial.next_page_to, null);
    });
  });

  it("list_counterparties rejects sort_code without account_no", async () => {
    await withHarness(baseClient(), async (h) => {
      const res = await h.call("list_counterparties", { sort_code: "123456" });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /sort_code/);
    });
  });
});

describe("create_payment_draft — happy path", () => {
  it("creates a draft, attributes the title, and resolves the single account", async () => {
    const client = baseClient();
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 10,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.notEqual(res.isError, true, res.content[0].text);
      const data = parse(res);
      assert.equal(data.id, "draft-abc");
      assert.match(data.reminder, /approved in the Revolut Business app/i);
      assert.equal(client.captured.body.title, "[alice via MCP] INV-1");
      assert.equal(client.captured.body.payments[0].receiver.account_id, RCV1);
      assert.equal(client.captured.body.payments[0].receiver.counterparty_id, CP);
      assert.equal(client.captured.body.payments.length, 1);
    });
  });

  it("uses the provided title after the attribution prefix", async () => {
    const client = baseClient();
    await withHarness(client, async (h) => {
      await h.call("create_payment_draft", {
        title: "October rent",
        account_id: ACC,
        counterparty_id: CP,
        amount: 5,
        currency: "GBP",
        reference: "R-1",
      });
      assert.equal(client.captured.body.title, "[alice via MCP] October rent");
    });
  });

  it("routes receiver_account_id that matches a card to receiver.card_id", async () => {
    const client = baseClient();
    client.getCounterparty = async () => ({
      id: CP,
      state: "created",
      accounts: [],
      cards: [{ id: CARD1, currency: "GBP", last_digits: "4242" }],
    });
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        receiver_account_id: CARD1,
        amount: 5,
        currency: "GBP",
        reference: "R-2",
      });
      assert.notEqual(res.isError, true, res.content[0].text);
      assert.equal(client.captured.body.payments[0].receiver.card_id, CARD1);
      assert.equal(client.captured.body.payments[0].receiver.account_id, undefined);
    });
  });
});

describe("create_payment_draft — rejections", () => {
  it("rejects an unknown counterparty", async () => {
    const client = baseClient();
    client.getCounterparty = async () => {
      throw new RevolutApiError(404, "Revolut API error 404 on GET /counterparty/x: not found");
    };
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 10,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /No such counterparty/i);
    });
  });

  it("rejects a counterparty not in the 'created' state", async () => {
    const client = baseClient();
    client.getCounterparty = async () => ({ id: CP, state: "deleted", accounts: [] });
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 10,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /created/);
    });
  });

  it("rejects an ambiguous receiver (multiple methods, none chosen)", async () => {
    const client = baseClient();
    client.getCounterparty = async () => ({
      id: CP,
      state: "created",
      accounts: [
        { id: RCV1, currency: "GBP", iban: "GB1" },
        { id: RCV2, currency: "EUR", iban: "DE1" },
      ],
      cards: [],
    });
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 10,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /receiving methods/i);
    });
  });

  it("rejects a receiver_account_id that is not one of the counterparty's methods", async () => {
    await withHarness(baseClient(), async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        receiver_account_id: RCV2, // base client only has RCV1
        amount: 10,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /not one of/i);
    });
  });

  it("rejects when the paying account is not active", async () => {
    const client = baseClient();
    client.getAccount = async () => ({ id: ACC, state: "inactive" });
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 10,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /not active/i);
    });
  });

  it("rejects a duplicate (same counterparty + amount + currency + reference)", async () => {
    const client = baseClient();
    client.listPaymentDrafts = async () => ({ payment_orders: [{ id: DRAFT }] });
    client.getPaymentDraft = async () => ({
      payments: [
        {
          receiver: { counterparty_id: CP },
          amount: { amount: 10, currency: "GBP" },
          reference: "INV-1",
        },
      ],
    });
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 10,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /duplicate/i);
    });
  });

  it("fails closed when the duplicate check cannot read existing drafts", async () => {
    const client = baseClient();
    client.listPaymentDrafts = async () => {
      throw new Error("Revolut API error 500 on GET /payment-drafts: boom");
    };
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 10,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /failing closed/i);
      assert.equal(client.captured.body, undefined, "no draft must be created");
    });
  });

  it("rejects a non-positive amount (schema validation)", async () => {
    await withHarness(baseClient(), async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 0,
        currency: "GBP",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /amount/i);
    });
  });

  it("rejects a malformed currency code (schema validation)", async () => {
    await withHarness(baseClient(), async (h) => {
      const res = await h.call("create_payment_draft", {
        account_id: ACC,
        counterparty_id: CP,
        amount: 10,
        currency: "pounds",
        reference: "INV-1",
      });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /currency/i);
    });
  });
});

describe("create_payment_draft — overlapping calls", () => {
  const args = {
    account_id: ACC,
    counterparty_id: CP,
    amount: 10,
    currency: "GBP",
    reference: "INV-1",
  };

  /**
   * A fake whose drafts list returns the drafts it has created, with a slow
   * create: an overlapping call can reach its duplicate check while the first
   * call's POST is still in flight.
   */
  function draftStoreClient() {
    const client = baseClient();
    const drafts = new Map();
    client.posts = 0;
    client.listPaymentDrafts = async () => ({
      payment_orders: [...drafts.keys()].map((id) => ({ id })),
    });
    client.getPaymentDraft = async (id) => drafts.get(id);
    client.createPaymentDraft = async (body) => {
      client.posts += 1;
      const id = `draft-${client.posts}`;
      await new Promise((r) => setTimeout(r, 20));
      const { receiver, amount, currency, reference } = body.payments[0];
      drafts.set(id, { payments: [{ receiver, amount: { amount, currency }, reference }] });
      return { id };
    };
    return client;
  }

  /** Make the first call to client[method] fail, late enough for a second call to queue. */
  function failFirstCall(client, method) {
    const original = client[method];
    let calls = 0;
    client[method] = async (...a) => {
      calls += 1;
      if (calls > 1) return original(...a);
      await new Promise((r) => setTimeout(r, 20));
      throw new Error(`Revolut API error 500 on ${method}: boom`);
    };
  }

  it("two identical overlapping calls create one draft; the second reports the duplicate", { timeout: 5_000 }, async () => {
    const client = draftStoreClient();
    await withHarness(client, async (h) => {
      const results = await Promise.all([
        h.call("create_payment_draft", args),
        h.call("create_payment_draft", args),
      ]);
      assert.equal(client.posts, 1, "exactly one draft must be POSTed");
      const created = results.filter((r) => r.isError !== true);
      const refused = results.filter((r) => r.isError === true);
      assert.equal(created.length, 1);
      assert.equal(parse(created[0]).id, "draft-1");
      assert.equal(refused.length, 1);
      assert.match(refused[0].content[0].text, /already exists \(draft id draft-1\)/);
    });
  });

  for (const method of ["listPaymentDrafts", "createPaymentDraft"]) {
    it(`a failing ${method} releases the lock for the queued identical call`, { timeout: 5_000 }, async () => {
      const client = draftStoreClient();
      failFirstCall(client, method);
      await withHarness(client, async (h) => {
        const results = await Promise.all([
          h.call("create_payment_draft", args),
          h.call("create_payment_draft", args),
        ]);
        const failed = results.filter((r) => r.isError === true);
        const created = results.filter((r) => r.isError !== true);
        assert.equal(failed.length, 1);
        assert.match(failed[0].content[0].text, /boom/);
        assert.equal(created.length, 1, "the queued call must still run");
        assert.equal(parse(created[0]).id, "draft-1");
        assert.equal(client.posts, 1);
      });
    });
  }

  it("a call that starts while a queued call is creating waits for that call", { timeout: 5_000 }, async () => {
    // The first call's create fails, so the queued second call takes the lock
    // and creates the draft. A third identical call starts while that create
    // is still in flight and must wait for it. This fails if releasing the
    // first call's lock also drops the second call's entry from draftLocks.
    const client = draftStoreClient();
    failFirstCall(client, "createPaymentDraft");
    const create = client.createPaymentDraft;
    let creates = 0;
    let third;
    await withHarness(client, async (h) => {
      client.createPaymentDraft = async (body) => {
        creates += 1;
        if (creates === 2) third = h.call("create_payment_draft", args);
        return create(body);
      };
      const results = await Promise.all([
        h.call("create_payment_draft", args),
        h.call("create_payment_draft", args),
      ]);
      assert.ok(third, "the third call must have started during the second create");
      const late = await third;
      assert.equal(client.posts, 1, "exactly one draft must be POSTed");
      const created = results.filter((r) => r.isError !== true);
      assert.equal(created.length, 1);
      assert.equal(parse(created[0]).id, "draft-1");
      assert.equal(late.isError, true);
      assert.match(late.content[0].text, /already exists \(draft id draft-1\)/);
    });
  });
});

// Rejected calls may surface as an isError result or as a thrown JSON-RPC
// error depending on the SDK version; normalise both.
async function callLoose(h, name, args) {
  return h
    .call(name, args)
    .catch((err) => ({ isError: true, content: [{ type: "text", text: err.message }] }));
}

describe("list_transactions account filter", () => {
  function capturing() {
    const client = baseClient();
    client.listTransactions = async (query) => {
      client.captured.query = query;
      return [];
    };
    return client;
  }

  it("forwards account_id as Revolut's `account` query parameter", async () => {
    const client = capturing();
    await withHarness(client, async (h) => {
      const res = await h.call("list_transactions", { account_id: ACC });
      assert.notEqual(res.isError, true, res.content[0].text);
      assert.equal(client.captured.query.account, ACC);
    });
  });

  it("also accepts the `account` alias", async () => {
    const client = capturing();
    await withHarness(client, async (h) => {
      const res = await h.call("list_transactions", { account: ACC });
      assert.notEqual(res.isError, true, res.content[0].text);
      assert.equal(client.captured.query.account, ACC);
    });
  });

  it("accepts both when they name the same account, in any letter case", async () => {
    // Hex letters, so toUpperCase() really changes the string.
    const HEX = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const client = capturing();
    await withHarness(client, async (h) => {
      const res = await h.call("list_transactions", {
        account_id: HEX,
        account: HEX.toUpperCase(),
      });
      assert.notEqual(res.isError, true, res.content[0].text);
      assert.equal(client.captured.query.account, HEX);
    });
  });

  it("refuses account_id and account that disagree, without calling Revolut", async () => {
    const client = capturing();
    await withHarness(client, async (h) => {
      const res = await h.call("list_transactions", { account_id: ACC, account: CP });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /disagree/);
      assert.equal(client.captured.query, undefined);
    });
  });

  it("sends no account filter when neither is given", async () => {
    const client = capturing();
    await withHarness(client, async (h) => {
      await h.call("list_transactions", {});
      assert.equal(client.captured.query.account, undefined);
    });
  });
});

describe("strict tool schemas", () => {
  const TOOLS = [
    "list_accounts",
    "get_account",
    "list_transactions",
    "get_transaction",
    "list_counterparties",
    "get_counterparty",
    "create_payment_draft",
    "list_payment_drafts",
    "get_payment_draft",
  ];

  it("every tool rejects an unknown argument key instead of dropping it", async () => {
    const client = baseClient();
    const calls = [];
    for (const [k, v] of Object.entries(client)) {
      if (typeof v === "function") {
        client[k] = async (...args) => {
          calls.push(k);
          return v(...args);
        };
      }
    }
    await withHarness(client, async (h) => {
      const listed = await h.list();
      assert.deepEqual(listed.tools.map((t) => t.name).sort(), [...TOOLS].sort());
      for (const name of TOOLS) {
        const res = await callLoose(h, name, { not_a_real_argument: "x" });
        assert.equal(res.isError, true, `${name} must reject an unknown key`);
        assert.match(res.content[0].text, /unrecognized|invalid arguments/i, name);
      }
    });
    assert.deepEqual(calls, [], "a rejected call must never reach the Revolut client");
  });

  it("a misspelled account_id on list_transactions errors instead of listing every account", async () => {
    const client = baseClient();
    let called = false;
    client.listTransactions = async () => {
      called = true;
      return [];
    };
    await withHarness(client, async (h) => {
      const res = await callLoose(h, "list_transactions", { acount_id: ACC });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /acount_id/);
    });
    assert.equal(called, false);
  });

  it("advertises additionalProperties:false in every input schema", async () => {
    await withHarness(baseClient(), async (h) => {
      const { tools } = await h.list();
      for (const t of tools) {
        assert.equal(t.inputSchema.additionalProperties, false, t.name);
      }
    });
  });

  it("a no-argument tool still works when the client omits arguments", async () => {
    await withHarness(baseClient(), async (h) => {
      const res = await h.raw({ name: "list_accounts" });
      assert.notEqual(res.isError, true, res.content?.[0]?.text);
    });
  });
});

describe("create_payment_draft — lookup errors say 'not found' only on 404", () => {
  const args = {
    account_id: ACC,
    counterparty_id: CP,
    amount: 10,
    currency: "GBP",
    reference: "INV-1",
  };

  for (const status of [401, 403, 429, 500]) {
    it(`a ${status} on the counterparty lookup is not reported as missing`, async () => {
      const client = baseClient();
      client.getCounterparty = async () => {
        throw new RevolutApiError(status, `Revolut API error ${status} on GET /counterparty/x: boom`);
      };
      await withHarness(client, async (h) => {
        const res = await h.call("create_payment_draft", args);
        assert.equal(res.isError, true);
        assert.doesNotMatch(res.content[0].text, /No such counterparty|add it manually/i);
        assert.match(res.content[0].text, /Could not look up counterparty/);
        assert.match(res.content[0].text, new RegExp(String(status)));
        assert.equal(client.captured.body, undefined);
      });
    });

    it(`a ${status} on the paying-account lookup is not reported as not found`, async () => {
      const client = baseClient();
      client.getAccount = async () => {
        throw new RevolutApiError(status, `Revolut API error ${status} on GET /accounts/x: boom`);
      };
      await withHarness(client, async (h) => {
        const res = await h.call("create_payment_draft", args);
        assert.equal(res.isError, true);
        assert.doesNotMatch(res.content[0].text, /not found/i);
        assert.match(res.content[0].text, /Could not look up paying account/);
        assert.equal(client.captured.body, undefined);
      });
    });
  }

  it("a network error (no status) is not reported as not found", async () => {
    const client = baseClient();
    client.getAccount = async () => {
      throw new TypeError("fetch failed");
    };
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", args);
      assert.equal(res.isError, true);
      assert.doesNotMatch(res.content[0].text, /not found/i);
    });
  });

  it("a 404 on the paying-account lookup says not found", async () => {
    const client = baseClient();
    client.getAccount = async () => {
      throw new RevolutApiError(404, "Revolut API error 404 on GET /accounts/x: Not found");
    };
    await withHarness(client, async (h) => {
      const res = await h.call("create_payment_draft", args);
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /Paying account not found/);
    });
  });
});
