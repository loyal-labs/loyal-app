import { describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const D6Q6 = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
const AYL4 = "AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z";
const CANDIDATE_ONLY_RESERVE = "9TD2QVSU8T5uKfBEV6E8G3ynwn1yQU8tRvHXpQaqcWZy";
const fixture = Buffer.from(
  await Bun.file(
    new URL("./__fixtures__/d6q6-reserve.base64", import.meta.url)
  ).text(),
  "base64"
);

function reserveState(slot: bigint, stale = false): Buffer {
  const data = Buffer.from(fixture);
  data.writeBigUInt64LE(slot, 16);
  data[24] = stale ? 1 : 0;
  return data;
}

describe("sharePriceFromReserveAccount", () => {
  test("reads liquidity per collateral token from a real reserve", async () => {
    const { sharePriceFromReserveAccount } = await import(
      "./reserve-share-price.server"
    );
    const result = sharePriceFromReserveAccount(fixture);

    expect(result.sharePrice).toBeGreaterThan(1.2);
    expect(result.sharePrice).toBeLessThan(1.3);
    expect(result.market).toBe("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
    expect(result.liquidityMint).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
  });
});

describe("recordEarnReserveSharePrices", () => {
  test("records weighted reserves plus the main USDC benchmark at the hour", async () => {
    const { recordEarnReserveSharePrices } = await import(
      "./reserve-share-price.server"
    );
    const requested: string[] = [];
    const upserts: { cluster: string; rows: unknown[] }[] = [];
    const now = new Date("2026-09-23T10:47:12.000Z");

    const result = await recordEarnReserveSharePrices({
      cluster: "mainnet-beta",
      connection: {
        getBlockTime: async () => now.getTime() / 1000 - 12,
        getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => {
          requested.push(...keys.map((key) => key.toBase58()));
          return {
            context: { slot: 449_000_000 },
            value: keys.map((key) =>
              key.toBase58() === D6Q6
                ? { data: reserveState(BigInt(448_999_990)) }
                : null
            ),
          };
        },
      },
      // AYL4 is requested both as a weighted reserve and (redundantly) as a
      // candidate to assert dedup against the weights set.
      loadCandidateReserves: async () => [AYL4, CANDIDATE_ONLY_RESERVE],
      loadWeights: async () => new Map([[AYL4, 1_000_000]]),
      now,
      upsert: async (cluster, rows) => {
        upserts.push({ cluster, rows: [...rows] });
      },
    });

    expect(requested.sort()).toEqual(
      [AYL4, CANDIDATE_ONLY_RESERVE, D6Q6].sort()
    );
    expect(result).toEqual({
      missing: [AYL4, CANDIDATE_ONLY_RESERVE],
      recorded: 1,
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].cluster).toBe("mainnet-beta");
    expect(upserts[0].rows[0]).toMatchObject({
      observedAt: new Date("2026-09-23T10:47:00.000Z"),
      observedHour: new Date("2026-09-23T10:00:00.000Z"),
      reserve: D6Q6,
      slot: 448_999_990,
    });
  });

  test("buckets by actual update time across an hour boundary", async () => {
    const { recordEarnReserveSharePrices } = await import(
      "./reserve-share-price.server"
    );
    const now = new Date("2026-09-23T11:00:10.000Z");
    const observedAt = new Date("2026-09-23T10:59:59.000Z");
    const rows: { observedAt: Date; observedHour: Date }[] = [];
    let blockTimeReads = 0;
    await recordEarnReserveSharePrices({
      cluster: "mainnet-beta",
      connection: {
        getBlockTime: async () => {
          blockTimeReads++;
          return observedAt.getTime() / 1000;
        },
        getMultipleAccountsInfoAndContext: async (keys) => ({
          context: { slot: 1001 },
          value: keys.map(() => ({ data: reserveState(BigInt(1000)) })),
        }),
      },
      loadCandidateReserves: async () => [AYL4],
      loadWeights: async () => new Map(),
      now,
      upsert: async (_cluster, values) => {
        rows.push(...values);
      },
    });
    expect(blockTimeReads).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].observedAt).toEqual(observedAt);
    expect(rows[0].observedHour).toEqual(new Date("2026-09-23T10:00:00.000Z"));
  });

  test("does not fabricate observations for stale, future or unavailable reserve state", async () => {
    const { recordEarnReserveSharePrices } = await import(
      "./reserve-share-price.server"
    );
    const now = new Date("2026-09-23T11:00:00.000Z");
    const nowSeconds = now.getTime() / 1000;
    const cases = [
      { data: reserveState(BigInt(1000), true), blockTime: nowSeconds },
      { data: reserveState(BigInt(1002)), blockTime: nowSeconds },
      { data: reserveState(BigInt(0)), blockTime: nowSeconds },
      { data: reserveState(BigInt(1000)), blockTime: null },
      {
        data: reserveState(BigInt(1000)),
        blockTime: nowSeconds - 3 * 3600 - 1,
      },
      { data: reserveState(BigInt(1000)), blockTime: nowSeconds + 60 },
    ];
    for (const item of cases) {
      let written = 0;
      const result = await recordEarnReserveSharePrices({
        cluster: "mainnet-beta",
        connection: {
          getBlockTime: async () => item.blockTime,
          getMultipleAccountsInfoAndContext: async () => ({
            context: { slot: 1001 },
            value: [{ data: item.data }],
          }),
        },
        loadCandidateReserves: async () => [],
        loadWeights: async () => new Map(),
        now,
        upsert: async (_cluster, rows) => {
          written += rows.length;
        },
      });
      expect(result.missing).toEqual([D6Q6]);
      expect(written).toBe(0);
    }
  });

  test("a block-time RPC failure skips that reserve without writing fresh history", async () => {
    const { recordEarnReserveSharePrices } = await import(
      "./reserve-share-price.server"
    );
    const result = await recordEarnReserveSharePrices({
      cluster: "mainnet-beta",
      connection: {
        getBlockTime: async () => {
          throw new Error("RPC unavailable");
        },
        getMultipleAccountsInfoAndContext: async () => ({
          context: { slot: 1001 },
          value: [{ data: reserveState(BigInt(1000)) }],
        }),
      },
      loadCandidateReserves: async () => [],
      loadWeights: async () => new Map(),
      now: new Date(),
      upsert: async (_cluster, rows) => {
        expect(rows).toHaveLength(0);
      },
    });
    expect(result).toEqual({ recorded: 0, missing: [D6Q6] });
  });
});
