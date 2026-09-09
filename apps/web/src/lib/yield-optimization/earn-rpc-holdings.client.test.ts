import { getKaminoUsdcEarnTargetForCluster } from "@loyal-labs/actions";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, test } from "bun:test";

import {
  deriveEarnVaultPda,
  fetchEarnRpcHoldingsSnapshot,
} from "./earn-rpc-holdings.client";

const target = getKaminoUsdcEarnTargetForCluster("mainnet-beta");
const mint = target.liquidityMint.toBase58();
const policy = {
  account: PublicKey.default.toBase58(),
  kaminoLiquidityMints: [mint],
  kaminoMarkets: [target.market.toBase58()],
  seed: "1",
  stableMints: [mint],
  vaultIndex: 1,
  vaultPubkey: PublicKey.default.toBase58(),
};

function snapshot(slot: number, incomplete = false) {
  return fetchEarnRpcHoldingsSnapshot({
    cluster: "mainnet-beta",
    connection: {
      getMultipleAccountsInfoAndContext: async (keys, config) => {
        // The RPC may ignore the requested floor; verify its response too.
        expect(config).toMatchObject({ minContextSlot: 500 });
        return {
          context: { slot },
          value: incomplete ? [] : keys.map(() => null),
        };
      },
    },
    minContextSlot: 500,
    policy,
    programId: PublicKey.default,
    settingsPda: PublicKey.default,
  });
}

describe("post-confirm Earn holdings proof", () => {
  test("a lagging RPC cannot replace a confirmed balance with zero", async () => {
    await expect(snapshot(499)).rejects.toThrow("slot fence");
    const current = await snapshot(500);
    expect(current.currentTotalAmountRaw).toBe("0");
  });

  test("missing batch entries cannot fabricate a complete zero balance", async () => {
    await expect(snapshot(501, true)).rejects.toThrow("incomplete batch");
  });

  test("a newer reserve response cannot acknowledge a mutation absent from balance accounts", async () => {
    const vault = deriveEarnVaultPda({ programId: PublicKey.default, settingsPda: PublicKey.default });
    // Minimal valid protocol accounts, with 10 collateral redeemable 1:1.
    const obligation = Buffer.alloc(1184);
    Buffer.from([168, 206, 141, 106, 88, 76, 172, 167]).copy(obligation);
    target.market.toBuffer().copy(obligation, 32);
    vault.toBuffer().copy(obligation, 64);
    target.reserve.toBuffer().copy(obligation, 96);
    obligation.writeBigUInt64LE(10n, 128);
    const reserve = Buffer.alloc(2640);
    Buffer.from([43, 242, 204, 202, 26, 247, 59, 127]).copy(reserve);
    target.market.toBuffer().copy(reserve, 32);
    target.liquidityMint.toBuffer().copy(reserve, 128);
    TOKEN_PROGRAM_ID.toBuffer().copy(reserve, 408);
    reserve.writeBigUInt64LE(100n, 224);
    reserve.writeBigUInt64LE(100n, 2592);
    const account = (data: Buffer) => ({ data, executable: false, lamports: 1, owner: target.lendProgramId, rentEpoch: 0 });
    let reads = 0;
    const current = await fetchEarnRpcHoldingsSnapshot({
      cluster: "mainnet-beta",
      connection: {
        getMultipleAccountsInfoAndContext: async (keys) => {
          reads++;
          return reads === 1
            ? { context: { slot: 500 }, value: keys.map((_, i) => i === 0 ? null : account(obligation)) }
            : { context: { slot: 600 }, value: keys.map(() => account(reserve)) };
        },
      },
      minContextSlot: 500,
      policy,
      programId: PublicKey.default,
      settingsPda: PublicKey.default,
    });
    expect(current.currentTotalAmountRaw).toBe("10");
    // A deposit at slot 550 is NOT in this snapshot, despite the reserve at 600.
    expect(BigInt(current.observedSlot) < 550n).toBe(true);
  });
});
