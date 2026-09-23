import { describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const D6Q6 = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
const AYL4 = "AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z";
const fixture = Buffer.from(
  await Bun.file(
    new URL("./__fixtures__/d6q6-reserve.base64", import.meta.url)
  ).text(),
  "base64"
);

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
        getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => {
          requested.push(...keys.map((key) => key.toBase58()));
          return {
            context: { slot: 449_000_000 },
            value: keys.map((key) =>
              key.toBase58() === D6Q6 ? { data: fixture } : null
            ),
          };
        },
      },
      loadWeights: async () => new Map([[AYL4, 1_000_000]]),
      now,
      upsert: async (cluster, rows) => {
        upserts.push({ cluster, rows: [...rows] });
      },
    });

    expect(requested.sort()).toEqual([AYL4, D6Q6].sort());
    expect(result).toEqual({ missing: [AYL4], recorded: 1 });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].cluster).toBe("mainnet-beta");
    expect(upserts[0].rows[0]).toMatchObject({
      observedAt: now,
      observedHour: new Date("2026-09-23T10:00:00.000Z"),
      reserve: D6Q6,
      slot: 449_000_000,
    });
  });
});
