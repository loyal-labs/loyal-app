import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { parseEarnWithdrawPrepareRequestBody } from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  EarnWithdrawResolveError,
  resolveEarnUsdcWithdrawInput,
  serializeEarnUsdcWithdrawInput,
} from "@/lib/yield-optimization/earn-withdraw-input-resolution.server";

// Context twin of `../prepare` for ON-DEVICE withdraw prepare: same auth and
// source-selection/reconcile logic (shared via
// `earn-withdraw-input-resolution.server.ts`), but instead of building the
// withdrawal here it returns the resolved SDK input so the device runs
// `prepareEarnUsdcWithdraw` on its own RPC/IP allowance — mirroring the
// deposit `prepare-context` and the on-device autodeposit flows. `../prepare`
// stays for app versions that predate on-device prepare.
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
      purpose: "earn-withdraw-prepare",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
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
    } = parseEarnWithdrawPrepareRequestBody(body));
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  // Withdrawing requires an already-provisioned smart account (you can't
  // withdraw from one that was never created). Resolve it; never provision.
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
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
    smartAccountAddress = existing.smartAccountAddress;
  } catch (error) {
    console.error("[mobile-earn-withdraw-prepare-context] resolve failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown resolve error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "resolve_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);

  try {
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda: new PublicKey(settingsPda),
    });
    const resolved = await resolveEarnUsdcWithdrawInput({
      amountRaw,
      cluster,
      connection: getConnection(solanaEnv),
      earnVaultPda,
      logTag: "mobile-earn-withdraw-prepare-context",
      mode,
      policySigner: getDeploymentPolicySignerPublicKey(),
      programId,
      settingsPda,
      sourceRequest: selectedSourceRequest,
      walletAddress,
    });

    return NextResponse.json({
      cluster,
      programId: serverEnv.loyalSmartAccounts.programId,
      settingsPda,
      smartAccountAddress,
      withdrawInput: serializeEarnUsdcWithdrawInput(resolved.input),
    });
  } catch (error) {
    if (error instanceof EarnWithdrawResolveError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[mobile-earn-withdraw-prepare-context] context failed", {
      amountRaw: amountRaw.toString(),
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown context error.",
      errorName: error instanceof Error ? error.name : typeof error,
      mode,
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
        : "Failed to resolve Earn withdrawal context."
    );
  }
}
