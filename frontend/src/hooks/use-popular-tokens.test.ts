import { afterEach, expect, test } from "bun:test";

import {
  fetchPopularTokens,
  resetPopularTokensCacheForTests,
} from "./use-popular-tokens";

afterEach(() => {
  resetPopularTokensCacheForTests();
});

test("popular token bootstrap coalesces concurrent requests", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(
        JSON.stringify([
          {
            decimals: 6,
            icon: null,
            id: "mint",
            isVerified: true,
            mcap: 1,
            name: "Token",
            symbol: new URL(String(input)).searchParams.get("query"),
            usdPrice: 1,
          },
        ])
      )
    );
  }) as unknown as typeof fetch;

  try {
    await Promise.all([fetchPopularTokens(), fetchPopularTokens()]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls).toHaveLength(10);
});

test("popular token cache serves later calls without refetching", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify([
          {
            decimals: 6,
            icon: null,
            id: "mint",
            isVerified: true,
            mcap: 1,
            name: "Token",
            symbol: new URL(String(input)).searchParams.get("query"),
            usdPrice: 1,
          },
        ])
      )
    );
  }) as unknown as typeof fetch;

  try {
    await fetchPopularTokens();
    await fetchPopularTokens();
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls).toBe(10);
});
