import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  createSmartAccountVaultsClient,
  isEarnPolicyUpdateRequiredError,
} from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  assertAuthenticatedWalletControlsSettings,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { getPublicEnv } from "@/lib/core/config/public";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  parseEarnDepositPrepareRequestBody,
  serializePreparedEarnUsdcDeposit,
} from "@/lib/yield-optimization/earn-deposit-prepare-contracts.shared";
import {
  EarnMintNotEnabledError,
  type EarnProductAsset,
  resolveEnabledEarnProductAsset,
} from "@/lib/yield-optimization/earn-product-mints.shared";
import {
  findBestSafeEarnReserveTarget,
  resolveEligibleEarnDepositTarget,
} from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  findActiveYieldRoutePolicyPair,
  findCurrentEarnDepositOnboardingAttempt,
  findReconciledActiveYieldPositionForVault,
  type RoutePolicyRecord,
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

  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let amountRaw: bigint;
  let mint: string;
  try {
    ({ amountRaw, mint } = parseEarnDepositPrepareRequestBody(
      await request.json()
    ));
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const enabledStablecoins = getPublicEnv().earnEnabledStablecoins;
  let productMint: EarnProductAsset;
  try {
    productMint = resolveEnabledEarnProductAsset({
      cluster,
      enabledStablecoins,
      mint,
    });
  } catch (error) {
    if (error instanceof EarnMintNotEnabledError) {
      return jsonError(409, error.code, error.message);
    }
    return jsonError(
      400,
      "unsupported_mint",
      error instanceof Error ? error.message : "Unsupported Earn mint."
    );
  }
  let policy: RoutePolicyRecord | null = null;
  let setupPolicy: RoutePolicyRecord | null = null;
  let resumeRouteOnly = false;

  try {
    await assertAuthenticatedWalletControlsSettings({
      settingsPda: principal.settingsPda,
      smartAccountAddress: principal.smartAccountAddress,
      walletAddress: principal.walletAddress,
    });

    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(principal.settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda,
    });
    const [policyResult, activePosition, onboardingAttempt] = await Promise.all(
      [
        findActiveYieldRoutePolicyPair({
          authority: principal.walletAddress,
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          vaultPubkey: earnVaultPda.toBase58(),
        }),
        findReconciledActiveYieldPositionForVault({
          cluster,
          liquidityMint: mint,
          settings: principal.settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          walletAddress: principal.walletAddress,
        }),
        findCurrentEarnDepositOnboardingAttempt({
          settings: principal.settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          vaultPubkey: earnVaultPda.toBase58(),
          walletAddress: principal.walletAddress,
        }),
      ]
    );
    policy = policyResult?.routePolicy ?? null;
    setupPolicy = policyResult?.setupPolicy ?? null;
    if (
      !policy &&
      onboardingAttempt?.routePolicySignature &&
      onboardingAttempt.routePolicyConfirmedSlot
    ) {
      policy = {
        active: true,
        authority: principal.walletAddress,
        delegatedSigners: [onboardingAttempt.delegatedSigner],
        firstSeenAt: onboardingAttempt.firstSeenAt,
        id: onboardingAttempt.routePolicyDbId ?? onboardingAttempt.policyId,
        kaminoLiquidityMints: [onboardingAttempt.liquidityMint],
        kaminoMarkets: onboardingAttempt.market
          ? [onboardingAttempt.market]
          : [],
        lastSeenAt: onboardingAttempt.updatedAt,
        lastSeenSignature: onboardingAttempt.routePolicySignature,
        lastSeenSlot: onboardingAttempt.routePolicyConfirmedSlot,
        policyAccount: onboardingAttempt.policyAccount,
        policySeed: onboardingAttempt.policySeed,
        riskProfile: "safe",
        routeModes: [],
        settings: onboardingAttempt.settings,
        stableMints: [onboardingAttempt.liquidityMint],
        swapLanes: [],
        threshold: 1,
        universePreset: null,
        vaultIndex: onboardingAttempt.vaultIndex,
        vaultPubkey: onboardingAttempt.vaultPubkey,
      };
      if (
        onboardingAttempt.setupPolicySignature &&
        onboardingAttempt.setupPolicyAccount &&
        onboardingAttempt.setupPolicySeed
      ) {
        setupPolicy = {
          ...policy,
          id:
            onboardingAttempt.setupPolicyDbId ??
            onboardingAttempt.setupPolicyId ??
            onboardingAttempt.setupPolicySeed,
          lastSeenSignature: onboardingAttempt.setupPolicySignature,
          lastSeenSlot:
            onboardingAttempt.setupPolicyConfirmedSlot ??
            onboardingAttempt.routePolicyConfirmedSlot,
          policyAccount: onboardingAttempt.setupPolicyAccount,
          policySeed: onboardingAttempt.setupPolicySeed,
        };
      }
      resumeRouteOnly = !setupPolicy;
    }
    const policySigner = getDeploymentPolicySignerPublicKey();
    const client = createSmartAccountVaultsClient({
      connection: getConnection(solanaEnv),
      programId,
    });
    const yieldRoutingPolicy =
      policy && !resumeRouteOnly
        ? {
            account: new PublicKey(policy.policyAccount),
            seed: policy.policySeed,
            ...(setupPolicy
              ? {
                  setupPolicy: {
                    account: new PublicKey(setupPolicy.policyAccount),
                    seed: setupPolicy.policySeed,
                  },
                }
              : {}),
          }
        : undefined;
    // Reuse a safe current reserve for same-mint top-ups; otherwise select the
    // best eligible reserve for the requested mint. Never cross-mint fallback.
    const existingTarget =
      policy && activePosition
        ? await resolveEligibleEarnDepositTarget({
            cluster,
            liquidityMint: mint,
            logTag: "earn-deposit-prepare",
            position: activePosition,
          })
        : null;
    const target =
      existingTarget ??
      (await findBestSafeEarnReserveTarget({ cluster, productMint }));
    if (!target) {
      return jsonError(
        409,
        "no_eligible_reserve",
        "No eligible Safe Kamino reserve is available for this Earn mint."
      );
    }
    const preparedDeposit = await client.prepareEarnUsdcDeposit({
      amountRaw,
      cluster,
      feePayer: new PublicKey(principal.walletAddress),
      initializeYieldRoutingPolicy: !yieldRoutingPolicy,
      policySigner,
      settingsPda: new PublicKey(principal.settingsPda),
      walletAddress: new PublicKey(principal.walletAddress),
      target,
      ...(yieldRoutingPolicy ? { yieldRoutingPolicy } : {}),
    });
    return NextResponse.json({
      preparedDeposit: serializePreparedEarnUsdcDeposit(preparedDeposit),
    });
  } catch (error) {
    if (isEarnPolicyUpdateRequiredError(error)) {
      return jsonError(409, error.code, error.message);
    }
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }

    console.error("[earn-deposit-prepare] prepare failed", {
      amountRaw: amountRaw.toString(),
      cluster,
      mint,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      policyAccount: policy?.policyAccount ?? null,
      policySeed: policy?.policySeed.toString() ?? null,
      settings: principal.settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error ? error.message : "Failed to prepare Earn deposit."
    );
  }
}
