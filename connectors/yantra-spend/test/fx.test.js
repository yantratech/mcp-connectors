/**
 * FX module tests. Uses an injected fetcher to stub the HTTP layer; no real
 * network calls. Exercises the 60s in-process cache, the FX_GBP_PER_USD_OVERRIDE
 * shortcut, error handling, and the usdToGbp rounding.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const fx = await import("../dist/fx/fx.js");

function makeFakeFetcher(body, status = 200) {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetcher, calls: () => calls };
}

beforeEach(() => {
  fx._resetFxCacheForTests();
  delete process.env.FX_GBP_PER_USD_OVERRIDE;
  delete process.env.FX_PROVIDER_URL;
  delete process.env.FX_CACHE_TTL_SECONDS;
});

describe("gbpPerUsd", () => {
  it("returns the FX_GBP_PER_USD_OVERRIDE without HTTP", async () => {
    process.env.FX_GBP_PER_USD_OVERRIDE = "0.79";
    const { fetcher, calls } = makeFakeFetcher({});
    const rate = await fx.gbpPerUsd({ fetcher });
    assert.equal(rate, 0.79);
    assert.equal(calls(), 0, "fetcher should not be called when override is set");
  });

  it("rejects an invalid override", async () => {
    process.env.FX_GBP_PER_USD_OVERRIDE = "not-a-number";
    await assert.rejects(
      () => fx.gbpPerUsd({ fetcher: makeFakeFetcher({}).fetcher }),
      /not a positive number/,
    );
  });

  it("fetches and parses rates.GBP", async () => {
    const { fetcher } = makeFakeFetcher({ rates: { GBP: 0.7891 } });
    const rate = await fx.gbpPerUsd({ fetcher });
    assert.equal(rate, 0.7891);
  });

  it("rejects a missing GBP in the response", async () => {
    const { fetcher } = makeFakeFetcher({ rates: {} });
    await assert.rejects(() => fx.gbpPerUsd({ fetcher }), /rates.GBP/);
  });

  it("rejects a non-2xx response", async () => {
    const { fetcher } = makeFakeFetcher({}, 503);
    await assert.rejects(() => fx.gbpPerUsd({ fetcher }), /503/);
  });

  it("parses Frankfurter-shape responses (default provider)", async () => {
    // Frankfurter's actual response shape: { amount, base, date, rates: { GBP } }
    const { fetcher } = makeFakeFetcher({
      amount: 1,
      base: "USD",
      date: "2026-05-08",
      rates: { GBP: 0.7843 },
    });
    const rate = await fx.gbpPerUsd({ fetcher });
    assert.equal(rate, 0.7843);
  });

  it("caches within the TTL window", async () => {
    const { fetcher, calls } = makeFakeFetcher({ rates: { GBP: 0.79 } });
    const a = await fx.gbpPerUsd({ fetcher });
    const b = await fx.gbpPerUsd({ fetcher });
    assert.equal(a, b);
    assert.equal(calls(), 1, "second call should hit cache");
  });

  it("re-fetches after TTL expiry", async () => {
    const first = makeFakeFetcher({ rates: { GBP: 0.79 } });
    await fx.gbpPerUsd({ fetcher: first.fetcher, cacheTtlSeconds: 0 });
    const second = makeFakeFetcher({ rates: { GBP: 0.81 } });
    const rate = await fx.gbpPerUsd({
      fetcher: second.fetcher,
      cacheTtlSeconds: 0,
    });
    assert.equal(rate, 0.81);
  });
});

describe("usdToGbp", () => {
  it("rounds to 4 decimal places", () => {
    assert.equal(fx.usdToGbp(100, 0.78912345), 78.9123);
  });

  it("handles zero", () => {
    assert.equal(fx.usdToGbp(0, 0.79), 0);
  });
});
