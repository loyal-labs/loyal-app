import { afterEach, expect, test } from "bun:test";

import {
  fetchEarnTransactions,
  invalidateEarnTransactionsCache,
  resetEarnTransactionsCacheForTests,
} from "./earn-transactions.client";

const key = {
  settingsPda: "settings",
  solanaEnv: "mainnet",
  walletAddress: "wallet",
};

afterEach(() => {
  resetEarnTransactionsCacheForTests();
});

test("coalesces concurrent Earn transaction requests per user key", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ transactions: [] }))
    );
  }) as unknown as typeof fetch;

  try {
    const [left, right] = await Promise.all([
      fetchEarnTransactions(key),
      fetchEarnTransactions(key),
    ]);
    expect(left).toEqual(right);
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls).toBe(1);
});

test("invalidates cached Earn transactions after mutation", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ transactions: [] }))
    );
  }) as unknown as typeof fetch;

  try {
    await fetchEarnTransactions(key);
    await fetchEarnTransactions(key);
    invalidateEarnTransactionsCache(key);
    await fetchEarnTransactions(key);
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls).toBe(2);
});
