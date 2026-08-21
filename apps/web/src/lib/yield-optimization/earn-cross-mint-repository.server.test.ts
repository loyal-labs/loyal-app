import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const projectionRow = {
  active: true,
  authority: "wallet",
  cluster: "mainnet-beta",
  dailySourceMintSpendingCap: BigInt(300_000_000),
  delegatedSigner: "signer",
  firstSeenAt: new Date(0),
  id: BigInt(1),
  lastMutation: "create",
  lastSeenAt: new Date(0),
  lastSeenSignature: "signature",
  lastSeenSlot: BigInt(100),
  manifestFingerprint: "fingerprint",
  maxSlippageBps: 50,
  policyAccount: "classic-policy",
  policySeed: BigInt(7),
  settings: "settings",
  sourceCommitment: "finalized",
  sourceShard: "classic",
  startEligible: true,
  vaultIndex: 1,
  vaultPubkey: "vault",
};

const optInQuery = {
  from: () => ({ where: () => ({ limit: async () => [] }) }),
};
const projectionQuery = {
  from: () => ({
    where: () => ({ orderBy: async () => [projectionRow] }),
  }),
};
const select = mock()
  .mockReturnValueOnce(optInQuery)
  .mockReturnValueOnce(projectionQuery);

mock.module("./yield-neon-client.server", () => ({
  getYieldOptimizationClient: () => ({
    db: { select },
    tables: {
      crossMintSwapPolicies: {
        active: "active",
        authority: "authority",
        cluster: "cluster",
        lastSeenSlot: "last_seen_slot",
        settings: "settings",
        vaultIndex: "vault_index",
        vaultPubkey: "vault_pubkey",
      },
      crossMintVaultOptIns: {
        cluster: "cluster",
        settings: "settings",
        vaultIndex: "vault_index",
        vaultPubkey: "vault_pubkey",
      },
    },
  }),
}));

const { findEarnCrossMintSnapshot } = await import(
  "./earn-cross-mint-repository.server"
);

describe("Earn cross-mint projection snapshot", () => {
  test("returns a partial policy index when no opt-in row exists", async () => {
    const snapshot = await findEarnCrossMintSnapshot({
      authority: "wallet",
      cluster: "mainnet-beta",
      settings: "settings",
      vaultIndex: 1,
      vaultPubkey: "vault",
    });

    expect(snapshot.autoswap).toBeNull();
    expect(snapshot.autoswapIndex).toEqual({
      policies: [
        expect.objectContaining({
          account: "classic-policy",
          seed: "7",
          sourceShard: "classic",
        }),
      ],
      state: "partial",
    });
  });
});
