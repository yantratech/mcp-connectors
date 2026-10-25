/**
 * Per-source unit tests. Each source has at least:
 *   1. a "missing creds → empty result, no throw" test (per-source independence)
 *   2. a happy-path test using a stubbed client / fetcher
 *
 * SDK-typed sources (AWS, Azure) take a clientFactory in the constructor;
 * tests pass a fake. Raw-fetch sources (Anthropic, OpenAI, Cursor) take a
 * fetcher; tests stub via a local http server (kandji pattern). GCP, which
 * is not supported, is asserted to remain silent.
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const { AwsSource } = await import("../dist/sources/aws.source.js");
const { GcpSource } = await import("../dist/sources/gcp.source.js");
const { AzureSource, fetchQueryNextPage } = await import(
  "../dist/sources/azure.source.js"
);
const { CostManagementClient } = await import("@azure/arm-costmanagement");
const { AnthropicSource } = await import(
  "../dist/sources/anthropic.source.js"
);
const { OpenAiSource } = await import("../dist/sources/openai.source.js");
const { CursorSource } = await import("../dist/sources/cursor.source.js");

// ── shared cred-stripping helpers ─────────────────────────────────────────
const SOURCE_ENV_KEYS = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_SUBSCRIPTION_IDS",
  "ANTHROPIC_ADMIN_KEY",
  "OPENAI_ADMIN_KEY",
  "OPENAI_ORG_ID",
  "CURSOR_ADMIN_API_KEY",
];
const savedEnv = {};
beforeEach(() => {
  for (const key of SOURCE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of SOURCE_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

const START = new Date("2026-05-01T00:00:00Z");
const END = new Date("2026-05-08T00:00:00Z");

// ── AWS ───────────────────────────────────────────────────────────────────
describe("AwsSource", () => {
  it("isAvailable=false and getCostLines=[] when creds are missing", async () => {
    const source = new AwsSource(() => {
      throw new Error("client should not be constructed");
    });
    assert.equal(source.isAvailable(), false);
    assert.deepEqual(await source.getCostLines(START, END), []);
    assert.deepEqual(await source.getAnomalies(7), []);
    assert.equal(await source.getForecastToMonthEnd(), null);
  });

  it("queries costs, anomalies, forecasts and health with a named AWS profile", async () => {
    process.env.AWS_PROFILE = "spend-readonly";
    const calls = [];
    const source = new AwsSource(() => ({
      send: async (command) => {
        calls.push(command.constructor.name);
        return {
          ResultsByTime: [{ Total: { UnblendedCost: { Amount: "12.5" } } }],
          Anomalies: [
            { DimensionValue: "Example service", Impact: { TotalImpact: 2 } },
          ],
          Total: { Amount: "25" },
        };
      },
    }));

    assert.equal(source.isAvailable(), true);
    assert.equal((await source.getCostLines(START, END))[0].amount_usd, 12.5);
    assert.equal((await source.getAnomalies(7))[0].impact_usd, 2);
    assert.equal((await source.getForecastToMonthEnd()).amount_usd, 25);
    assert.deepEqual(await source.probe(), { reachable: true });
    assert.deepEqual(calls, [
      "GetCostAndUsageCommand",
      "GetAnomaliesCommand",
      "GetCostForecastCommand",
      "GetCostAndUsageCommand",
    ]);
  });

  it("reports profile credential failure instead of silently skipping AWS", async () => {
    process.env.AWS_PROFILE = "expired-session";
    const source = new AwsSource(() => ({
      send: async () => {
        throw new Error("SSO session expired; log in again");
      },
    }));

    await assert.rejects(source.getCostLines(START, END), /SSO session expired/);
    assert.deepEqual(await source.probe(), {
      reachable: false,
      error: "SSO session expired; log in again",
    });
  });

  it("flattens per-day groups into CostLine[], following NextPageToken pagination", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY =
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    // Cost Explorer paginates with NextPageToken — the stub serves two pages
    // for both GetCostAndUsage and GetAnomalies and records the tokens it
    // received, so a regression to first-page-only reads fails loudly here.
    const seenCauTokens = [];
    const seenAnomalyTokens = [];
    const fakeClient = {
      send: async (cmd) => {
        const ctor = cmd?.constructor?.name ?? "";
        if (ctor.startsWith("GetCostAndUsage")) {
          seenCauTokens.push(cmd.input?.NextPageToken);
          if (cmd.input?.NextPageToken === "cau-page-2") {
            return {
              ResultsByTime: [
                {
                  TimePeriod: { Start: "2026-05-02", End: "2026-05-03" },
                  Groups: [
                    {
                      Keys: ["AmazonRDS"],
                      Metrics: { UnblendedCost: { Amount: "3.5" } },
                    },
                  ],
                },
              ],
            };
          }
          return {
            ResultsByTime: [
              {
                TimePeriod: { Start: "2026-05-01", End: "2026-05-02" },
                Groups: [
                  {
                    Keys: ["AmazonEC2"],
                    Metrics: { UnblendedCost: { Amount: "12.3456" } },
                  },
                  {
                    Keys: ["AmazonS3"],
                    Metrics: { UnblendedCost: { Amount: "0.9876" } },
                  },
                ],
              },
            ],
            NextPageToken: "cau-page-2",
          };
        }
        if (ctor.startsWith("GetCostForecast")) {
          return { Total: { Amount: "456.78" } };
        }
        if (ctor.startsWith("GetAnomalies")) {
          seenAnomalyTokens.push(cmd.input?.NextPageToken);
          if (cmd.input?.NextPageToken === "anomalies-page-2") {
            return {
              Anomalies: [
                {
                  // Date-only fallback — older or alternative AWS shapes use this.
                  AnomalyStartDate: "2026-05-03",
                  DimensionValue: "AWS Key Management Service",
                  Impact: { TotalImpact: 0.4 },
                  RootCauses: [{ Service: "AWS Key Management Service" }],
                },
              ],
            };
          }
          return {
            Anomalies: [
              {
                // Live AWS returns AnomalyStartDate as a full ISO string
                // ("2026-05-01T00:00:00Z"), NOT a date-only "2026-05-01".
                // The description format pulls from DimensionValue (top-level)
                // and enriches with RootCauses[0].UsageType / Region /
                // LinkedAccountName.
                AnomalyStartDate: "2026-05-01T00:00:00Z",
                AnomalyEndDate: "2026-05-08T00:00:00Z",
                DimensionValue: "Amazon Simple Storage Service",
                Impact: { TotalImpact: 12.5 },
                RootCauses: [
                  {
                    Service: "Amazon Simple Storage Service",
                    Region: "us-west-2",
                    LinkedAccountName: "example-dev",
                    UsageType: "USW2-TimedStorage-ByteHrs",
                  },
                ],
              },
            ],
            NextPageToken: "anomalies-page-2",
          };
        }
        throw new Error(`unexpected command ${ctor}`);
      },
    };
    const source = new AwsSource(() => fakeClient);
    const lines = await source.getCostLines(START, END, "service");
    assert.deepEqual(
      seenCauTokens,
      [undefined, "cau-page-2"],
      "second GetCostAndUsage call must echo the NextPageToken",
    );
    assert.equal(lines.length, 3, "rows from BOTH pages are returned");
    assert.equal(lines[0].source, "aws");
    assert.equal(lines[0].amount_usd, 12.3456);
    assert.equal(lines[0].group_by_field, "service");
    assert.equal(lines[0].group_by_value, "AmazonEC2");
    assert.equal(lines[2].group_by_value, "AmazonRDS");
    assert.equal(lines[2].amount_usd, 3.5);
    assert.equal(lines[2].period_start, "2026-05-02T00:00:00.000Z");

    const anomalies = await source.getAnomalies(7);
    assert.deepEqual(
      seenAnomalyTokens,
      [undefined, "anomalies-page-2"],
      "second GetAnomalies call must echo the NextPageToken",
    );
    assert.equal(anomalies.length, 2, "anomalies from BOTH pages are returned");
    assert.equal(anomalies[0].source, "aws");
    // Full-ISO date parsed without "Invalid time value".
    assert.equal(anomalies[0].detected_at, "2026-05-01T00:00:00.000Z");
    assert.equal(anomalies[0].impact_usd, 12.5);
    // Description: DimensionValue + RootCause UsageType, Region, account.
    assert.equal(
      anomalies[0].description,
      "Amazon Simple Storage Service anomaly — USW2-TimedStorage-ByteHrs in us-west-2 (account: example-dev)",
    );
    // Sparse RootCause (only Service, no UsageType/Region/account) → fallback.
    assert.equal(
      anomalies[1].description,
      "AWS Key Management Service anomaly",
    );
    // Date-only form parsed correctly via the safeIso fallback.
    assert.equal(anomalies[1].detected_at, "2026-05-03T00:00:00.000Z");

    const forecast = await source.getForecastToMonthEnd();
    assert.equal(forecast.amount_usd, 456.78);
  });
});

// ── Azure ─────────────────────────────────────────────────────────────────
//
// Fakes return what @azure/arm-costmanagement's deserializer returns, not the
// wire format: the wire `properties` envelope is hoisted onto the result, so
// `nextLink`, `columns` and `rows` sit at the top level, and `usage()`
// resolves to `undefined` on HTTP 204. The first test below pins that shape
// against the installed SDK so these fakes cannot drift from it.

const AZURE_COST_COLUMNS = [
  { name: "PreTaxCost", type: "Number" },
  { name: "UsageDate", type: "Number" },
  { name: "Currency", type: "String" },
];
const AZURE_FORECAST_COLUMNS = [
  { name: "PreTaxCost", type: "Number" },
  { name: "UsageDate", type: "Number" },
  { name: "CostStatus", type: "String" },
  { name: "Currency", type: "String" },
];

/** A QueryResult / ForecastResult exactly as the SDK hands it back. */
function sdkResult({ columns, rows, nextLink, kind = "query" }) {
  return {
    id: `subscriptions/sub/providers/Microsoft.CostManagement/${kind}/q`,
    name: "q",
    type: `Microsoft.CostManagement/${kind}`,
    location: undefined,
    sku: undefined,
    eTag: undefined,
    tags: undefined,
    nextLink,
    columns,
    rows,
  };
}

function setAzureEnv(subs) {
  process.env.AZURE_TENANT_ID = "t";
  process.env.AZURE_CLIENT_ID = "c";
  process.env.AZURE_CLIENT_SECRET = "s";
  process.env.AZURE_SUBSCRIPTION_IDS = subs;
}

/** YYYYMMDD number for a UTC date, as Azure returns UsageDate. */
function usageDate(d) {
  return Number(d.toISOString().slice(0, 10).replaceAll("-", ""));
}

function utcToday() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function utcMonthEnd() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const fakeCredential = {
  getToken: async () => ({
    token: "fake-arm-token",
    expiresOnTimestamp: Date.now() + 3_600_000,
  }),
};

/** Minimal core-rest-pipeline HttpHeaders for a fake httpClient response. */
function fakeHeaders(init = {}) {
  const map = new Map(
    Object.entries(init).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    get: (k) => map.get(k.toLowerCase()),
    has: (k) => map.has(k.toLowerCase()),
    set: (k, v) => map.set(k.toLowerCase(), String(v)),
    delete: (k) => map.delete(k.toLowerCase()),
    toJSON: () => Object.fromEntries(map),
    [Symbol.iterator]: () => map.entries(),
  };
}

/**
 * A real CostManagementClient whose transport is faked: `respond(request)`
 * returns `{ status, body }` with `body` in the WIRE format.
 */
function realSdkClient(respond) {
  const httpClient = {
    sendRequest: async (request) => {
      const { status, body } = await respond(request);
      return {
        request,
        status,
        headers: fakeHeaders({ "content-type": "application/json" }),
        bodyAsText: body === undefined ? "" : JSON.stringify(body),
      };
    },
  };
  return new CostManagementClient(fakeCredential, {
    httpClient,
    retryOptions: { maxRetries: 0 },
  });
}

describe("AzureSource", () => {
  it("SDK shape: the installed SDK hoists `properties` and returns undefined on 204", async () => {
    const wire = {
      id: "x",
      name: "x",
      type: "Microsoft.CostManagement/query",
      properties: {
        nextLink: "https://management.azure.com/next?$skiptoken=abc",
        columns: AZURE_COST_COLUMNS,
        rows: [[1.5, 20260501, "USD"]],
      },
    };
    let status = 200;
    const client = realSdkClient(() => ({
      status,
      body: status === 204 ? undefined : wire,
    }));
    const body = {
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: START, to: END },
      dataset: {
        granularity: "Daily",
        aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
      },
    };
    const result = await client.query.usage("/subscriptions/sub-a", body);
    assert.equal(result.properties, undefined, "no properties envelope");
    assert.deepEqual(result.rows, wire.properties.rows);
    assert.deepEqual(result.columns, wire.properties.columns);
    assert.equal(result.nextLink, wire.properties.nextLink);

    status = 204;
    assert.equal(
      await client.query.usage("/subscriptions/sub-a", body),
      undefined,
    );
  });

  it("isAvailable=false without subscription IDs", async () => {
    process.env.AZURE_TENANT_ID = "t";
    process.env.AZURE_CLIENT_ID = "c";
    process.env.AZURE_CLIENT_SECRET = "s";
    const source = new AzureSource(() => {
      throw new Error("client should not be constructed");
    });
    assert.equal(source.isAvailable(), false);
    assert.deepEqual(await source.getCostLines(START, END), []);
  });

  it("parses Azure Query API column-row payloads, sums across subs", async () => {
    setAzureEnv("sub-a, sub-b");
    const seenScopes = [];
    const today = usageDate(utcToday());
    const fakeFactory = () => ({
      query: {
        usage: async (scope, body) => {
          seenScopes.push(scope);
          // body.timePeriod.from must be a Date — assert at the SDK boundary,
          // because the SDK serializer needs Date objects, not ISO strings.
          assert.ok(body.timePeriod.from instanceof Date);
          return sdkResult({
            columns: [
              { name: "PreTaxCost", type: "Number" },
              { name: "UsageDate", type: "Number" },
              { name: "ServiceName", type: "String" },
              { name: "Currency", type: "String" },
            ],
            rows: [
              [42.5, 20260501, "Virtual Machines", "USD"],
              [8.25, 20260502, "Storage", "USD"],
            ],
          });
        },
      },
      forecast: {
        usage: async () =>
          sdkResult({
            kind: "forecast",
            columns: AZURE_FORECAST_COLUMNS,
            rows: [[1234.56, today, "Forecast", "USD"]],
          }),
      },
    });
    const source = new AzureSource(fakeFactory);
    const lines = await source.getCostLines(START, END, "service");
    assert.deepEqual(seenScopes.sort(), [
      "/subscriptions/sub-a",
      "/subscriptions/sub-b",
    ]);
    assert.equal(lines.length, 4); // 2 sub × 2 rows
    assert.ok(lines.every((line) => line.source === "azure"));
    assert.equal(lines[0].group_by_value, "Virtual Machines");
    assert.equal(lines[0].period_start, "2026-05-01T00:00:00.000Z");
    assert.equal(lines[0].period_end, "2026-05-02T00:00:00.000Z");

    const forecast = await source.getForecastToMonthEnd();
    assert.equal(forecast.amount_usd, 2469.12); // 1234.56 × 2 subs
  });

  it("throws when an entire subscription's response is non-USD (instead of silently returning empty)", async () => {
    setAzureEnv("sub-eur");
    const fakeFactory = () => ({
      query: {
        usage: async () =>
          sdkResult({
            columns: AZURE_COST_COLUMNS,
            rows: [
              [100.0, 20260501, "EUR"],
              [50.0, 20260502, "EUR"],
            ],
          }),
      },
      forecast: { usage: async () => undefined },
    });
    const source = new AzureSource(fakeFactory);
    await assert.rejects(
      () => source.getCostLines(START, END),
      /EUR.*only supports USD-billed Azure subscriptions/,
    );
  });

  // ── nextLink pagination ─────────────────────────────────────────────────
  it("follows nextLink across pages, resending the same query body", async () => {
    setAzureEnv("sub-a");
    const pages = {
      first: sdkResult({
        columns: AZURE_COST_COLUMNS,
        rows: [[10, 20260501, "USD"]],
        nextLink:
          "https://management.azure.com/subscriptions/sub-a/providers/Microsoft.CostManagement/query?api-version=2025-03-01&$skiptoken=p2",
      }),
      p2: sdkResult({
        columns: AZURE_COST_COLUMNS,
        rows: [[20, 20260502, "USD"]],
        nextLink:
          "https://management.azure.com/subscriptions/sub-a/providers/Microsoft.CostManagement/query?api-version=2025-03-01&$skiptoken=p3",
      }),
      p3: sdkResult({
        columns: AZURE_COST_COLUMNS,
        rows: [[30, 20260503, "USD"]],
        nextLink: null,
      }),
    };
    let firstBody;
    const followed = [];
    const fakeFactory = () => ({
      query: {
        usage: async (_scope, body) => {
          firstBody = body;
          return pages.first;
        },
      },
      forecast: { usage: async () => undefined },
      queryNextPage: async (nextLink, body) => {
        assert.equal(body, firstBody, "same query body resent");
        const token = new URL(nextLink).searchParams.get("$skiptoken");
        followed.push(token);
        return pages[token];
      },
    });
    const source = new AzureSource(fakeFactory);
    const lines = await source.getCostLines(START, END);
    assert.deepEqual(followed, ["p2", "p3"]);
    assert.deepEqual(
      lines.map((l) => l.amount_usd),
      [10, 20, 30],
      "rows from every page are returned",
    );
  });

  it("throws when the page cap is exhausted with nextLink still present", async () => {
    setAzureEnv("sub-a");
    let calls = 0;
    const endless = () => {
      calls += 1;
      return sdkResult({
        columns: AZURE_COST_COLUMNS,
        rows: [[1, 20260501, "USD"]],
        nextLink: `https://management.azure.com/next?$skiptoken=${calls}`,
      });
    };
    const fakeFactory = () => ({
      query: { usage: async () => endless() },
      forecast: { usage: async () => undefined },
      queryNextPage: async () => endless(),
    });
    const source = new AzureSource(fakeFactory);
    await assert.rejects(
      () => source.getCostLines(START, END),
      /pagination safety cap exhausted \(100 pages\)/,
    );
    assert.equal(calls, 100, "stops at MAX_PAGES");
  });

  it("throws rather than truncating when a nextLink cannot be followed", async () => {
    setAzureEnv("sub-a");
    const fakeFactory = () => ({
      query: {
        usage: async () =>
          sdkResult({
            columns: AZURE_COST_COLUMNS,
            rows: [[1, 20260501, "USD"]],
            nextLink: "https://management.azure.com/next?$skiptoken=x",
          }),
      },
      forecast: { usage: async () => undefined },
    });
    const source = new AzureSource(fakeFactory);
    await assert.rejects(
      () => source.getCostLines(START, END),
      /nextLink.*truncated/,
    );
  });

  it("end to end: real SDK first page, then fetchQueryNextPage POSTs the body to nextLink with the credential's token", async () => {
    setAzureEnv("sub-a");
    const nextLink =
      "https://management.azure.com/subscriptions/sub-a/providers/Microsoft.CostManagement/query?api-version=2025-03-01&$skiptoken=AAA";
    const sdkRequests = [];
    const client = realSdkClient((request) => {
      sdkRequests.push(request);
      return {
        status: 200,
        body: {
          properties: {
            nextLink,
            columns: AZURE_COST_COLUMNS,
            rows: [[5, 20260501, "USD"]],
          },
        },
      };
    });
    const fetchCalls = [];
    const fakeFetch = async (url, init) => {
      fetchCalls.push({ url, init });
      return new Response(
        JSON.stringify({
          properties: {
            nextLink: null,
            columns: AZURE_COST_COLUMNS,
            rows: [[7, 20260502, "USD"]],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new AzureSource(() => ({
      query: client.query,
      forecast: client.forecast,
      queryNextPage: (link, body) =>
        fetchQueryNextPage(fakeCredential, link, body, fakeFetch),
    }));
    const lines = await source.getCostLines(START, END);
    assert.deepEqual(
      lines.map((l) => l.amount_usd),
      [5, 7],
    );
    assert.equal(sdkRequests.length, 1);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, nextLink);
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(
      fetchCalls[0].init.headers.authorization,
      "Bearer fake-arm-token",
    );
    // The resent body is the same JSON the SDK put on the wire.
    assert.deepEqual(
      JSON.parse(fetchCalls[0].init.body),
      JSON.parse(sdkRequests[0].body),
    );
  });

  it("fetchQueryNextPage refuses a nextLink outside management.azure.com without fetching a token", async () => {
    let tokenRequested = false;
    let fetched = false;
    const credential = {
      getToken: async () => {
        tokenRequested = true;
        return { token: "secret", expiresOnTimestamp: Date.now() + 1000 };
      },
    };
    await assert.rejects(
      () =>
        fetchQueryNextPage(credential, "https://evil.example.com/q", {}, () => {
          fetched = true;
        }),
      /refusing to follow a nextLink to https:\/\/evil\.example\.com/,
    );
    await assert.rejects(
      () =>
        fetchQueryNextPage(
          credential,
          "http://management.azure.com/q",
          {},
          () => {
            fetched = true;
          },
        ),
      /refusing to follow/,
    );
    assert.equal(tokenRequested, false);
    assert.equal(fetched, false);
  });

  it("fetchQueryNextPage returns undefined on 204 and a masked, bounded error on non-2xx", async () => {
    const link = "https://management.azure.com/q?$skiptoken=1";
    assert.equal(
      await fetchQueryNextPage(fakeCredential, link, {}, async () =>
        new Response(null, { status: 204 }),
      ),
      undefined,
    );
    await assert.rejects(
      () =>
        fetchQueryNextPage(fakeCredential, link, {}, async () =>
          new Response("x".repeat(5000), { status: 429 }),
        ),
      (err) => {
        assert.match(err.message, /Azure Cost Management HTTP 429/);
        assert.ok(err.message.length < 400, "body excerpt is bounded");
        return true;
      },
    );
  });

  it("fetchQueryNextPage fails rather than truncating on an unrecognised 200 page, and never follows redirects", async () => {
    const link = "https://management.azure.com/q?$skiptoken=1";
    let seenInit;
    await assert.rejects(
      () =>
        fetchQueryNextPage(fakeCredential, link, {}, async (_url, init) => {
          seenInit = init;
          return new Response(JSON.stringify({ value: [] }), { status: 200 });
        }),
      /no properties envelope/,
    );
    assert.equal(seenInit.redirect, "error");
    await assert.rejects(
      () =>
        fetchQueryNextPage(fakeCredential, link, {}, async () =>
          new Response("<html>secret-ish</html>", { status: 200 }),
        ),
      (err) => {
        assert.match(err.message, /not valid JSON/);
        assert.doesNotMatch(err.message, /secret-ish/);
        return true;
      },
    );
  });

  // ── Inclusive `to` ──────────────────────────────────────────────────────
  it("asks for [start, end) with to = end (midnight) and drops rows dated on end", async () => {
    setAzureEnv("sub-a");
    let seenBody;
    const fakeFactory = () => ({
      query: {
        usage: async (_scope, body) => {
          seenBody = body;
          return sdkResult({
            columns: AZURE_COST_COLUMNS,
            rows: [
              [1, 20260501, "USD"],
              [2, 20260507, "USD"],
              // END is 2026-05-08T00:00Z (exclusive): Azure's inclusive `to`
              // can return this day; it belongs to the next window.
              [99, 20260508, "USD"],
            ],
          });
        },
      },
      forecast: { usage: async () => undefined },
    });
    const source = new AzureSource(fakeFactory);
    const lines = await source.getCostLines(START, END);
    assert.equal(seenBody.timePeriod.from.getTime(), START.getTime());
    assert.equal(seenBody.timePeriod.to.getTime(), END.getTime());
    assert.deepEqual(
      lines.map((l) => l.amount_usd),
      [1, 2],
    );
  });

  it("forecast asks for to = month end and drops rows dated on month end", async () => {
    setAzureEnv("sub-a");
    const monthEnd = utcMonthEnd();
    let seenBody;
    const fakeFactory = () => ({
      query: { usage: async () => undefined },
      forecast: {
        usage: async (_scope, body) => {
          seenBody = body;
          return sdkResult({
            kind: "forecast",
            columns: AZURE_FORECAST_COLUMNS,
            rows: [
              [10, usageDate(utcToday()), "Forecast", "USD"],
              [500, usageDate(monthEnd), "Forecast", "USD"],
            ],
          });
        },
      },
    });
    const source = new AzureSource(fakeFactory);
    const forecast = await source.getForecastToMonthEnd();
    assert.equal(seenBody.timePeriod.to.getTime(), monthEnd.getTime());
    assert.equal(forecast.amount_usd, 10);
    assert.equal(forecast.period_end, monthEnd.toISOString());
  });

  // ── 204 / sparse metadata ───────────────────────────────────────────────
  it("treats an HTTP 204 (undefined result) as no rows for query and forecast", async () => {
    setAzureEnv("sub-a");
    const source = new AzureSource(() => ({
      query: { usage: async () => undefined },
      forecast: { usage: async () => undefined },
    }));
    assert.deepEqual(await source.getCostLines(START, END, "service"), []);
    assert.equal(await source.getForecastToMonthEnd(), null);
  });

  it("does not throw when a column has no type (grouped query)", async () => {
    setAzureEnv("sub-a");
    const source = new AzureSource(() => ({
      query: {
        usage: async () =>
          sdkResult({
            columns: [
              { name: "PreTaxCost", type: "Number" },
              { name: "UsageDate" },
              { name: "ResourceGroupName", type: "String" },
              { name: "Currency", type: "String" },
            ],
            rows: [[3, 20260501, "rg-a", "USD"]],
          }),
      },
      forecast: { usage: async () => undefined },
    }));
    const lines = await source.getCostLines(START, END, "resource_group");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].group_by_value, "rg-a");
  });

  // ── Forecast parsing shared with the query path ─────────────────────────
  it("forecast locates the cost column by name and excludes non-USD rows", async () => {
    setAzureEnv("sub-a");
    const today = usageDate(utcToday());
    const source = new AzureSource(() => ({
      query: { usage: async () => undefined },
      forecast: {
        usage: async () =>
          sdkResult({
            kind: "forecast",
            // Cost is NOT column 0.
            columns: [
              { name: "UsageDate", type: "Number" },
              { name: "CostStatus", type: "String" },
              { name: "PreTaxCost", type: "Number" },
              { name: "Currency", type: "String" },
            ],
            rows: [
              [today, "Forecast", 40, "USD"],
              [today, "Forecast", 1000, "EUR"],
            ],
          }),
      },
    }));
    const forecast = await source.getForecastToMonthEnd();
    assert.equal(forecast.amount_usd, 40);
  });

  it("forecast fails for a wholly non-USD subscription instead of summing it as USD", async () => {
    setAzureEnv("sub-eur");
    const today = usageDate(utcToday());
    const source = new AzureSource(() => ({
      query: { usage: async () => undefined },
      forecast: {
        usage: async () =>
          sdkResult({
            kind: "forecast",
            columns: AZURE_FORECAST_COLUMNS,
            rows: [[250, today, "Forecast", "EUR"]],
          }),
      },
    }));
    await assert.rejects(
      () => source.getForecastToMonthEnd(),
      /Azure forecast failed.*sub-eur.*EUR.*USD-billed/,
    );
  });

  it("forecast fails (not a silent skip) when a subscription's forecast returns a nextLink", async () => {
    setAzureEnv("sub-paged, sub-ok");
    const today = usageDate(utcToday());
    const source = new AzureSource((subscriptionId) => ({
      query: { usage: async () => undefined },
      forecast: {
        usage: async () =>
          sdkResult({
            kind: "forecast",
            columns: AZURE_FORECAST_COLUMNS,
            rows: [[100, today, "Forecast", "USD"]],
            nextLink:
              subscriptionId === "sub-paged"
                ? "https://management.azure.com/next?$skiptoken=f"
                : undefined,
          }),
      },
    }));
    await assert.rejects(
      () => source.getForecastToMonthEnd(),
      /Azure forecast failed.*sub-paged.*nextLink/,
    );
  });

  it("forecast skips tier-unsupported subscriptions silently and sums the rest", async () => {
    setAzureEnv("sub-ok, sub-404, sub-offer");
    const today = usageDate(utcToday());
    const fakeFactory = (subscriptionId) => ({
      query: { usage: async () => undefined },
      forecast: {
        usage: async () => {
          if (subscriptionId === "sub-404") {
            // RestError-shaped 404: forecast not available on this scope.
            throw Object.assign(new Error("The requested resource was not found"), {
              statusCode: 404,
            });
          }
          if (subscriptionId === "sub-offer") {
            throw new Error(
              "Given subscription sub-offer doesn't have valid WebDirect/AIRS offer type",
            );
          }
          return sdkResult({
            kind: "forecast",
            columns: AZURE_FORECAST_COLUMNS,
            rows: [[150.25, today, "Forecast", "USD"]],
          });
        },
      },
    });
    const source = new AzureSource(fakeFactory);
    const forecast = await source.getForecastToMonthEnd();
    assert.equal(forecast.amount_usd, 150.25, "supported sub still summed");
  });

  it("forecast THROWS on non-tier errors (auth/throttle/5xx) instead of swallowing them", async () => {
    setAzureEnv("sub-ok, sub-auth");
    const today = usageDate(utcToday());
    const fakeFactory = (subscriptionId) => ({
      query: { usage: async () => undefined },
      forecast: {
        usage: async () => {
          if (subscriptionId === "sub-auth") {
            throw Object.assign(
              new Error("AuthenticationFailed: token expired"),
              { statusCode: 401 },
            );
          }
          return sdkResult({
            kind: "forecast",
            columns: AZURE_FORECAST_COLUMNS,
            rows: [[150.25, today, "Forecast", "USD"]],
          });
        },
      },
    });
    const source = new AzureSource(fakeFactory);
    // The error names the source operation and the failing subscription so
    // the forecast handler's warnings channel surfaces something actionable.
    await assert.rejects(
      () => source.getForecastToMonthEnd(),
      /Azure forecast failed.*subscription sub-auth.*AuthenticationFailed/,
    );
  });

  it("forecast returns null (not a throw) when every subscription is tier-unsupported", async () => {
    setAzureEnv("sub-404");
    const fakeFactory = () => ({
      query: { usage: async () => undefined },
      forecast: {
        usage: async () => {
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        },
      },
    });
    const source = new AzureSource(fakeFactory);
    assert.equal(await source.getForecastToMonthEnd(), null);
  });
});

// ── Anthropic ─────────────────────────────────────────────────────────────
describe("AnthropicSource", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.endsWith("/cost_report")) {
        const groupBy = url.searchParams.getAll("group_by[]");
        const page = url.searchParams.get("page");
        if (page === "second") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: [
                {
                  starting_at: "2026-05-02T00:00:00Z",
                  ending_at: "2026-05-03T00:00:00Z",
                  results: [
                    { amount: "777.00", currency: "USD", workspace_id: "ws_b" },
                  ],
                },
              ],
              has_more: false,
              next_page: null,
            }),
          );
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              {
                starting_at: "2026-05-01T00:00:00Z",
                ending_at: "2026-05-02T00:00:00Z",
                results: [
                  // amount is a decimal string in CENTS
                  { amount: "12345.6789", currency: "USD", workspace_id: "ws_a" },
                ],
              },
            ],
            has_more: groupBy.length > 0,
            next_page: groupBy.length > 0 ? "second" : null,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    server.close();
  });

  it("isAvailable=false without ANTHROPIC_ADMIN_KEY", async () => {
    const source = new AnthropicSource();
    assert.equal(source.isAvailable(), false);
    assert.deepEqual(await source.getCostLines(START, END), []);
  });

  describe("future-only windows", () => {
    // Clock pinned to the middle of the START..END week.
    const NOW = new Date("2026-05-04T12:00:00Z");
    const clock = () => NOW;

    it("returns [] without calling the API when the window starts after now", async () => {
      process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
      const source = new AnthropicSource(async () => {
        throw new Error("fetcher should not be called");
      }, clock);
      const start = new Date("2026-05-05T00:00:00Z");
      const end = new Date("2026-05-12T00:00:00Z");
      assert.deepEqual(await source.getCostLines(start, end), []);
      assert.deepEqual(
        await source.getCostLines(start, end, "workspace_id"),
        [],
      );
    });

    it("treats a window starting exactly at now as future-only", async () => {
      process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
      const source = new AnthropicSource(async () => {
        throw new Error("fetcher should not be called");
      }, clock);
      assert.deepEqual(
        await source.getCostLines(NOW, new Date("2026-05-06T00:00:00Z")),
        [],
      );
    });

    it("still queries the API for a window that starts in the past and ends in the future", async () => {
      process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
      let calls = 0;
      const source = new AnthropicSource(async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ data: [], has_more: false, next_page: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }, clock);
      await source.getCostLines(START, END);
      assert.equal(calls, 1);
    });
  });

  it("converts string-cents amount to USD dollars and paginates", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const fetcher = async (url, init) => {
      const u = new URL(url);
      const localUrl = `${baseUrl}${u.pathname}${u.search}`;
      const r = await fetch(localUrl, init);
      return r;
    };
    const source = new AnthropicSource(fetcher);
    const lines = await source.getCostLines(START, END, "workspace_id");
    assert.equal(lines.length, 2);
    // 12345.6789 cents = 123.456789 USD → rounded to 123.4568 (4dp)
    assert.equal(lines[0].amount_usd, 123.4568);
    assert.equal(lines[0].group_by_value, "ws_a");
    // 777.00 cents = 7.77 USD
    assert.equal(lines[1].amount_usd, 7.77);
    assert.equal(lines[1].group_by_value, "ws_b");
  });

  it("rejects non-USD rows loudly instead of silently dropping them", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-05-01T00:00:00Z",
              ending_at: "2026-05-02T00:00:00Z",
              results: [{ amount: "100.00", currency: "EUR" }],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const source = new AnthropicSource(fetcher);
    // Silently dropping the EUR row would understate spend with no signal,
    // so the source throws instead and the handlers surface it as a source
    // error.
    await assert.rejects(
      () => source.getCostLines(START, END),
      /unsupported currency 'EUR'.*only USD is supported/,
    );
  });

  it("requests limit=31 (max buckets per page for bucket_width=1d)", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    let seenLimit;
    const fetcher = async (url) => {
      seenLimit = new URL(url).searchParams.get("limit");
      return new Response(
        JSON.stringify({ data: [], has_more: false, next_page: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new AnthropicSource(fetcher);
    await source.getCostLines(START, END, "workspace_id");
    assert.equal(seenLimit, "31");
  });

  it("THROWS when the pagination safety cap is exhausted with more pages remaining", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    let calls = 0;
    // Pathological upstream: every page claims more pages remain. The old
    // behaviour silently returned the truncated first 100 pages — zero-day
    // padding then disguised the missing spend as $0.00 days.
    const fetcher = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-05-01T00:00:00Z",
              ending_at: "2026-05-02T00:00:00Z",
              results: [{ amount: "100", currency: "USD", workspace_id: "w" }],
            },
          ],
          has_more: true,
          next_page: `cursor-${calls}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new AnthropicSource(fetcher);
    await assert.rejects(
      () => source.getCostLines(START, END, "workspace_id"),
      /Anthropic cost_report: pagination safety cap exhausted \(100 pages\)/,
    );
    assert.equal(calls, 100, "stops fetching at the cap");
  });
});

// ── OpenAI ────────────────────────────────────────────────────────────────
describe("OpenAiSource", () => {
  it("isAvailable=false without OPENAI_ADMIN_KEY", async () => {
    const source = new OpenAiSource();
    assert.equal(source.isAvailable(), false);
    assert.deepEqual(await source.getCostLines(START, END), []);
  });

  it("parses {value, currency} amount in BOTH number and string form, paginates with `page` cursor", async () => {
    process.env.OPENAI_ADMIN_KEY = "sk-admin-test";
    process.env.OPENAI_ORG_ID = "org-test";
    let calls = 0;
    const fetcher = async (url, init) => {
      calls += 1;
      const u = new URL(url);
      assert.equal(u.searchParams.get("limit"), "180", "uses max page size");
      const page = u.searchParams.get("page");
      // Verify Authorization + OpenAI-Organization headers were set
      assert.match(init.headers.Authorization, /^Bearer /);
      assert.equal(init.headers["OpenAI-Organization"], "org-test");
      if (calls === 1) {
        // First page: legacy number form (matches docs).
        return new Response(
          JSON.stringify({
            object: "page",
            data: [
              {
                object: "bucket",
                start_time: 1746057600,
                end_time: 1746144000,
                results: [
                  {
                    object: "organization.costs.result",
                    amount: { value: 12.34, currency: "usd" },
                    project_id: "proj-1",
                  },
                ],
              },
            ],
            has_more: true,
            next_page: "abc123",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      assert.equal(page, "abc123", "second call uses the next_page cursor");
      // Second page: high-precision STRING form (matches live API).
      return new Response(
        JSON.stringify({
          object: "page",
          data: [
            {
              object: "bucket",
              start_time: 1746144000,
              end_time: 1746230400,
              results: [
                {
                  object: "organization.costs.result",
                  amount: {
                    value: "5.5500000000000000000000000000",
                    currency: "USD",
                  },
                  project_id: "proj-2",
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new OpenAiSource(fetcher);
    const lines = await source.getCostLines(START, END, "project_id");
    assert.equal(lines.length, 2);
    assert.equal(lines[0].amount_usd, 12.34);
    assert.equal(lines[0].group_by_value, "proj-1");
    assert.equal(lines[1].amount_usd, 5.55);
    assert.equal(lines[1].group_by_value, "proj-2");
    assert.equal(calls, 2);
  });

  it("treats an HTTP 401 as a thrown error", async () => {
    process.env.OPENAI_ADMIN_KEY = "sk-admin-test";
    const fetcher = async () =>
      new Response("unauthorized", { status: 401 });
    const source = new OpenAiSource(fetcher);
    await assert.rejects(() => source.getCostLines(START, END), /401/);
  });

  it("groupBy=line_item with null line_item leaves group_by_value undefined (no cross-axis fallback)", async () => {
    process.env.OPENAI_ADMIN_KEY = "sk-admin-test";
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              start_time: 1746057600,
              end_time: 1746144000,
              results: [
                // line_item null, project_id set — used to mis-attribute as
                // project_id; now group_by_value should be undefined.
                {
                  amount: { value: 1.23, currency: "usd" },
                  project_id: "proj-1",
                  line_item: null,
                },
                {
                  amount: { value: 4.56, currency: "usd" },
                  project_id: "proj-1",
                  line_item: "gpt-5.4, input",
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const source = new OpenAiSource(fetcher);
    const lines = await source.getCostLines(START, END, "line_item");
    assert.equal(lines.length, 2);
    const withLineItem = lines.find((l) => l.group_by_value === "gpt-5.4, input");
    assert.ok(withLineItem, "real line_item row preserved");
    const nullLineItem = lines.find((l) => l.amount_usd === 1.23);
    assert.equal(
      nullLineItem.group_by_value,
      undefined,
      "null line_item must not silently fall back to project_id",
    );
  });

  it("THROWS when the pagination safety cap is exhausted with more pages remaining", async () => {
    process.env.OPENAI_ADMIN_KEY = "sk-admin-test";
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          data: [
            {
              start_time: 1746057600,
              end_time: 1746144000,
              results: [
                { amount: { value: 1, currency: "usd" }, project_id: "p" },
              ],
            },
          ],
          has_more: true,
          next_page: `cursor-${calls}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new OpenAiSource(fetcher);
    await assert.rejects(
      () => source.getCostLines(START, END, "project_id"),
      /OpenAI costs: pagination safety cap exhausted \(100 pages\)/,
    );
    assert.equal(calls, 100, "stops fetching at the cap");
  });
});

// ── Cursor ────────────────────────────────────────────────────────────────
describe("CursorSource", () => {
  it("isAvailable=false without CURSOR_ADMIN_API_KEY", async () => {
    const source = new CursorSource(async () => {
      throw new Error("fetcher should not be called");
    });
    assert.equal(source.isAvailable(), false);
    assert.deepEqual(await source.getCostLines(START, END), []);
  });

  it("uses HTTP Basic auth with the API key as username", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_test_abc123def456"; // gitleaks:allow
    let seenAuth;
    const fetcher = async (_url, init) => {
      seenAuth = init.headers.Authorization;
      return new Response(
        JSON.stringify({
          totalUsageEventsCount: 0,
          pagination: {
            currentPage: 1,
            numPages: 0,
            pageSize: 1000,
            hasNextPage: false,
            hasPreviousPage: false,
          },
          usageEvents: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new CursorSource(fetcher);
    await source.getCostLines(START, END);
    assert.match(seenAuth, /^Basic /);
    // Decode the base64 payload — should be "<key>:" exactly.
    const b64 = seenAuth.replace(/^Basic /, "");
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    assert.equal(decoded, "key_test_abc123def456:");
  });

  it("aggregates chargedCents per day and group axis, paginates", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_test";
    let calls = 0;
    const fetcher = async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      assert.equal(typeof body.startDate, "number", "epoch ms");
      assert.equal(typeof body.endDate, "number");
      if (calls === 1) {
        assert.equal(body.page, 1);
        return new Response(
          JSON.stringify({
            totalUsageEventsCount: 3,
            pagination: {
              currentPage: 1,
              numPages: 2,
              pageSize: 1000,
              hasNextPage: true,
              hasPreviousPage: false,
            },
            usageEvents: [
              {
                timestamp: String(new Date("2026-05-01T08:00:00Z").getTime()),
                userEmail: "alice@example.com",
                model: "claude-sonnet-4-6",
                kind: "AGENT",
                chargedCents: 1234,
                isChargeable: true,
              },
              {
                timestamp: String(new Date("2026-05-01T22:00:00Z").getTime()),
                userEmail: "alice@example.com",
                model: "claude-sonnet-4-6",
                kind: "CHAT",
                chargedCents: 100,
                isChargeable: true,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      assert.equal(body.page, 2, "second page");
      return new Response(
        JSON.stringify({
          totalUsageEventsCount: 3,
          pagination: {
            currentPage: 2,
            numPages: 2,
            pageSize: 1000,
            hasNextPage: false,
            hasPreviousPage: true,
          },
          usageEvents: [
            {
              timestamp: String(new Date("2026-05-02T10:00:00Z").getTime()),
              userEmail: "bob@example.com",
              model: "claude-opus-4-7",
              kind: "AGENT",
              chargedCents: 5000,
              isChargeable: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new CursorSource(fetcher);
    const lines = await source.getCostLines(START, END, "user");
    assert.equal(calls, 2, "paginated through 2 pages");
    assert.equal(lines.length, 2, "alice (day 1) + bob (day 2)");
    const alice = lines.find((l) => l.group_by_value === "alice@example.com");
    assert.equal(alice.amount_usd, 13.34); // (1234 + 100) cents
    assert.equal(alice.group_by_field, "user");
    assert.equal(alice.period_start, "2026-05-01T00:00:00.000Z");
    const bob = lines.find((l) => l.group_by_value === "bob@example.com");
    assert.equal(bob.amount_usd, 50);
    assert.equal(bob.period_start, "2026-05-02T00:00:00.000Z");
  });

  it("auto-chunks ranges beyond 30 days (no user-facing cap)", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_test";
    const seenWindows = [];
    const fetcher = async (_url, init) => {
      const body = JSON.parse(init.body);
      seenWindows.push({
        startDate: body.startDate,
        endDate: body.endDate,
      });
      return new Response(
        JSON.stringify({
          totalUsageEventsCount: 0,
          pagination: { hasNextPage: false },
          usageEvents: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new CursorSource(fetcher);
    // 45-day window — must be split into 2 chunks (30d + 15d), not throw.
    const farEnd = new Date(START.getTime() + 45 * 24 * 60 * 60 * 1000);
    const lines = await source.getCostLines(START, farEnd);
    assert.deepEqual(lines, []);
    assert.equal(seenWindows.length, 2, "split into 2 chunks");
    assert.equal(seenWindows[0].startDate, START.getTime());
    assert.equal(
      seenWindows[0].endDate,
      START.getTime() + 30 * 24 * 60 * 60 * 1000,
      "first chunk is exactly 30 days",
    );
    assert.equal(
      seenWindows[1].startDate,
      START.getTime() + 30 * 24 * 60 * 60 * 1000 + 1,
      "second chunk starts 1ms after first ends — non-overlapping bounds",
    );
    assert.equal(seenWindows[1].endDate, farEnd.getTime());
  });

  it("probe() POSTs filtered-usage-events with a 24h window and reports reachable on 2xx", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_test";
    let seenUrl;
    let seenInit;
    let calls = 0;
    const fetcher = async (url, init) => {
      calls += 1;
      seenUrl = url;
      seenInit = init;
      return new Response(
        JSON.stringify({
          totalUsageEventsCount: 0,
          pagination: { hasNextPage: false },
          usageEvents: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new CursorSource(fetcher);
    const result = await source.probe();
    assert.deepEqual(result, { reachable: true });
    // One round trip — the health tool description promises this.
    assert.equal(calls, 1);
    assert.equal(seenUrl, "https://api.cursor.com/teams/filtered-usage-events");
    assert.equal(seenInit.method, "POST");
    const body = JSON.parse(seenInit.body);
    assert.equal(body.pageSize, 1, "minimal pageSize for cheapest probe");
    assert.equal(body.page, 1);
    assert.equal(typeof body.startDate, "number");
    assert.equal(typeof body.endDate, "number");
    assert.equal(
      body.endDate - body.startDate,
      24 * 60 * 60 * 1000,
      "24h window",
    );
  });

  it("probe() reports reachable=false with HTTP code on non-2xx", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_test";
    const fetcher = async () =>
      new Response("forbidden", { status: 403 });
    const source = new CursorSource(fetcher);
    const result = await source.probe();
    assert.deepEqual(result, { reachable: false, error: "HTTP 403" });
  });

  it("probe() reports reachable=false with 'no credentials' when env is missing", async () => {
    const source = new CursorSource(async () => {
      throw new Error("fetcher should not be called");
    });
    const result = await source.probe();
    assert.deepEqual(result, { reachable: false, error: "no credentials" });
  });

  it("parses event.timestamp in numeric, string-epoch, and ISO-8601 forms", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_test";
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          totalUsageEventsCount: 3,
          pagination: { hasNextPage: false },
          usageEvents: [
            {
              timestamp: String(new Date("2026-05-01T08:00:00Z").getTime()),
              userEmail: "a@example.com",
              chargedCents: 100,
            },
            {
              // raw number (no string wrap)
              timestamp: new Date("2026-05-02T08:00:00Z").getTime(),
              userEmail: "b@example.com",
              chargedCents: 200,
            },
            {
              // ISO 8601 — defensive fallback
              timestamp: "2026-05-03T08:00:00.000Z",
              userEmail: "c@example.com",
              chargedCents: 300,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const source = new CursorSource(fetcher);
    const lines = await source.getCostLines(START, END, "user");
    assert.equal(lines.length, 3);
    const days = lines.map((l) => l.period_start).sort();
    assert.deepEqual(days, [
      "2026-05-01T00:00:00.000Z",
      "2026-05-02T00:00:00.000Z",
      "2026-05-03T00:00:00.000Z",
    ]);
  });

  it("attributes events with serviceAccountName when userEmail is null", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_test";
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          totalUsageEventsCount: 2,
          pagination: { hasNextPage: false },
          usageEvents: [
            {
              timestamp: String(new Date("2026-05-01T08:00:00Z").getTime()),
              userEmail: "alice@example.com",
              chargedCents: 100,
              isChargeable: true,
            },
            {
              timestamp: String(new Date("2026-05-01T09:00:00Z").getTime()),
              userEmail: null,
              serviceAccountName: "ci-runner",
              chargedCents: 250,
              isChargeable: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const source = new CursorSource(fetcher);
    const lines = await source.getCostLines(START, END, "user");
    const labels = lines.map((l) => l.group_by_value).sort();
    assert.deepEqual(labels, [
      "alice@example.com",
      "serviceAccount:ci-runner",
    ]);
  });

  it("THROWS when the pagination safety cap is exhausted with more pages remaining", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_test";
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          totalUsageEventsCount: 1000000,
          pagination: { hasNextPage: true },
          usageEvents: [
            {
              timestamp: String(new Date("2026-05-01T08:00:00Z").getTime()),
              userEmail: "alice@example.com",
              chargedCents: 100,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const source = new CursorSource(fetcher);
    await assert.rejects(
      () => source.getCostLines(START, END, "user"),
      /Cursor filtered-usage-events: pagination safety cap exhausted \(200 pages\)/,
    );
    assert.equal(calls, 200, "stops fetching at the cap");
  });
});

// ── Upstream error bodies never leak credentials into thrown errors ────────
// Regression: upstream error bodies are masked and bounded before reaching
// thrown errors. The three raw-fetch sources keep the status and a
// remediation hint; any body excerpt is masked and truncated.
describe("source HTTP errors do not leak reflected credentials", () => {
  // A 401/403 body that reflects the submitted credential — the realistic
  // worst case this guards against.
  const REFLECTED_CURSOR_KEY = "key_aB3kZ9qWxYtR7mNpLs0vUcDeFgHiJk"; // gitleaks:allow
  const REFLECTED_BEARER =
    "Authorization: Bearer sk-proj-abcdefghijklmnop1234567890ABCDEFGH";

  it("Cursor: 401 body reflecting the admin key is masked out of the error", async () => {
    process.env.CURSOR_ADMIN_API_KEY = "key_secret_live";
    const fetcher = async () =>
      new Response(`unauthorized for ${REFLECTED_CURSOR_KEY}`, {
        status: 401,
      });
    const source = new CursorSource(fetcher);
    const err = await source.getCostLines(START, END).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected a thrown error");
    assert.doesNotMatch(
      err.message,
      /key_aB3kZ9qWxYtR7mNpLs0vUcDeFgHiJk/,
      "reflected Cursor key must not appear in the error",
    );
    assert.match(err.message, /401/, "status retained");
    assert.match(
      err.message,
      /CURSOR_ADMIN_API_KEY/,
      "remediation names the env var",
    );
    assert.match(err.message, /\[REDACTED\]/, "body excerpt is masked");
  });

  it("OpenAI: 403 body echoing the Authorization header is masked", async () => {
    process.env.OPENAI_ADMIN_KEY = "sk-admin-test";
    const fetcher = async () =>
      new Response(`forbidden; ${REFLECTED_BEARER}`, { status: 403 });
    const source = new OpenAiSource(fetcher);
    const err = await source.getCostLines(START, END).then(
      () => null,
      (e) => e,
    );
    assert.ok(err);
    assert.doesNotMatch(err.message, /sk-proj-abcdefghijklmnop/);
    assert.match(err.message, /403/);
    assert.match(err.message, /OPENAI_ADMIN_KEY/);
  });

  it("Anthropic: huge 5xx body is truncated, not pasted verbatim", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const hugeBody = "x".repeat(5000);
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      // Both the initial call and the one 5xx-retry return 503 so the error
      // path (not the retry success path) is exercised.
      return new Response(hugeBody, { status: 503 });
    };
    const source = new AnthropicSource(fetcher);
    const err = await source
      .getCostLines(START, END, "workspace_id")
      .then(
        () => null,
        (e) => e,
      );
    assert.ok(err);
    assert.equal(attempts, 2, "retried once on 5xx before giving up");
    assert.match(err.message, /503/);
    assert.match(err.message, /upstream error; retry/);
    assert.ok(
      err.message.length < 400,
      `error must be bounded, got ${err.message.length} chars`,
    );
  });
});

// ── GCP (not supported) ───────────────────────────────────────────────────
describe("GcpSource", () => {
  it("is never available, whatever the env (unsupported, not unconfigured)", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/anywhere";
    const source = new GcpSource();
    assert.equal(source.isAvailable(), false);
    assert.deepEqual(await source.getCostLines(START, END), []);
    assert.deepEqual(await source.getAnomalies(7), []);
    assert.equal(await source.getForecastToMonthEnd(), null);
    assert.deepEqual(await source.probe(), {
      reachable: false,
      error: "unsupported",
    });
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });
});
