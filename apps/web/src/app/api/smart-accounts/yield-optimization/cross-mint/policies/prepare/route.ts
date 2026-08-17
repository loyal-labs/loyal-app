import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  assertAuthenticatedWalletControlsSettings,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import { isEarnAutoswapEnrollmentEnabled } from "@/lib/yield-optimization/earn-autoswap-rollout.server";
import {
  parseEarnCrossMintRiskInput,
  serializePreparedEarnCrossMintSwapPolicies,
} from "@/lib/yield-optimization/earn-cross-mint-policy-contracts.shared";
import { findEarnCrossMintState } from "@/lib/yield-optimization/earn-cross-mint-repository.server";
import {
  hasActiveEarnPosition,
  hasActiveEarnRoutePolicyPair,
} from "@/lib/yield-optimization/earn-position-gate.server";

const EARN_VAULT_INDEX = 1;
const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
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
  try {
    if (!isEarnAutoswapEnrollmentEnabled(principal.walletAddress)) {
      return jsonError(
        404,
        "autoswap_unavailable",
        "Autoswap is not available."
      );
    }
  } catch (error) {
    return jsonError(
      503,
      "autoswap_rollout_invalid",
      error instanceof Error ? error.message : "Autoswap rollout is invalid."
    );
  }

  let risk: ReturnType<typeof parseEarnCrossMintRiskInput>;
  try {
    risk = parseEarnCrossMintRiskInput(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid Autoswap settings."
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  if (solanaEnv !== "mainnet") {
    return jsonError(
      409,
      "unsupported_cluster",
      "Autoswap enrollment currently requires mainnet."
    );
  }
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);

  try {
    await assertAuthenticatedWalletControlsSettings({
      settingsPda: principal.settingsPda,
      smartAccountAddress: principal.smartAccountAddress,
      walletAddress: principal.walletAddress,
    });
    const programId = new PublicKey(
      getServerEnv().loyalSmartAccounts.programId
    );
    const settingsPda = new PublicKey(principal.settingsPda);
    const vaultPubkey = pda.getSmartAccountPda({
      accountIndex: EARN_VAULT_INDEX,
      programId,
      settingsPda,
    })[0];
    const scope = {
      authority: principal.walletAddress,
      cluster,
      settings: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: vaultPubkey.toBase58(),
    };
    if (await findEarnCrossMintState(scope)) {
      return jsonError(
        409,
        "autoswap_already_installed",
        "Autoswap is already installed. Delete it before creating a new setup."
      );
    }
    const earnGate = {
      cluster,
      settingsPda: principal.settingsPda,
      walletAddress: principal.walletAddress,
    };
    const [hasPosition, hasRoutePolicyPair] = await Promise.all([
      hasActiveEarnPosition(earnGate),
      hasActiveEarnRoutePolicyPair(earnGate),
    ]);
    if (!(hasPosition && hasRoutePolicyPair)) {
      return jsonError(
        409,
        "earn_position_required",
        "Autoswap needs an active Earn account. Make a deposit first."
      );
    }
    const client = createSmartAccountVaultsClient({
      connection: getConnection(solanaEnv),
      programId,
    });
    const preparedPolicies = await client.prepareEarnCrossMintSwapPolicies({
      cluster,
      dailySourceMintSpendingCap: risk.dailySourceMintSpendingCap,
      feePayer: new PublicKey(principal.walletAddress),
      maxSlippageBps: risk.maxSlippageBps,
      settingsPda,
      signer: getDeploymentPolicySignerPublicKey(),
      walletAddress: new PublicKey(principal.walletAddress),
    });
    return NextResponse.json({
      preparedPolicies:
        serializePreparedEarnCrossMintSwapPolicies(preparedPolicies),
    });
  } catch (error) {
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[earn-cross-mint-policy-prepare] prepare failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error
        ? error.message
        : "Failed to prepare Autoswap policies."
    );
  }
}
