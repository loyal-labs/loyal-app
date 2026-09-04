import { describe, expect, test } from "bun:test";
import { MAINNET_GENESIS_HASH } from "./constants";
import { assertMainnetConnection } from "./rpc";

describe("mainnet RPC identity", () => {
  test("accepts only Solana's mainnet genesis hash", async () => {
    await expect(
      assertMainnetConnection({
        getGenesisHash: async () => MAINNET_GENESIS_HASH,
      })
    ).resolves.toBeUndefined();
    await expect(
      assertMainnetConnection({ getGenesisHash: async () => "devnet-genesis" })
    ).rejects.toThrow("not Solana mainnet-beta");
  });
});
