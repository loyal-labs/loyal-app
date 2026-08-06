import { afterEach, expect, test } from "bun:test";

import { getFrontendSolanaRpcFetch } from "./rpc-rate-limit";

afterEach(() => {
  globalThis.__loyalFrontendSolanaRpcWindow = undefined;
  delete process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND;
});

test("dispatches a burst concurrently and defers overflow to the next window", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "3";
  globalThis.__loyalFrontendSolanaRpcWindow = undefined;

  const startedAt = Date.now();
  const dispatchOffsets: number[] = [];
  const rpcFetch = getFrontendSolanaRpcFetch((async () => {
    dispatchOffsets.push(Date.now() - startedAt);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch);

  await Promise.all(
    Array.from({ length: 5 }, () => rpcFetch("https://example.invalid/rpc"))
  );

  expect(dispatchOffsets).toHaveLength(5);
  const immediate = dispatchOffsets.filter((offset) => offset < 500);
  const deferred = dispatchOffsets.filter((offset) => offset >= 900);
  expect(immediate).toHaveLength(3);
  expect(deferred).toHaveLength(2);
});
