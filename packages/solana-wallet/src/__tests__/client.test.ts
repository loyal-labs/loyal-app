import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

import { USDC_MINT, WALLET_ADDRESS } from "../__fixtures__/asset-fixtures";
import { createSolanaWalletDataClient } from "../client";
import type { ActivityProvider, AssetProvider } from "../types";

describe("createSolanaWalletDataClient", () => {
  test("caches portfolio snapshots", async () => {
    let assetCalls = 0;
    const assetProvider: AssetProvider = {
      getBalance: async () => 123,
      getAssetSnapshot: async () => {
        assetCalls += 1;
        return {
          owner: WALLET_ADDRESS,
          nativeBalanceLamports: 1_000_000_000,
          fetchedAt: Date.now(),
          assets: [
            {
              asset: {
                mint: "So11111111111111111111111111111111111111112",
                symbol: "SOL",
                name: "Solana",
                decimals: 9,
                imageUrl: null,
                isNative: true,
              },
              balance: 1,
              priceUsd: 100,
              valueUsd: 100,
            },
            {
              asset: {
                mint: USDC_MINT,
                symbol: "USDC",
                name: "USD Coin",
                decimals: 6,
                imageUrl: null,
                isNative: false,
              },
              balance: 2,
              priceUsd: 1,
              valueUsd: 2,
            },
          ],
        };
      },
      subscribeAssetChanges: async () => async () => undefined,
    };
    const activityProvider: ActivityProvider = {
      getActivity: async () => ({ activities: [], nextCursor: undefined }),
      subscribeActivity: async () => async () => undefined,
    };

    const client = createSolanaWalletDataClient({
      env: "devnet",
      assetProvider,
      activityProvider,
    });

    const first = await client.getPortfolio(WALLET_ADDRESS);
    const second = await client.getPortfolio(WALLET_ADDRESS);

    expect(assetCalls).toBe(1);
    const firstUsdc = first.positions.find(
      (position) => position.asset.mint === USDC_MINT
    );
    expect(firstUsdc?.publicBalance).toBe(2);
    expect(firstUsdc?.totalBalance).toBe(2);
    expect(second.totals.totalUsd).toBe(102);
  });

  test("rejects invalid addresses", async () => {
    const client = createSolanaWalletDataClient({
      env: "devnet",
      assetProvider: {
        getBalance: async () => 0,
        getAssetSnapshot: async () => ({
          owner: WALLET_ADDRESS,
          nativeBalanceLamports: 0,
          assets: [],
          fetchedAt: Date.now(),
        }),
        subscribeAssetChanges: async () => async () => undefined,
      },
      activityProvider: {
        getActivity: async () => ({ activities: [] }),
        subscribeActivity: async () => async () => undefined,
      },
    });

    await expect(client.getPortfolio("not-a-public-key")).rejects.toThrow(
      "Invalid public key input"
    );
  });

  test("subscribes to live activity and periodic refreshes", async () => {
    let emitted = 0;
    let refreshCalls = 0;
    const owner = new PublicKey(WALLET_ADDRESS);
    const client = createSolanaWalletDataClient({
      env: "devnet",
      assetProvider: {
        getBalance: async () => 0,
        getAssetSnapshot: async () => ({
          owner: WALLET_ADDRESS,
          nativeBalanceLamports: 0,
          assets: [],
          fetchedAt: Date.now(),
        }),
        subscribeAssetChanges: async () => async () => undefined,
      },
      activityProvider: {
        getActivity: async () => {
          refreshCalls += 1;
          return {
            activities: [
              {
                type: "sol_transfer",
                signature: "refresh-signature",
                slot: 1,
                timestamp: 1,
                direction: "in",
                amountLamports: 10,
                netChangeLamports: 10,
                feeLamports: 1,
                status: "success",
              },
            ],
          };
        },
        subscribeActivity: async (_wallet, onActivity) => {
          onActivity({
            type: "sol_transfer",
            signature: "live-signature",
            slot: 2,
            timestamp: 2,
            direction: "out",
            amountLamports: 5,
            netChangeLamports: -5,
            feeLamports: 1,
            status: "success",
          });
          return async () => undefined;
        },
      },
    });

    const unsubscribe = await client.subscribeActivity(
      owner,
      () => {
        emitted += 1;
      },
      {
        emitInitial: true,
        fallbackRefreshMs: 5,
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    await unsubscribe();

    expect(refreshCalls).toBeGreaterThan(0);
    expect(emitted).toBeGreaterThanOrEqual(2);
  });
});
