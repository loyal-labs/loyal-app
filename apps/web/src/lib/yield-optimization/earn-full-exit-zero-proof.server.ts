import "server-only";

import {
  getRiskBasketMarketsForCluster,
  type LoyalCluster,
  RiskBasket,
} from "@loyal-labs/actions";
import {
  createSmartAccountVaultsClient,
  type SmartAccountEarnVaultRefundSnapshot,
} from "@loyal-labs/smart-account-vaults";
import type { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import {
  fetchEarnRpcHoldingsSnapshot,
  type EarnRpcHolding,
  type EarnRpcHoldingsSnapshot,
  type EarnRpcPolicyMetadata,
} from "./earn-rpc-holdings.client";
import { getEarnProductAssetsForCluster } from "./earn-product-mints.shared";
import { EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW } from "./yield-deposit-repository.server";

const SLOT_LAG_ATTEMPTS = 3;
const SLOT_LAG_RETRY_DELAY_MS = 500;

export type EarnFullExitZeroProof = {
  blockingTokenAccounts: Array<{
    address: string;
    amountRaw: string;
    mint: string;
    tokenProgramId: string;
  }>;
  cleanupTokenAccounts: Array<{
    address: string;
    amountRaw: string;
    decimals: number;
    mint: string;
    tokenProgramId: string;
  }>;
  observedSlot: string;
  remainingHoldings: EarnRpcHolding[];
  status: "full_exit_incomplete" | "policy_close_required";
};

type EarnFullExitZeroProofDependencies = {
  fetchHoldingsSnapshot?: typeof fetchEarnRpcHoldingsSnapshot;
  fetchVaultSnapshot?: (args: {
    cluster: LoyalCluster;
    connection: Connection;
    minContextSlot: number;
    programId: PublicKey;
    settingsPda: PublicKey;
  }) => Promise<SmartAccountEarnVaultRefundSnapshot>;
  sleep?: (milliseconds: number) => Promise<void>;
};

function resolveFullExitPolicyMetadata(args: {
  cluster: LoyalCluster;
  policy: EarnRpcPolicyMetadata;
}): EarnRpcPolicyMetadata {
  const canonicalMints = getEarnProductAssetsForCluster(args.cluster).map(
    (asset) => asset.mint.toBase58()
  );
  return {
    ...args.policy,
    kaminoLiquidityMints: args.policy.kaminoLiquidityMints ?? canonicalMints,
    kaminoMarkets:
      args.policy.kaminoMarkets ??
      getRiskBasketMarketsForCluster(args.cluster, RiskBasket.Safe).map(
        (market) => market.toBase58()
      ),
    stableMints: args.policy.stableMints ?? canonicalMints,
  };
}

function isMinContextSlotError(error: unknown): boolean {
  if (
    error !== null &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === -32016
  ) {
    return true;
  }

  return (
    error instanceof Error &&
    /minimum context slot has not been reached/i.test(error.message)
  );
}

async function readWithSlotLagRetry<T>(args: {
  read: () => Promise<T>;
  sleep: (milliseconds: number) => Promise<void>;
}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SLOT_LAG_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await args.sleep(SLOT_LAG_RETRY_DELAY_MS);
    }

    try {
      return await args.read();
    } catch (error) {
      if (!isMinContextSlotError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}

function positiveAmountRaw(amountRaw: string): bigint {
  if (!/^\d+$/.test(amountRaw)) {
    throw new Error("Earn full-exit proof received an invalid balance.");
  }

  return BigInt(amountRaw);
}

function classifyZeroProof(args: {
  cluster: LoyalCluster;
  holdingsSnapshot: EarnRpcHoldingsSnapshot;
  minContextSlot: number;
  vaultSnapshot: SmartAccountEarnVaultRefundSnapshot;
}): EarnFullExitZeroProof {
  const observedSlot = Number(args.holdingsSnapshot.observedSlot);
  if (
    !Number.isSafeInteger(observedSlot) ||
    observedSlot < args.minContextSlot
  ) {
    throw new Error(
      "Earn full-exit proof was observed before the withdrawal confirmation slot."
    );
  }
  if (args.vaultSnapshot.observedSlot < args.minContextSlot) {
    throw new Error(
      "Earn vault token inventory was observed before the withdrawal confirmation slot."
    );
  }

  const remainingReserveHoldings = args.holdingsSnapshot.holdings.filter(
    (holding) =>
      holding.kind === "kamino" &&
      positiveAmountRaw(holding.amountRaw) > BigInt(0)
  );
  const idleAssetByTokenAccount = new Map(
    getEarnProductAssetsForCluster(args.cluster).map((asset) => [
      getAssociatedTokenAddressSync(
        asset.mint,
        args.vaultSnapshot.vaultPda,
        true,
        asset.tokenProgramId
      ).toBase58(),
      asset,
    ])
  );
  const blockingTokenAccounts = args.vaultSnapshot.tokenAccounts
    .filter((account) => {
      if (account.amountRaw <= BigInt(0)) {
        return false;
      }
      const asset = idleAssetByTokenAccount.get(account.address.toBase58());
      return (
        !asset ||
        !asset.mint.equals(account.mint) ||
        !asset.tokenProgramId.equals(account.tokenProgramId) ||
        account.amountRaw >= EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW
      );
    })
    .map((account) => ({
      address: account.address.toBase58(),
      amountRaw: account.amountRaw.toString(),
      mint: account.mint.toBase58(),
      tokenProgramId: account.tokenProgramId.toBase58(),
    }));
  const blockedAddresses = new Set(
    blockingTokenAccounts.map((account) => account.address)
  );
  const cleanupTokenAccounts = args.vaultSnapshot.tokenAccounts
    .filter((account) => !blockedAddresses.has(account.address.toBase58()))
    .map((account) => ({
      address: account.address.toBase58(),
      amountRaw: account.amountRaw.toString(),
      decimals: 6,
      mint: account.mint.toBase58(),
      tokenProgramId: account.tokenProgramId.toBase58(),
    }));
  const status =
    remainingReserveHoldings.length === 0 && blockingTokenAccounts.length === 0
      ? "policy_close_required"
      : "full_exit_incomplete";

  return {
    blockingTokenAccounts,
    cleanupTokenAccounts,
    observedSlot: String(observedSlot),
    remainingHoldings: args.holdingsSnapshot.holdings.filter(
      (holding) => positiveAmountRaw(holding.amountRaw) > BigInt(0)
    ),
    status,
  };
}

export async function verifyEarnFullExitZeroBalances(
  args: {
    cluster: LoyalCluster;
    connection: Connection;
    minContextSlot: number;
    policy: EarnRpcPolicyMetadata;
    programId: PublicKey;
    settingsPda: PublicKey;
  },
  dependencies: EarnFullExitZeroProofDependencies = {}
): Promise<EarnFullExitZeroProof> {
  if (!Number.isSafeInteger(args.minContextSlot) || args.minContextSlot < 0) {
    throw new Error("Earn full-exit minContextSlot is outside the safe range.");
  }
  if (
    typeof (args.connection as Pick<Connection, "getTokenAccountsByOwner">)
      .getTokenAccountsByOwner !== "function" &&
    !dependencies.fetchVaultSnapshot
  ) {
    throw new Error(
      "Earn full-exit proof cannot read all vault token accounts."
    );
  }

  const fetchHoldingsSnapshot =
    dependencies.fetchHoldingsSnapshot ?? fetchEarnRpcHoldingsSnapshot;
  const fetchVaultSnapshot =
    dependencies.fetchVaultSnapshot ??
    (async (input) =>
      createSmartAccountVaultsClient({
        connection: input.connection,
        programId: input.programId,
      }).fetchEarnVaultRefundSnapshot({
        cluster: input.cluster,
        minContextSlot: input.minContextSlot,
        settingsPda: input.settingsPda,
      }));
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  const policy = resolveFullExitPolicyMetadata({
    cluster: args.cluster,
    policy: args.policy,
  });

  const [holdingsSnapshot, vaultSnapshot] = await readWithSlotLagRetry({
    read: () =>
      Promise.all([
        fetchHoldingsSnapshot({
          cluster: args.cluster,
          connection: args.connection,
          minContextSlot: args.minContextSlot,
          policy,
          programId: args.programId,
          requireCompleteReserveReads: true,
          settingsPda: args.settingsPda,
        }),
        fetchVaultSnapshot({
          cluster: args.cluster,
          connection: args.connection,
          minContextSlot: args.minContextSlot,
          programId: args.programId,
          settingsPda: args.settingsPda,
        }),
      ]),
    sleep,
  });

  return classifyZeroProof({
    cluster: args.cluster,
    holdingsSnapshot,
    minContextSlot: args.minContextSlot,
    vaultSnapshot,
  });
}
