import { afterEach, describe, expect, test } from "bun:test";

import { getFrontendSolanaRpcMinIntervalMs } from "../rpc-rate-limit";

const previousInterval = process.env.FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS;

afterEach(() => {
  if (previousInterval === undefined) {
    delete process.env.FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS;
  } else {
    process.env.FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS = previousInterval;
  }
});

describe("getFrontendSolanaRpcMinIntervalMs", () => {
  test("defaults to 90ms", () => {
    delete process.env.FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS;

    expect(getFrontendSolanaRpcMinIntervalMs()).toBe(90);
  });

  test("uses a valid non-negative env override", () => {
    process.env.FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS = "15";

    expect(getFrontendSolanaRpcMinIntervalMs()).toBe(15);
  });

  test("falls back to the default for invalid overrides", () => {
    process.env.FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS = "nope";

    expect(getFrontendSolanaRpcMinIntervalMs()).toBe(90);
  });
});
