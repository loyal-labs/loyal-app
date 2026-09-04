import "server-only";

import type { LoyalCluster } from "@loyal-labs/actions";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import { resolveLoyalSmartAccountsProgramIdFromEnv } from "@/lib/core/config/server";
import { fetchEarnRpcHoldingsSnapshot } from "./earn-rpc-holdings.client";
import {
  findActiveManagedYieldVaultWithPolicy,
  findReconciledActiveYieldPositionForVault,
  recordReconciledYieldVaultSnapshot,
} from "./yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;
const RECONCILE_CACHE_MS = 5 * 60 * 1000;
const SOURCE_COMMITMENT = "confirmed";

type ReconcileStatus = "cached" | "missing" | "refreshed";

export type EarnPositionReconciliationResult = {
  lastReconciledAt: string | null;
  lastReconciledSlot: string | null;
  positionId: string | null;
  status: ReconcileStatus;
};

type ReconciliationDependencies = {
  now: () => Date;
};

type ReconcileEarnVaultPositionInput = {
  authority: string;
  cluster: LoyalCluster;
  connection: Pick<Connection, "getMultipleAccountsInfoAndContext">;
  force?: boolean;
  minContextSlot?: number;
  purpose?: "routine" | "post_withdrawal_zero_proof";
  settings: string;
  vaultPubkey: string;
};

function isFresh(lastReconciledAt: Date | null, now: Date): boolean {
  return (
    lastReconciledAt !== null &&
    now.getTime() - lastReconciledAt.getTime() < RECONCILE_CACHE_MS
  );
}

export async function reconcileEarnVaultPosition(
  input: ReconcileEarnVaultPositionInput,
  dependencies: ReconciliationDependencies = { now: () => new Date() }
): Promise<EarnPositionReconciliationResult> {
  const now = dependencies.now();
  const managed = await findActiveManagedYieldVaultWithPolicy({
    authority: input.authority,
    cluster: input.cluster,
    settings: input.settings,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: input.vaultPubkey,
  });
  if (!managed) {
    return {
      lastReconciledAt: null,
      lastReconciledSlot: null,
      positionId: null,
      status: "missing",
    };
  }

  const position = await findReconciledActiveYieldPositionForVault({
    cluster: input.cluster,
    settings: input.settings,
    vaultIndex: EARN_VAULT_INDEX,
    walletAddress: input.authority,
  });
  if (!position) {
    return {
      lastReconciledAt: managed.vault.lastReconciledAt?.toISOString() ?? null,
      lastReconciledSlot: managed.vault.lastReconciledSlot?.toString() ?? null,
      positionId: null,
      status: "missing",
    };
  }
  if (!input.force && isFresh(managed.vault.lastReconciledAt, now)) {
    return {
      lastReconciledAt: managed.vault.lastReconciledAt?.toISOString() ?? null,
      lastReconciledSlot: managed.vault.lastReconciledSlot?.toString() ?? null,
      positionId: position.id.toString(),
      status: "cached",
    };
  }

  const snapshot = await fetchEarnRpcHoldingsSnapshot({
    cluster: input.cluster,
    connection: input.connection,
    minContextSlot: input.minContextSlot,
    now: () => now,
    policy: {
      account: managed.routePolicy.policyAccount,
      delegatedSigners: managed.routePolicy.delegatedSigners,
      id: managed.routePolicy.id.toString(),
      kaminoLiquidityMints: managed.routePolicy.kaminoLiquidityMints,
      kaminoMarkets: managed.routePolicy.kaminoMarkets,
      riskProfile: managed.routePolicy.riskProfile,
      routeModes: managed.routePolicy.routeModes,
      seed: managed.routePolicy.policySeed.toString(),
      setupPolicy: managed.setupPolicy
        ? {
            account: managed.setupPolicy.policyAccount,
            delegatedSigners: managed.setupPolicy.delegatedSigners,
            id: managed.setupPolicy.id.toString(),
            seed: managed.setupPolicy.policySeed.toString(),
          }
        : null,
      stableMints: managed.routePolicy.stableMints,
      universePreset: managed.routePolicy.universePreset,
      vaultIndex: managed.routePolicy.vaultIndex,
      vaultPubkey: managed.routePolicy.vaultPubkey,
    },
    programId: new PublicKey(
      resolveLoyalSmartAccountsProgramIdFromEnv(process.env)
    ),
    requireCompleteReserveReads: true,
    settingsPda: new PublicKey(input.settings),
  });
  const observedSlot = BigInt(snapshot.observedSlot);
  const positions = snapshot.holdings
    .filter((holding) => holding.kind === "kamino" && holding.reserve)
    .map((holding) => ({
      amountRaw: BigInt(holding.amountRaw),
      borrowApyBps: null,
      hasValue: BigInt(holding.amountRaw) > BigInt(0),
      liquidityMint: holding.liquidityMint,
      market: holding.market,
      planningMetadata: {
        ...holding.provenance,
        sourceId: holding.sourceId,
      },
      reserve: holding.reserve!,
      supplyApyBps:
        holding.supplyApyBps === null ? null : BigInt(holding.supplyApyBps),
    }));
  const idleTokenBalances = snapshot.holdings
    .filter((holding) => holding.kind === "idle")
    .map((holding) => {
      const tokenAccount = holding.provenance.tokenAccount;
      const owner = holding.provenance.owner;
      if (!(tokenAccount && owner)) {
        throw new Error("Complete Earn idle holding lacks account identity.");
      }
      return {
        amountRaw: BigInt(holding.amountRaw),
        mint: holding.liquidityMint,
        owner,
        tokenAccount,
      };
    });

  await recordReconciledYieldVaultSnapshot({
    chainSlot: observedSlot,
    context: {
      accountCount: snapshot.provenance.accountCount,
      chunkCount: snapshot.provenance.chunkCount,
      publication_scope: "complete_product_vault",
      purpose: input.purpose ?? "routine",
      source: "earn_rpc_holdings",
      sourceCommitment: SOURCE_COMMITMENT,
    },
    idleTokenBalances,
    observedAt: new Date(snapshot.observedAt),
    observedSlot,
    policyId: managed.vault.activePolicyId,
    positions,
    sourceCommitment: SOURCE_COMMITMENT,
    vaultId: managed.vault.id,
  });

  return {
    lastReconciledAt: snapshot.observedAt,
    lastReconciledSlot: snapshot.observedSlot,
    positionId: position.id.toString(),
    status: "refreshed",
  };
}
