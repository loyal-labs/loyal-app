import { afterEach, expect, test } from "bun:test";

import {
  fetchTokenMarkets,
  normalizeTokenMarketMintsSignature,
  resetTokenMarketsCacheForTests,
} from "./token-markets.client";

afterEach(() => {
  resetTokenMarketsCacheForTests();
});

test("normalizes token market mint signatures", () => {
  expect(normalizeTokenMarketMintsSignature(" b, a ,,c ")).toBe("a,b,c");
});

test("coalesces concurrent token market requests by normalized key", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://app.test" } },
  });
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          markets: [{ mint: "a", priceChange24hPercent: 1 }],
        })
      )
    );
  }) as unknown as typeof fetch;

  try {
    const [left, right] = await Promise.all([
      fetchTokenMarkets("b,a"),
      fetchTokenMarkets("a,b"),
    ]);
    expect(left).toEqual(right);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }

  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("mints=a%2Cb");
});

test("serves token markets from TTL cache", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://app.test" } },
  });
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ markets: [] }))
    );
  }) as unknown as typeof fetch;

  try {
    await fetchTokenMarkets("a,b");
    await fetchTokenMarkets("b,a");
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }

  expect(calls).toBe(1);
});
