import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

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
import {
  EarnWithdrawResolveError,
  resolveEarnUsdcWithdrawInput,
} from "@/lib/yield-optimization/earn-withdraw-input-resolution.server";
import {
  parseEarnWithdrawPrepareRequestBody,
  serializePreparedEarnUsdcWithdraw,
} from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";
import type { RoutePolicyRecord } from "@/lib/yield-optimization/yield-deposit-repository.server";

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

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let amountRaw: bigint;
  let mode: "partial" | "full";
  let selectedSourceRequest: ReturnType<
    typeof parseEarnWithdrawPrepareRequestBody
  >["source"];
  try {
    ({
      amountRaw,
      mode,
      source: selectedSourceRequest,
    } = parseEarnWithdrawPrepareRequestBody(await request.json()));
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  let policy: RoutePolicyRecord | null = null;
  let effectiveAmountRaw: bigint | null = null;

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
    const connection = getConnection(solanaEnv);
    const resolved = await resolveEarnUsdcWithdrawInput({
      amountRaw,
      cluster,
      connection,
      earnVaultPda,
      logTag: "earn-withdraw-prepare",
      mode,
      policySigner: getDeploymentPolicySignerPublicKey(),
      programId,
      settingsPda: principal.settingsPda,
      sourceRequest: selectedSourceRequest,
      walletAddress: principal.walletAddress,
    });
    policy = resolved.policy;
    effectiveAmountRaw = resolved.effectiveAmountRaw;

    const client = createSmartAccountVaultsClient({
      connection,
      programId,
    });
    const preparedWithdraw = await client.prepareEarnUsdcWithdraw(resolved.input);

    return NextResponse.json({
      preparedWithdraw: serializePreparedEarnUsdcWithdraw(preparedWithdraw),
    });
  } catch (error) {
    if (error instanceof EarnWithdrawResolveError) {
      return jsonError(error.status, error.code, error.message);
    }
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }

    console.error("[earn-withdraw-prepare] prepare failed", {
      amountRaw: amountRaw.toString(),
      effectiveAmountRaw: effectiveAmountRaw?.toString() ?? null,
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      mode,
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
      error instanceof Error
        ? error.message
        : "Failed to prepare Earn withdrawal."
    );
  }
}
