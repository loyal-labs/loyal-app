import { NextResponse } from "next/server";
import {
  getStablecoinMintForCluster,
  resolveLoyalClusterForSolanaEnv,
  Stablecoin,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import {
  ensureWalletUserSmartAccount,
  findReadyCurrentUserSmartAccount,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { hasLiveBalanceSweepTargetForWallet } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import { parseEarnDepositPrepareRequestBody } from "@/lib/yield-optimization/earn-deposit-prepare-contracts.shared";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import { resolveEligibleEarnDepositTarget } from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  findActiveYieldRoutePolicyPair,
  findReconciledActiveYieldPositionForVault,
  type RoutePolicyRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Context twin of `../prepare` for ON-DEVICE deposit prepare: same auth,
// provisioning gate, and DB reads, but instead of building the deposit here
// (a ~16-RPC-call SDK prepare that contends for this server's shared,
// per-IP-rate-limited Solana RPC pipe) it returns the inputs so the device
// runs `prepareEarnUsdcDeposit` on its own RPC/IP allowance — mirroring the
// on-device autodeposit setup/close flows. `../prepare` stays for app
// versions that predate on-device prepare; keep the auth/provisioning gate
// below in sync with it.
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

  // Resolve (provisioning if needed) the canonical smart account for this
  // wallet — same gate as `../prepare`: the first-ever provisioning is
  // sponsored, so require the wallet to already hold the USDC it is
  // depositing before minting an account for it.
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
        getConnection(solanaEnv),
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
      const ensured = await ensureWalletUserSmartAccount({
        userId: user.id,
        walletAddress,
      });
      settingsPda = ensured.smartAccount.settingsPda;
      smartAccountAddress = ensured.smartAccount.smartAccountAddress;
    }
  } catch (error) {
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[mobile-earn-deposit-prepare-context] provisioning failed", {
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
    // A top-up deposits into the reserve the position is already in (always a
    // safe USDC reserve) — same rule as `../prepare` — unless that reserve is
    // ineligible (hidden/unsampled or drained); then fall back to the default
    // reserve instead of feeding it (ASK-1764).
    const target =
      policy && activePosition
        ? await resolveEligibleEarnDepositTarget({
            cluster,
            logTag: "mobile-earn-deposit-prepare-context",
            position: activePosition,
          })
        : null;
    // Stray-approval heal, fail-closed: the SPL delegate is load-bearing for
    // sweeps, so the revoke rider is requested only when the wallet provably
    // has NO live autodeposit target (any settings, duplicates included). The
    // SDK re-checks on chain that the delegate is our subscription authority.
    let revokeStrayUsdcDelegate = false;
    try {
      revokeStrayUsdcDelegate =
        !(await hasLiveBalanceSweepTargetForWallet(walletAddress));
    } catch {
      revokeStrayUsdcDelegate = false;
    }
    return NextResponse.json({
      cluster,
      programId: serverEnv.loyalSmartAccounts.programId,
      settingsPda,
      smartAccountAddress,
      policySigner: policySigner.toBase58(),
      revokeStrayUsdcDelegate,
      yieldRoutingPolicy: policy
        ? {
            account: policy.policyAccount,
            seed: policy.policySeed.toString(),
            setupPolicy: policyResult?.setupPolicy
              ? {
                  account: policyResult.setupPolicy.policyAccount,
                  seed: policyResult.setupPolicy.policySeed.toString(),
                }
              : null,
          }
        : null,
      target: target
        ? {
            reserve: target.reserve.toBase58(),
            market: target.market.toBase58(),
            liquidityMint: target.liquidityMint.toBase58(),
            supplyApyBps: target.supplyApyBps?.toString() ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("[mobile-earn-deposit-prepare-context] context failed", {
      amountRaw: amountRaw.toString(),
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown context error.",
      errorName: error instanceof Error ? error.name : typeof error,
      policyAccount: policy?.policyAccount ?? null,
      settings: settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      500,
      "context_failed",
      error instanceof Error
        ? error.message
        : "Failed to resolve Earn deposit context."
    );
  }
}
