import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
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
import {
  hasNonTerminalEarnCrossMintMovement,
  setEarnCrossMintEnabled,
} from "@/lib/yield-optimization/earn-cross-mint-repository.server";

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
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

function parseExpectedGeneration(value: unknown): bigint {
  const expectedGeneration =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).expectedGeneration
      : undefined;
  if (
    typeof expectedGeneration !== "string" ||
    !/^\d+$/.test(expectedGeneration) ||
    BigInt(expectedGeneration) <= BigInt(0)
  ) {
    throw new Error("Autoswap deletion generation is invalid.");
  }
  return BigInt(expectedGeneration);
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }
  let expectedGeneration: bigint;
  try {
    expectedGeneration = parseExpectedGeneration(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid deletion input."
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  if (solanaEnv !== "mainnet") {
    return jsonError(409, "unsupported_cluster", "Autoswap requires mainnet.");
  }
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const settingsPda = new PublicKey(principal.settingsPda);
  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
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

  try {
    await assertAuthenticatedWalletControlsSettings({
      settingsPda: principal.settingsPda,
      smartAccountAddress: principal.smartAccountAddress,
      walletAddress: principal.walletAddress,
    });
    const transition = await setEarnCrossMintEnabled({
      ...scope,
      enabled: false,
      expectedGeneration,
    });
    if (transition.kind === "missing") {
      return jsonError(404, "autoswap_not_found", "Autoswap is not installed.");
    }
    if (transition.kind === "stale") {
      throw new Error("Autoswap state changed. Refresh and try again.");
    }
    if (await hasNonTerminalEarnCrossMintMovement(scope)) {
      return jsonError(
        409,
        "movement_in_progress",
        "Autoswap is paused. Delete it after the current movement reaches a safe final state."
      );
    }

    const policies = transition.enrollment.boundPolicies.map(
      (policy) => new PublicKey(policy.account)
    );
    const accounts = await getConnection(solanaEnv).getMultipleAccountsInfo(
      policies,
      "finalized"
    );
    const remainingPolicies = policies.filter(
      (_policy, index) => accounts[index] !== null
    );
    return NextResponse.json({
      expectedGeneration: transition.enrollment.generation,
      policies: remainingPolicies.map((policy) => policy.toBase58()),
      status: remainingPolicies.length === 0 ? "off" : "ready",
    });
  } catch (error) {
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(
      409,
      "delete_readiness_failed",
      error instanceof Error
        ? error.message
        : "Failed to check Autoswap deletion readiness."
    );
  }
}
