import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  findCurrentEarnAutodepositState,
  reconcileMissingOnChainEarnAutodepositPolicy,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import { serializePreparedEarnUsdcCleanup } from "@/lib/yield-optimization/earn-withdraw-cleanup-contracts.shared";
import {
  findEarnCleanupVaultState,
  type CurrentYieldVaultReservePositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_DEPOSIT_VAULT_INDEX = 1;

const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
}

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getServerSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

function publicKeyFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
): PublicKey | null {
  if (!metadata) {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    try {
      return new PublicKey(value);
    } catch {
      continue;
    }
  }

  return null;
}

function resolveVaultCollateralAtas(
  rows: CurrentYieldVaultReservePositionRecord[]
): PublicKey[] {
  const seen = new Set<string>();
  const atas: PublicKey[] = [];

  for (const row of rows) {
    const vaultCollateralAta = publicKeyFromMetadata(row.planningMetadata, [
      "vaultCollateralAta",
      "vault_collateral_ata",
      "collateralAta",
      "collateral_ata",
    ]);
    if (!vaultCollateralAta) {
      continue;
    }
    const key = vaultCollateralAta.toBase58();
    if (!seen.has(key)) {
      seen.add(key);
      atas.push(vaultCollateralAta);
    }
  }

  return atas;
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  try {
    const solanaEnv = getConfiguredSolanaEnv();
    const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(principal.settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda,
    });
    const cleanupState = await findEarnCleanupVaultState({
      authority: principal.walletAddress,
      settings: principal.settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
    });
    if (!cleanupState) {
      return jsonError(
        409,
        "missing_earn_policy",
        "No active Earn accounts were found to close."
      );
    }

    const activeReserveRows = cleanupState.reserveRows.filter(
      (row) => row.amountRaw > BigInt(0)
    );
    if (activeReserveRows.length > 0) {
      return jsonError(
        409,
        "active_earn_sources_remaining",
        "Withdraw active Earn sources before closing Earn accounts."
      );
    }

    const idleAmountRaw = cleanupState.idleRows.reduce(
      (total, row) => total + row.amountRaw,
      BigInt(0)
    );
    const connection = getConnection(solanaEnv);
    const client = createSmartAccountVaultsClient({ connection, programId });
    const autodepositState = await findCurrentEarnAutodepositState({
      settings: principal.settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      walletAddress: principal.walletAddress,
    });
    let autodepositClose:
      | {
          policy: PublicKey;
          recurringDelegation: PublicKey;
        }
      | undefined;

    if (
      autodepositState?.policy.policyAccount &&
      autodepositState.target.recurringDelegation
    ) {
      const autodepositPolicyAccount = new PublicKey(
        autodepositState.policy.policyAccount
      );
      const autodepositPolicyInfo = await connection.getAccountInfo(
        autodepositPolicyAccount,
        "confirmed"
      );

      if (autodepositPolicyInfo) {
        autodepositClose = {
          policy: autodepositPolicyAccount,
          recurringDelegation: new PublicKey(
            autodepositState.target.recurringDelegation
          ),
        };
      } else {
        await reconcileMissingOnChainEarnAutodepositPolicy({
          policyAccount: autodepositState.policy.policyAccount,
          settings: principal.settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          walletAddress: principal.walletAddress,
        });
      }
    }

    const policyAccounts = [
      cleanupState.routePolicy.policyAccount,
      ...(cleanupState.setupPolicy?.policyAccount
        ? [cleanupState.setupPolicy.policyAccount]
        : []),
    ];
    const policyInfos =
      policyAccounts.length === 0
        ? []
        : await connection.getMultipleAccountsInfo(
            policyAccounts.map((account) => new PublicKey(account)),
            "confirmed"
          );
    const preparedCleanup = await client.prepareEarnUsdcCleanup({
      cluster,
      closeVaultCollateralAtas: resolveVaultCollateralAtas(
        cleanupState.reserveRows
      ),
      feePayer: new PublicKey(principal.walletAddress),
      idleAmountRaw,
      policySigner: getDeploymentPolicySignerPublicKey(),
      settingsPda,
      walletAddress: new PublicKey(principal.walletAddress),
      yieldRoutingPolicy: {
        account: new PublicKey(cleanupState.routePolicy.policyAccount),
        seed: cleanupState.routePolicy.policySeed,
        ...(cleanupState.setupPolicy
          ? {
              setupPolicy: {
                account: new PublicKey(cleanupState.setupPolicy.policyAccount),
                seed: cleanupState.setupPolicy.policySeed,
              },
            }
          : {}),
      },
      ...(autodepositClose ? { autodepositClose } : {}),
    });

    return NextResponse.json({
      preparedCleanup: serializePreparedEarnUsdcCleanup({
        estimatedRefundLamports:
          policyInfos.length > 0
            ? policyInfos.reduce(
                (total, account) => total + (account?.lamports ?? 0),
                0
              )
            : null,
        preparedCleanup,
      }),
    });
  } catch (error) {
    console.error("[earn-withdraw-cleanup-prepare] prepare failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: principal.settingsPda,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error
        ? error.message
        : "Failed to prepare Earn cleanup."
    );
  }
}
