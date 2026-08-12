import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  normalizeEarnWithdrawPreparationError,
  resolveEarnUsdcWithdrawInput,
} from "@/lib/yield-optimization/earn-withdraw-input-resolution.server";
import {
  type EarnWithdrawLegacyPrepareRequest,
  parseEarnWithdrawPrepareRequestBody,
  serializePreparedEarnUsdcWithdraw,
} from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";

// Mobile twin of `yield-optimization/withdrawals/prepare`. Identical source
// selection + prepare logic, but authenticated by a wallet signature (no
// captcha/session) and it resolves the caller's smart account itself instead
// of reading it from a session principal. Withdrawing requires an existing
// account, so (unlike deposit) it never provisions. Source selection lives in
// `earn-withdraw-input-resolution.server.ts`, shared with `../prepare-context`
// (the on-device build twin) — this route remains for app versions that
// predate on-device prepare.
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

  let amountRaw: bigint | "max";
  let sourceId: string | null;
  let legacy: EarnWithdrawLegacyPrepareRequest | null;
  try {
    ({ amountRaw, sourceId, legacy } =
      parseEarnWithdrawPrepareRequestBody(body));
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
    console.error("[mobile-earn-withdraw-prepare] resolve failed", {
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
    const connection = getConnection(solanaEnv);
    const resolved = await resolveEarnUsdcWithdrawInput({
      cluster,
      connection,
      earnVaultPda,
      legacyRequest: legacy,
      logTag: "mobile-earn-withdraw-prepare",
      requestedAmountRaw: amountRaw,
      policySigner: getDeploymentPolicySignerPublicKey(),
      programId,
      settingsPda,
      sourceId,
      walletAddress,
    });
    const client = createSmartAccountVaultsClient({
      connection,
      programId,
    });
    const preparedWithdraw = await client.prepareEarnUsdcWithdraw(
      resolved.input
    );

    return NextResponse.json({
      cluster,
      programId: serverEnv.loyalSmartAccounts.programId,
      settingsPda,
      smartAccountAddress,
      preparedWithdraw: serializePreparedEarnUsdcWithdraw(preparedWithdraw),
    });
  } catch (error) {
    const normalizedError = normalizeEarnWithdrawPreparationError(error);
    if (normalizedError) {
      return jsonError(
        normalizedError.status,
        normalizedError.code,
        normalizedError.message
      );
    }
    console.error("[mobile-earn-withdraw-prepare] prepare failed", {
      amountRaw: amountRaw === "max" ? amountRaw : amountRaw.toString(),
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      sourceId,
      settings: settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      "Failed to prepare Earn withdrawal. Refresh Earn and try again."
    );
  }
}
