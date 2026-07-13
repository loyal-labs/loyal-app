import "server-only";

import type { LoyalCluster } from "@loyal-labs/actions";
import {
  createSmartAccountVaultsClient,
  type SmartAccountEarnVaultRefundSnapshot,
} from "@loyal-labs/smart-account-vaults";
import type { Connection, PublicKey } from "@solana/web3.js";

import {
  fetchEarnRpcHoldingsSnapshot,
  type EarnRpcHolding,
  type EarnRpcHoldingsSnapshot,
  type EarnRpcPolicyMetadata,
} from "./earn-rpc-holdings.client";
import { EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW } from "./yield-deposit-repository.server";

const SLOT_LAG_ATTEMPTS = 3;
const SLOT_LAG_RETRY_DELAY_MS = 500;

export type EarnFullExitZeroProof = {
  blockingTokenAccounts: Array<{
    address: string;
    amountRaw: string;
    mint: string;
  }>;
  closeableTokenAccounts: string[];
  idleAmountRaw: string;
  idleReadsAgree: boolean;
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

  const remainingReserveHoldings = args.holdingsSnapshot.holdings.filter(
    (holding) =>
      holding.kind === "kamino" &&
      positiveAmountRaw(holding.amountRaw) > BigInt(0)
  );
  const holdingsIdleAmountRaw = args.holdingsSnapshot.holdings.reduce(
    (total, holding) =>
      holding.kind === "idle"
        ? total + positiveAmountRaw(holding.amountRaw)
        : total,
    BigInt(0)
  );
  const vaultIdleAmountRaw =
    args.vaultSnapshot.tokenAccounts.find((account) =>
      account.address.equals(args.vaultSnapshot.vaultUsdcAta)
    )?.amountRaw ?? BigInt(0);
  const idleReadsAgree = holdingsIdleAmountRaw === vaultIdleAmountRaw;
  const idleAmountRaw =
    holdingsIdleAmountRaw > vaultIdleAmountRaw
      ? holdingsIdleAmountRaw
      : vaultIdleAmountRaw;
  const blockingTokenAccounts = args.vaultSnapshot.tokenAccounts
    .filter(
      (account) =>
        !account.address.equals(args.vaultSnapshot.vaultUsdcAta) &&
        account.amountRaw > BigInt(0)
    )
    .map((account) => ({
      address: account.address.toBase58(),
      amountRaw: account.amountRaw.toString(),
      mint: account.mint.toBase58(),
    }));
  const closeableTokenAccounts = args.vaultSnapshot.tokenAccounts
    .filter(
      (account) =>
        !account.address.equals(args.vaultSnapshot.vaultUsdcAta) &&
        account.amountRaw === BigInt(0)
    )
    .map((account) => account.address.toBase58());
  const idleWithinDustTolerance =
    idleAmountRaw < EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW;
  const status =
    remainingReserveHoldings.length === 0 &&
    blockingTokenAccounts.length === 0 &&
    idleReadsAgree &&
    idleWithinDustTolerance
      ? "policy_close_required"
      : "full_exit_incomplete";

  return {
    blockingTokenAccounts,
    closeableTokenAccounts,
    idleAmountRaw: idleAmountRaw.toString(),
    idleReadsAgree,
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

  const [holdingsSnapshot, vaultSnapshot] = await readWithSlotLagRetry({
    read: () =>
      Promise.all([
        fetchHoldingsSnapshot({
          cluster: args.cluster,
          connection: args.connection,
          minContextSlot: args.minContextSlot,
          policy: args.policy,
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
    holdingsSnapshot,
    minContextSlot: args.minContextSlot,
    vaultSnapshot,
  });
}
