import { describe, expect, test } from "bun:test";
import type { Connection } from "@solana/web3.js";

import {
  heliusAssetResponseFixture,
  WALLET_ADDRESS,
} from "../__fixtures__/asset-fixtures";
import { createHeliusAssetProvider } from "../providers/default-asset-provider";

function createMockConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    getBalance: async () => 123,
    onAccountChange: async () => 1,
    removeAccountChangeListener: async () => undefined,
    onProgramAccountChange: async () => 2,
    removeProgramAccountChangeListener: async () => undefined,
    ...overrides,
  } as unknown as Connection;
}

function createFetchStub(response: unknown): typeof fetch {
  return (async () =>
    ({
      ok: true,
      json: async () => response,
    } as Response)) as unknown as typeof fetch;
}

describe("createHeliusAssetProvider", () => {
  test("maps helius assets into a normalized asset snapshot", async () => {
    const provider = createHeliusAssetProvider({
      env: "devnet",
      rpcEndpoint: "https://example-rpc.invalid",
      websocketEndpoint: "wss://example-rpc.invalid",
      commitment: "confirmed",
      fetchImpl: createFetchStub(heliusAssetResponseFixture),
      config: {
        createRpcConnection: () => createMockConnection(),
        createWebsocketConnection: () => createMockConnection(),
      },
    });

    const snapshot = await provider.getAssetSnapshot({
      toBase58: () => WALLET_ADDRESS,
    } as never);

    expect(snapshot.nativeBalanceLamports).toBe(2_000_000_000);
    expect(snapshot.assets).toHaveLength(3);
    expect(snapshot.assets[1]?.asset.symbol).toBe("USDC");
    expect(snapshot.assets[1]?.balance).toBe(5.25);
    expect(snapshot.assets[1]?.priceUsd).toBe(1);
  });
});
