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
      display: {
        label: "Main Market · USDC",
        marketName: "Main Market",
        mintSymbol: "USDC",
      },
      initialHolding: {
        liquidityMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        market: "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J",
        reserve: "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy",
        supplyApyBps: "846",
      },
      currentHolding: {
        amountRaw: "1250000",
        liquidityMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        market: "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J",
        observedAt: "2026-06-01T00:01:00.000Z",
        observedSlot: "124",
        provenance: {
          lastHoldingEventId: "44",
          lastRebalanceDecisionId: null,
        },
        reserve: "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy",
      },
      principalAmountRaw: "1250000",
      status: "active",
    };

    globalThis.fetch = mock(async () => {
      return Response.json({ position });
    }) as unknown as typeof fetch;

    const result = await fetchActiveEarnPosition();

    expect(result).toMatchObject({
      currentSupplyApyBps: "1048",
      display: {
        label: "Main Market · USDC",
      },
      principalAmountRaw: "1250000",
      status: "active",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/smart-accounts/yield-optimization/position",
      { credentials: "include" }
    );
  });

  test("returns null when the active position session is unauthenticated", async () => {
    globalThis.fetch = mock(async () => {
      return Response.json(
        {
          error: {
            code: "unauthenticated",
          },
        },
        { status: 401 }
      );
    }) as unknown as typeof fetch;

    await expect(fetchActiveEarnPosition()).resolves.toBeNull();
  });
});
