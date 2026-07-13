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
import {
  assertEarnFullExitProven,
  EarnCleanupConfirmError,
  resolveConfirmedSignatureSlot,
} from "@/lib/yield-optimization/earn-cleanup-confirm.server";
import {
  findEarnCleanupVaultState,
  recordConfirmedEarnCleanup,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_DEPOSIT_VAULT_INDEX = 1;

const connectionCache = new Map<SolanaEnv, Connection>();

type MobileEarnCleanupConfirmFields = {
  cleanupSignature: string;
  confirmedSlot: string;
};

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

function parseMobileEarnCleanupConfirmFields(
  body: unknown
): MobileEarnCleanupConfirmFields {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.cleanupSignature !== "string" ||
    !record.cleanupSignature
  ) {
    throw new Error("cleanupSignature is required.");
  }
  if (
    typeof record.confirmedSlot !== "string" ||
    !/^\d+$/.test(record.confirmedSlot)
  ) {
    throw new Error("confirmedSlot must be a non-negative integer string.");
  }
  if (!Number.isSafeInteger(Number(record.confirmedSlot))) {
    throw new Error("confirmedSlot is outside the supported range.");
  }
  return {
    cleanupSignature: record.cleanupSignature,
    confirmedSlot: record.confirmedSlot,
  };
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
      purpose: "earn-withdraw-confirm",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let fields: MobileEarnCleanupConfirmFields;
  try {
    fields = parseMobileEarnCleanupConfirmFields(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  let settingsPda: string;
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
  } catch (error) {
    console.error("[mobile-earn-withdraw-cleanup-confirm] resolve failed", {
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
    const settingsPdaKey = new PublicKey(settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda: settingsPdaKey,
    });
    const cleanupState = await findEarnCleanupVaultState({
      authority: walletAddress,
      includeInactive: true,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
    });
    if (!cleanupState) {
      return jsonError(
        409,
        "missing_earn_policy",
        "Earn policy state is unavailable for cleanup confirmation."
      );
    }

    const connection = getConnection(solanaEnv);
    const confirmedSlot = await resolveConfirmedSignatureSlot({
      connection,
      signature: fields.cleanupSignature,
    });
    if (confirmedSlot !== BigInt(fields.confirmedSlot)) {
      return jsonError(
        400,
        "slot_mismatch",
        "Confirmed Earn cleanup slot does not match the transaction status."
      );
    }

    await assertEarnFullExitProven({
      cleanupState,
      cluster,
      connection,
      minContextSlot: Number(fields.confirmedSlot),
      policyAccounts: [
        cleanupState.routePolicy.policyAccount,
        ...(cleanupState.setupPolicy
          ? [cleanupState.setupPolicy.policyAccount]
          : []),
      ],
      programId,
      settingsPda: settingsPdaKey,
    });

    await recordConfirmedEarnCleanup({
      cleanupSignature: fields.cleanupSignature,
      cluster,
      confirmedSlot: BigInt(fields.confirmedSlot),
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
      walletAddress,
    });

    console.info("[mobile-earn-withdraw-cleanup-confirm] full exit closed", {
      cleanupSignature: fields.cleanupSignature,
      confirmedSlot: fields.confirmedSlot,
      settings: settingsPda,
      status: "full_exit_closed",
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      walletAddress,
    });
    return NextResponse.json({ ok: true, status: "full_exit_closed" });
  } catch (error) {
    if (error instanceof EarnCleanupConfirmError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[mobile-earn-withdraw-cleanup-confirm] failed", {
      cleanupSignature: fields.cleanupSignature,
      errorMessage:
        error instanceof Error ? error.message : "Unknown cleanup error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: settingsPda,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      500,
      "confirm_failed",
      error instanceof Error
        ? error.message
        : "Earn cleanup confirmation failed."
    );
  }
}
