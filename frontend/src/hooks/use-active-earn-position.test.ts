import { afterEach, describe, expect, mock, test } from "bun:test";

import { fetchActiveEarnPosition } from "./use-active-earn-position";

const originalFetch = globalThis.fetch;

describe("fetchActiveEarnPosition", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("preserves active earn position display metadata", async () => {
    const position = {
      currentSupplyApyBps: "1048",
      depositMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      display: {
        label: "Main Market · USDC",
        marketName: "Main Market",
        mintSymbol: "USDC",
      },
      liquidityMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      market: "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J",
      principalAmountRaw: "1250000",
      status: "active",
      targetSupplyApyBps: "846",
    };

    globalThis.fetch = mock(async () => {
      return Response.json({ position });
    }) as unknown as typeof fetch;

    await expect(fetchActiveEarnPosition()).resolves.toEqual(position);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/smart-accounts/yield-optimization/position",
      { credentials: "include" }
    );
  });
});
