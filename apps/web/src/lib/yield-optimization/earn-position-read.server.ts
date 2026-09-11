import "server-only";

import { normalizeLoyalCluster } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { Connection, PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

import {
  assertEarnFullExitProven,
  EarnCleanupConfirmError,
} from "./earn-cleanup-confirm.server";
import { fetchEarnFullVaultHoldingsSnapshot } from "./earn-full-exit-zero-proof.server";
import {
  findActiveYieldPositionsForVault,
  findEarnCleanupVaultState,
  findReconciledActiveYieldPositionForVault,
  hasInactiveYieldRoutePolicyForVault,
  type EarnCleanupVaultState,
  type UserYieldPositionRecord,
} from "./yield-deposit-repository.server";

type PositionInput = Parameters<
  typeof findReconciledActiveYieldPositionForVault
>[0];

function resolveVaultPubkey(input: PositionInput): string {
  return pda
    .getSmartAccountPda({
      accountIndex: input.vaultIndex,
      programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
      settingsPda: new PublicKey(input.settings),
    })[0]
    .toBase58();
}

async function verifyClosedPosition(
  input: PositionInput,
  state: EarnCleanupVaultState,
  positionSlot: bigint
): Promise<bigint> {
  const policies = [
    state.routePolicy,
    ...(state.setupPolicy ? [state.setupPolicy] : []),
  ];
  return assertEarnFullExitProven({
    cleanupState: state,
    cluster: normalizeLoyalCluster(input.cluster),
    connection: createReadConnection(),
    minContextSlot: Number(
      policies.reduce(
        (slot, policy) =>
          policy.lastSeenSlot > slot ? policy.lastSeenSlot : slot,
        positionSlot
      )
    ),
    policyAccounts: policies.map((policy) => policy.policyAccount),
    programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
    settingsPda: new PublicKey(input.settings),
  });
}

function createReadConnection() {
  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(
    resolveLoyalWebSolanaEnvFromEnv(process.env)
  );
  return new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
}

// Mobile displays all products. Prove the entire vault empty at a floor that
// includes EVERY accounting row before suppressing any of that aggregate. Never
// re-query unguarded rows after accepting the proof (a new deposit may arrive).
export async function findUserFacingEarnPositions(input: PositionInput) {
  const positions = await findActiveYieldPositionsForVault(input);
  const fallback =
    positions.length === 0
      ? await findReconciledActiveYieldPositionForVault(input)
      : null;
  const rows = fallback ? [fallback] : positions;
  const vaultPubkey = resolveVaultPubkey(input);
  if (
    rows.some(
      (row) =>
        row.vaultPubkey !== vaultPubkey ||
        row.settings !== input.settings ||
        row.walletAddress !== input.walletAddress ||
        row.vaultIndex !== input.vaultIndex
    )
  ) {
    throw new Error(
      "Earn position rows do not match the requested vault scope."
    );
  }
  const floor = rows.reduce(
    (slot, row) =>
      row.currentObservedSlot > slot ? row.currentObservedSlot : slot,
    BigInt(0)
  );
  const representative: UserYieldPositionRecord | null = rows[0]
    ? { ...rows[0], currentObservedSlot: floor }
    : null;
  const result = await findUserFacingEarnPosition(input, {
    findPosition: async () => representative,
    resolveVaultPubkey,
    hasInactivePolicy: hasInactiveYieldRoutePolicyForVault,
    findCleanupState: findEarnCleanupVaultState,
    verifyClosedPosition,
  });
  let fundedSnapshot = null;
  const cluster = normalizeLoyalCluster(input.cluster);
  if (result.closedPositionObservedSlot === null && rows.length > 1) {
    try {
      const snapshot = await fetchEarnFullVaultHoldingsSnapshot({
        accountingPositions: rows,
        cluster,
        connection: createReadConnection(),
        minContextSlot: Number(floor),
        programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
        settingsPda: new PublicKey(input.settings),
      });
      // Zero still requires the closed-policy proof above. A funded snapshot
      // replaces only the display total, never deletes or reassigns product rows.
      if (BigInt(snapshot.currentTotalAmountRaw) > BigInt(0))
        fundedSnapshot = snapshot;
    } catch {
      // Incomplete/unknown inventory is not permission to reduce a balance.
    }
  }
  return {
    fundedSnapshot,
    positions: result.closedPositionObservedSlot === null ? rows : [],
    closedPositionObservedSlot: result.closedPositionObservedSlot,
    vaultPubkey,
  };
}

// A successful cleanup can reach the policy catalog before position accounting.
// Never turn inactivity alone (or an RPC failure) into evidence of zero funds.
export async function findUserFacingEarnPosition(
  input: PositionInput,
  dependencies = {
    findPosition: findReconciledActiveYieldPositionForVault,
    resolveVaultPubkey,
    hasInactivePolicy: hasInactiveYieldRoutePolicyForVault,
    findCleanupState: findEarnCleanupVaultState,
    verifyClosedPosition,
  }
) {
  const position = await dependencies.findPosition(input);
  const unchanged = {
    position,
    closedPositionObservedSlot: null as string | null,
  };
  try {
    const scope = {
      authority: input.walletAddress,
      cluster: input.cluster,
      settings: input.settings,
      vaultIndex: input.vaultIndex,
      vaultPubkey:
        position?.vaultPubkey ?? dependencies.resolveVaultPubkey(input),
    };
    if (!(await dependencies.hasInactivePolicy(scope))) return unchanged;
    const state = await dependencies.findCleanupState({
      ...scope,
      includeInactive: true,
    });
    if (!state || (state.vault.active && state.routePolicy.active))
      return unchanged;
    const observedSlot = await dependencies.verifyClosedPosition(
      input,
      state,
      position?.currentObservedSlot ?? BigInt(0)
    );
    return {
      position: null,
      closedPositionObservedSlot: observedSlot.toString(),
    };
  } catch (error) {
    // Preserve visibility when proof is incomplete, funds remain, or RPC is down.
    console.warn(
      "[earn-position] inactive position closure could not be proven",
      {
        code:
          error instanceof EarnCleanupConfirmError
            ? error.code
            : "closure_read_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        settings: input.settings,
      }
    );
    return unchanged;
  }
}
