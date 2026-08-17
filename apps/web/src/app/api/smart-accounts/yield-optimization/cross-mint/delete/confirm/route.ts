import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { removeEarnCrossMintOptIn } from "@/lib/yield-optimization/earn-cross-mint-repository.server";

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

function parseRequest(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Autoswap deletion evidence is required.");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.signature !== "string" ||
    typeof input.finalizedSlot !== "string" ||
    typeof input.expectedGeneration !== "string" ||
    !/^\d+$/.test(input.finalizedSlot) ||
    !/^\d+$/.test(input.expectedGeneration) ||
    !Array.isArray(input.policies) ||
    input.policies.length !== 2 ||
    !input.policies.every((policy) => typeof policy === "string")
  ) {
    throw new Error("Autoswap deletion evidence is incomplete.");
  }
  return {
    expectedGeneration: BigInt(input.expectedGeneration),
    finalizedSlot: BigInt(input.finalizedSlot),
    policies: input.policies.map((policy) => new PublicKey(policy as string)),
    signature: input.signature,
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }
  let input: ReturnType<typeof parseRequest>;
  try {
    input = parseRequest(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid deletion evidence."
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  if (solanaEnv !== "mainnet") {
    return jsonError(409, "unsupported_cluster", "Autoswap requires mainnet.");
  }
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const connection = getConnection(solanaEnv);
  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
  const settingsPda = new PublicKey(principal.settingsPda);
  const vaultPubkey = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId,
    settingsPda,
  })[0];

  try {
    const { value } = await connection.getSignatureStatuses([input.signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (
      !status ||
      status.err ||
      status.confirmationStatus !== "finalized" ||
      BigInt(status.slot) !== input.finalizedSlot
    ) {
      throw new Error("Autoswap deletion transaction is not finalized.");
    }
    const accountRead = await connection.getMultipleAccountsInfoAndContext(
      input.policies,
      {
        commitment: "finalized",
        minContextSlot: status.slot,
      }
    );
    if (
      BigInt(accountRead.context.slot) < input.finalizedSlot ||
      accountRead.value.some(Boolean)
    ) {
      throw new Error("Autoswap policy deletion is not finalized on-chain.");
    }
    await removeEarnCrossMintOptIn({
      authority: principal.walletAddress,
      cluster,
      expectedGeneration: input.expectedGeneration,
      expectedPolicyAccounts: input.policies.map((policy) => policy.toBase58()),
      settings: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: vaultPubkey.toBase58(),
    });
    return NextResponse.json({ enabled: false, status: "off" });
  } catch (error) {
    return jsonError(
      409,
      "delete_confirmation_failed",
      error instanceof Error
        ? error.message
        : "Autoswap deletion confirmation failed."
    );
  }
}
