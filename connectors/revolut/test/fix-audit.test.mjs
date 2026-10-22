/**
 * Output-shape tests for the list tools: compact list_transactions rows,
 * leading pagination and state signals, and list_accounts balance and name
 * semantics. Same offline pattern as tools-behavior.test.mjs — real tools,
 * fake client, in-memory MCP transport.
 *
 * Run: npm test (picked up by the test/*.test.mjs glob), or directly via
 * node --test test/fix-audit.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerAccountTools } from "../dist/tools/accounts.js";
import { registerTransactionTools } from "../dist/tools/transactions.js";
import { registerCounterpartyTools } from "../dist/tools/counterparties.js";

const ACC = "22222222-2222-2222-2222-222222222222";

/**
 * Full-shape raw transactions matching the Revolut Business API record shape.
 * Every value is synthetic: test card BINs, a fictional cardholder, example
 * merchants, round amounts and made-up timestamps.
 */
const CARD_TXN = {
  id: "tx-card-1",
  type: "card_payment",
  state: "completed",
  request_id: "REVP:1",
  created_at: "2026-01-15T12:00:00.000000Z",
  updated_at: "2026-01-16T09:00:00.000000Z",
  completed_at: "2026-01-16T09:00:00.000000Z",
  merchant: {
    id: "m-1",
    name: "Example Cafe",
    city: "London",
    category_code: "5813",
    country: "GBR",
  },
  legs: [
    {
      leg_id: "leg-1",
      account_id: ACC,
      amount: -42.5,
      currency: "GBP",
      description: "Example Cafe",
      balance: 10000,
    },
  ],
  card: {
    id: "card-1",
    card_number: "411111******1111",
    first_name: "Ada",
    last_name: "Lovelace",
    phone: "+447700900000",
  },
};

const DECLINED_TXN = {
  id: "tx-declined-1",
  type: "card_payment",
  state: "declined",
  reason_code: "CARD_INACTIVE",
  request_id: "REVP:2",
  created_at: "2026-01-10T10:00:00.000000Z",
  updated_at: "2026-01-10T10:00:00.000000Z",
  merchant: { id: "m-2", name: "Example Store", city: "London", country: "GBR" },
  legs: [
    {
      leg_id: "leg-2",
      account_id: ACC,
      amount: -25,
      currency: "GBP",
      description: "Example Store",
    },
  ],
  card: { id: "card-2", card_number: "400000******0002" },
};

const EXCHANGE_TXN = {
  id: "tx-exchange-1",
  type: "exchange",
  state: "completed",
  request_id: "req-3",
  created_at: "2026-01-05T08:00:00.000000Z",
  updated_at: "2026-01-05T08:00:00.000000Z",
  completed_at: "2026-01-05T08:00:00.000000Z",
  legs: [
    {
      leg_id: "leg-3a",
      account_id: "usd-acc",
      amount: -1200,
      currency: "USD",
      description: "Exchanged to EUR Main",
      balance: 50000,
    },
    {
      leg_id: "leg-3b",
      account_id: "eur-acc",
      amount: 1000,
      currency: "EUR",
      description: "Exchanged from USD Main",
      balance: 1000,
    },
  ],
};

function baseClient() {
  const captured = {};
  return {
    captured,
    listAccounts: async () => [
      { id: "acc-1", balance: 10000, currency: "GBP", state: "active", name: "Main" },
      // The API can return an unnamed account — no `name` key at all.
      { id: "acc-2", balance: 0, currency: "GBP", state: "active" },
    ],
    getAccount: async () => ({ id: "acc-1", state: "active" }),
    getAccountBankDetails: async () => [],
    listTransactions: async (query) => {
      captured.transactionsQuery = query;
      return [CARD_TXN, DECLINED_TXN, EXCHANGE_TXN];
    },
    getTransaction: async () => CARD_TXN,
    listCounterparties: async (query) => {
      captured.counterpartiesQuery = query;
      return [];
    },
    getCounterparty: async () => ({ id: "cp-1", state: "created", accounts: [] }),
  };
}

async function withHarness(client, fn) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const ctx = { config: { operator: "tester" }, client, log: () => {} };
  registerAccountTools(server, ctx);
  registerTransactionTools(server, ctx);
  registerCounterpartyTools(server, ctx);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "test-client", version: "0.0.0" }, {});
  await mcp.connect(clientTransport);
  try {
    return await fn({
      call: (name, args = {}) => mcp.callTool({ name, arguments: args }),
    });
  } finally {
    await mcp.close();
    await server.close();
  }
}

function parse(res) {
  return JSON.parse(res.content[0].text);
}

describe("list_transactions — compact projection", () => {
  it("defaults to compact rows without merchant/card/leg-internals", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_transactions", {}));
      const row = data.transactions[0];
      assert.deepEqual(row, {
        id: "tx-card-1",
        created_at: "2026-01-15T12:00:00.000000Z",
        state: "completed",
        type: "card_payment",
        amount: -42.5,
        currency: "GBP",
        description: "Example Cafe",
        counterparty: "Example Cafe",
      });
      assert.equal(row.merchant, undefined);
      assert.equal(row.card, undefined);
      assert.equal(row.balance, undefined);
    });
  });

  it("keeps per-leg amount+currency for multi-leg transactions", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_transactions", {}));
      const exchange = data.transactions.find((t) => t.id === "tx-exchange-1");
      assert.equal(exchange.amount, undefined);
      assert.deepEqual(exchange.legs, [
        { amount: -1200, currency: "USD", description: "Exchanged to EUR Main" },
        { amount: 1000, currency: "EUR", description: "Exchanged from USD Main" },
      ]);
    });
  });

  it("detail:'full' returns raw records with merchant/card/legs intact", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_transactions", { detail: "full" }));
      assert.deepEqual(data.transactions[0], CARD_TXN);
    });
  });

  it("defaults the page size to 50", async () => {
    const client = baseClient();
    await withHarness(client, async (h) => {
      await h.call("list_transactions", {});
      assert.equal(client.captured.transactionsQuery.count, 50);
    });
  });

  it("serializes single-line (no pretty-print overhead)", async () => {
    await withHarness(baseClient(), async (h) => {
      const res = await h.call("list_transactions", {});
      assert.ok(!res.content[0].text.includes("\n"));
    });
  });
});

describe("list_transactions — state breakdown", () => {
  it("leads with a states histogram and a non-movement note", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_transactions", {}));
      assert.deepEqual(data.states, { completed: 2, declined: 1 });
      assert.match(data.states_note, /not money movement/);
      assert.match(data.states_note, /exclude them from spend totals/);
    });
  });

  it("keeps state and reason_code prominent on declined rows", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_transactions", {}));
      const declined = data.transactions.find((t) => t.id === "tx-declined-1");
      assert.equal(declined.state, "declined");
      assert.equal(declined.reason_code, "CARD_INACTIVE");
    });
  });

  it("omits the note when every row is completed", async () => {
    const client = baseClient();
    client.listTransactions = async () => [CARD_TXN];
    await withHarness(client, async (h) => {
      const data = parse(await h.call("list_transactions", {}));
      assert.deepEqual(data.states, { completed: 1 });
      assert.equal(data.states_note, undefined);
    });
  });
});

describe("list_transactions — leading pagination signals", () => {
  it("serializes count/more_available/next_page_to/states BEFORE the array", async () => {
    await withHarness(baseClient(), async (h) => {
      const keys = Object.keys(parse(await h.call("list_transactions", {})));
      const arrayAt = keys.indexOf("transactions");
      for (const key of ["count", "more_available", "next_page_to", "states"]) {
        const at = keys.indexOf(key);
        assert.ok(at !== -1, `${key} missing`);
        assert.ok(at < arrayAt, `${key} must precede transactions`);
      }
    });
  });

  it("on a full page: more_available, cursor, and a page_note saying the total is unknown", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_transactions", { count: 3 }));
      assert.equal(data.count, 3);
      assert.equal(data.more_available, true);
      assert.equal(data.next_page_to, EXCHANGE_TXN.created_at);
      assert.match(data.page_note, /unknown\s+total/);
    });
  });

  it("on a partial page: no cursor, no page_note", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_transactions", { count: 10 }));
      assert.equal(data.more_available, false);
      assert.equal(data.next_page_to, null);
      assert.equal(data.page_note, undefined);
    });
  });
});

describe("list_counterparties — leading pagination signals", () => {
  it("serializes count/more_available/cursor before the array, with page_note on a full page", async () => {
    const client = baseClient();
    client.listCounterparties = async () => [
      { id: "cp-1", created_at: "2026-01-02T00:00:00Z" },
      { id: "cp-2", created_at: "2026-01-01T00:00:00Z" },
    ];
    await withHarness(client, async (h) => {
      const data = parse(await h.call("list_counterparties", { limit: 2 }));
      const keys = Object.keys(data);
      const arrayAt = keys.indexOf("counterparties");
      for (const key of ["count", "more_available", "next_page_created_before"]) {
        assert.ok(keys.indexOf(key) < arrayAt, `${key} must precede counterparties`);
      }
      assert.equal(data.count, 2);
      assert.equal(data.more_available, true);
      assert.equal(data.next_page_created_before, "2026-01-01T00:00:00Z");
      assert.match(data.page_note, /created_before/);
    });
  });

  it("reports no more pages on a partial page", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_counterparties", {}));
      assert.equal(data.count, 0);
      assert.equal(data.more_available, false);
      assert.equal(data.next_page_created_before, null);
    });
  });
});

describe("list_accounts — balance semantics and unnamed accounts", () => {
  it("leads with count and a balance_note before the accounts array", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_accounts", {}));
      const keys = Object.keys(data);
      assert.ok(keys.indexOf("count") < keys.indexOf("accounts"));
      assert.ok(keys.indexOf("balance_note") < keys.indexOf("accounts"));
      assert.equal(data.count, 2);
      assert.match(data.balance_note, /no\s+available\/pending split/i);
      assert.match(data.balance_note, /`name` may be\s+absent/);
    });
  });

  it("passes unnamed accounts through untouched (no placeholder name)", async () => {
    await withHarness(baseClient(), async (h) => {
      const data = parse(await h.call("list_accounts", {}));
      const unnamed = data.accounts.find((a) => a.id === "acc-2");
      assert.ok(unnamed, "unnamed account must still be listed");
      assert.ok(!("name" in unnamed));
    });
  });
});
