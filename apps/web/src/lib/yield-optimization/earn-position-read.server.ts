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
import {
  findEarnCleanupVaultState,
  findReconciledActiveYieldPositionForVault,
  hasInactiveYieldRoutePolicyForVault,
  type EarnCleanupVaultState,
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
  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(
    resolveLoyalWebSolanaEnvFromEnv(process.env)
  );
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  const policies = [
    state.routePolicy,
    ...(state.setupPolicy ? [state.setupPolicy] : []),
  ];
  const minContextSlot = Number(
    policies.reduce(
      (slot, policy) =>
        policy.lastSeenSlot > slot ? policy.lastSeenSlot : slot,
      positionSlot
    )
  );
  return assertEarnFullExitProven({
    cleanupState: state,
    cluster: normalizeLoyalCluster(input.cluster),
    connection,
    minContextSlot,
    policyAccounts: policies.map((policy) => policy.policyAccount),
    programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
    settingsPda: new PublicKey(input.settings),
  });
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
