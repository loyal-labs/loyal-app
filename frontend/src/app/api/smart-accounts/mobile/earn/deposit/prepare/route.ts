import { NextResponse } from "next/server";
import {
  getStablecoinMintForCluster,
  resolveLoyalClusterForSolanaEnv,
  Stablecoin,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import {
  ensureWalletUserSmartAccountTraced,
  findReadyCurrentUserSmartAccount,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { hasLiveBalanceSweepTargetForWallet } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import {
  parseEarnDepositPrepareRequestBody,
  serializePreparedEarnUsdcDeposit,
} from "@/lib/yield-optimization/earn-deposit-prepare-contracts.shared";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import { resolveEligibleEarnDepositTarget } from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  findActiveYieldRoutePolicyPair,
  findReconciledActiveYieldPositionForVault,
  type RoutePolicyRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Mobile twin of `/api/smart-accounts/yield-optimization/deposits/prepare`.
// Identical prepare logic, but authenticated by a wallet signature (no
// Turnstile/session) and it resolves/provisions the caller's smart account
// itself instead of reading it from a session principal. Mobile then signs +
// sends the returned prepared op with the device wallet. Keep the prepare body
// below in sync with the session route.
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

// Sum the wallet's USDC across its token accounts (parsed RPC; no spl-token
// dependency, mirroring the frontend asset provider).
async function getWalletUsdcBalanceRaw(
  connection: Connection,
  owner: PublicKey,
  usdcMint: PublicKey
): Promise<bigint> {
  const { value } = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: usdcMint,
  });
  let total = BigInt(0);
  for (const entry of value) {
    const parsed = entry.account.data.parsed as
      | { info?: { tokenAmount?: { amount?: unknown } } }
      | undefined;
    const amount = parsed?.info?.tokenAmount?.amount;
    if (typeof amount === "string") {
      total += BigInt(amount);
    }
  }
  return total;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", "Invalid request body.");
  }

  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileWalletRequest({
      body,
      purpose: "earn-deposit-prepare",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let amountRaw: bigint;
  try {
    ({ amountRaw } = parseEarnDepositPrepareRequestBody(body));
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const connection = getConnection(solanaEnv);

  // Resolve (provisioning if needed) the canonical smart account for this
  // wallet — the same account the web flow uses, so Earn is one position
  // everywhere. `ensureWalletUserSmartAccount` is idempotent: an account
  // created on web is reused at no cost. The *first-ever* provisioning is
  // sponsored (Loyal pays rent), so gate it behind real funds — the wallet must
  // already hold the USDC it is depositing. This makes free-account spam
  // economically infeasible (each new account needs a distinct funded wallet)
  // without depending on Turnstile or external rate-limit infra.
  let settingsPda: string;
  let smartAccountAddress: string;
  try {
    const user = await getOrCreateCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const existing = await findReadyCurrentUserSmartAccount({
      userId: user.id,
      walletAddress,
    });
    if (existing) {
      settingsPda = existing.settingsPda;
      smartAccountAddress = existing.smartAccountAddress;
    } else {
      const usdcMint = getStablecoinMintForCluster(cluster, Stablecoin.USDC);
      const usdcBalanceRaw = await getWalletUsdcBalanceRaw(
        connection,
        new PublicKey(walletAddress),
        usdcMint
      );
      if (usdcBalanceRaw < amountRaw) {
        return jsonError(
          402,
          "insufficient_usdc",
          "Wallet must hold the USDC it is depositing before its Earn account can be created."
        );
      }
      const ensured = await ensureWalletUserSmartAccountTraced({
        userId: user.id,
        walletAddress,
        request,
      });
      settingsPda = ensured.smartAccount.settingsPda;
      smartAccountAddress = ensured.smartAccount.smartAccountAddress;
    }
  } catch (error) {
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[mobile-earn-deposit-prepare] provisioning failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown provisioning error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "provisioning_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  let policy: RoutePolicyRecord | null = null;

  try {
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settings = new PublicKey(settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda: settings,
    });
    const [policyResult, activePosition] = await Promise.all([
      findActiveYieldRoutePolicyPair({
        authority: walletAddress,
        cluster,
        settings: settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: earnVaultPda.toBase58(),
      }),
      findReconciledActiveYieldPositionForVault({
        cluster,
        settings: settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        walletAddress,
      }),
    ]);
    policy = policyResult?.routePolicy ?? null;
    const policySigner = getDeploymentPolicySignerPublicKey();
    const client = createSmartAccountVaultsClient({
      connection,
      programId,
    });
    const yieldRoutingPolicy = policy
      ? {
          account: new PublicKey(policy.policyAccount),
          seed: policy.policySeed,
          ...(policyResult?.setupPolicy
            ? {
                setupPolicy: {
                  account: new PublicKey(
                    policyResult.setupPolicy.policyAccount
                  ),
                  seed: policyResult.setupPolicy.policySeed,
                },
              }
            : {}),
        }
      : undefined;
    // A top-up deposits into the reserve the position is already in (always a
    // safe USDC reserve), mirroring the session deposit-prepare. The previous
    // findBestSafeUsdcEarnReserveTarget re-picked the best fresh candidate and
    // hard-failed ~1-in-5 attempts whenever every safe USDC reserve was
    // momentarily flagged reserveLastUpdateStale in the Timescale feed.
    // Exception (ASK-1764): an ineligible current reserve (hidden/unsampled
    // or drained) is never followed — fall back to the default reserve.
    const target =
      policy && activePosition
        ? await resolveEligibleEarnDepositTarget({
            cluster,
            logTag: "mobile-earn-deposit-prepare",
            position: activePosition,
          })
        : null;
    // Stray-approval heal, fail-closed: the SPL delegate is load-bearing for
    // sweeps, so the revoke rider is requested only when the wallet provably
    // has NO live autodeposit target (any settings, duplicates included). On
    // a gate read error the heal is skipped, never the deposit.
    let revokeStrayUsdcDelegate = false;
    try {
      revokeStrayUsdcDelegate =
        !(await hasLiveBalanceSweepTargetForWallet(walletAddress));
    } catch {
      revokeStrayUsdcDelegate = false;
    }
    const preparedDeposit = await client.prepareEarnUsdcDeposit({
      amountRaw,
      cluster,
      feePayer: new PublicKey(walletAddress),
      initializeYieldRoutingPolicy: !policy,
      policySigner,
      revokeStrayUsdcDelegate,
      settingsPda: settings,
      walletAddress: new PublicKey(walletAddress),
      ...(target ? { target } : {}),
      ...(yieldRoutingPolicy ? { yieldRoutingPolicy } : {}),
    });
    return NextResponse.json({
      cluster,
      programId: serverEnv.loyalSmartAccounts.programId,
      settingsPda,
      smartAccountAddress,
      preparedDeposit: serializePreparedEarnUsdcDeposit(preparedDeposit),
    });
  } catch (error) {
    console.error("[mobile-earn-deposit-prepare] prepare failed", {
      amountRaw: amountRaw.toString(),
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      policyAccount: policy?.policyAccount ?? null,
      policySeed: policy?.policySeed.toString() ?? null,
      settings: settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error ? error.message : "Failed to prepare Earn deposit."
    );
  }
}
