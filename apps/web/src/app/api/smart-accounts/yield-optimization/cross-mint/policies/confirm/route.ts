import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import { isEarnAutoswapEnrollmentEnabled } from "@/lib/yield-optimization/earn-autoswap-rollout.server";
import {
  type EarnCrossMintPolicyConfirmRequest,
  parseEarnCrossMintRiskInput,
} from "@/lib/yield-optimization/earn-cross-mint-policy-contracts.shared";
import {
  findEarnCrossMintState,
  recordEarnCrossMintEnrollment,
} from "@/lib/yield-optimization/earn-cross-mint-repository.server";
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
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

function parseRequest(value: unknown): EarnCrossMintPolicyConfirmRequest {
  const risk = parseEarnCrossMintRiskInput(value);
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.policies) || input.policies.length !== 2) {
    throw new Error("Exactly two Autoswap policies are required.");
  }
  const parsePolicy = (
    raw: unknown
  ): EarnCrossMintPolicyConfirmRequest["policies"][number] => {
    if (!raw || typeof raw !== "object") {
      throw new Error("Autoswap policy evidence is invalid.");
    }
    const policy = raw as Record<string, unknown>;
    const sourceShard = policy.sourceShard;
    if (sourceShard !== "classic" && sourceShard !== "token_2022") {
      throw new Error("Autoswap policy source shard is invalid.");
    }
    if (
      typeof policy.account !== "string" ||
      typeof policy.seed !== "string" ||
      (policy.signature !== undefined &&
        typeof policy.signature !== "string") ||
      (policy.finalizedSlot !== undefined &&
        typeof policy.finalizedSlot !== "string") ||
      (policy.signature === undefined) !== (policy.finalizedSlot === undefined)
    ) {
      throw new Error("Autoswap policy evidence is incomplete.");
    }
    new PublicKey(policy.account);
    BigInt(policy.seed);
    if (typeof policy.finalizedSlot === "string") {
      BigInt(policy.finalizedSlot);
    }
    return {
      account: policy.account,
      seed: policy.seed,
      signature: policy.signature,
      finalizedSlot: policy.finalizedSlot,
      sourceShard,
    };
  };
  const policies: EarnCrossMintPolicyConfirmRequest["policies"] = [
    parsePolicy(input.policies[0]),
    parsePolicy(input.policies[1]),
  ];
  if (new Set(policies.map((policy) => policy.sourceShard)).size !== 2) {
    throw new Error("Autoswap requires one policy for each source shard.");
  }
  return {
    policies,
    maxSlippageBps: risk.maxSlippageBps,
    dailySourceMintSpendingCap: risk.dailySourceMintSpendingCap.toString(),
  };
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
  let input: EarnCrossMintPolicyConfirmRequest;
  try {
    input = parseRequest(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid Autoswap evidence."
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  if (solanaEnv !== "mainnet") {
    return jsonError(409, "unsupported_cluster", "Autoswap requires mainnet.");
  }
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const connection = getConnection(solanaEnv);
  const settingsPda = new PublicKey(principal.settingsPda);
  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
  const vaultPubkey = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId,
    settingsPda,
  })[0];

  try {
    const scope = {
      authority: principal.walletAddress,
      cluster,
      settings: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: vaultPubkey.toBase58(),
    };
    const existing = await findEarnCrossMintState(scope);
    if (!existing) {
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
    }
    const submittedPolicies = input.policies.filter(
      (policy) => policy.signature && policy.finalizedSlot
    );
    const statuses = await connection.getSignatureStatuses(
      submittedPolicies.map((policy) => policy.signature!),
      { searchTransactionHistory: true }
    );
    let minContextSlot: number | undefined;
    for (const [index, policy] of submittedPolicies.entries()) {
      const status = statuses.value[index];
      if (
        !status ||
        status.err ||
        status.confirmationStatus !== "finalized" ||
        BigInt(status.slot) !== BigInt(policy.finalizedSlot!)
      ) {
        throw new Error(
          `Autoswap ${policy.sourceShard} policy transaction is not finalized.`
        );
      }
      minContextSlot = Math.max(minContextSlot ?? 0, status.slot);
    }

    const client = createSmartAccountVaultsClient({ connection, programId });
    await client.assertEarnCrossMintCanonicalArtifacts({
      cluster,
      settingsPda,
      walletAddress: new PublicKey(principal.walletAddress),
      signer: getDeploymentPolicySignerPublicKey(),
      maxSlippageBps: input.maxSlippageBps,
      minContextSlot,
      dailySourceMintSpendingCap: BigInt(input.dailySourceMintSpendingCap),
      policies: [
        {
          account: new PublicKey(input.policies[0].account),
          seed: BigInt(input.policies[0].seed),
          sourceShard: input.policies[0].sourceShard,
        },
        {
          account: new PublicKey(input.policies[1].account),
          seed: BigInt(input.policies[1].seed),
          sourceShard: input.policies[1].sourceShard,
        },
      ],
    });
    const enabled = await recordEarnCrossMintEnrollment({
      authority: principal.walletAddress,
      boundPolicies: [
        {
          account: input.policies[0].account,
          seed: input.policies[0].seed,
          sourceShard: input.policies[0].sourceShard,
        },
        {
          account: input.policies[1].account,
          seed: input.policies[1].seed,
          sourceShard: input.policies[1].sourceShard,
        },
      ],
      cluster,
      settings: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: vaultPubkey.toBase58(),
      maxSlippageBps: input.maxSlippageBps,
      dailySourceMintSpendingCap: BigInt(input.dailySourceMintSpendingCap),
    });
    return NextResponse.json({
      enabled,
      status: enabled ? "finalizing" : "paused",
    });
  } catch (error) {
    console.error("[earn-cross-mint-policy-confirm] confirm failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown error.",
      errorName: error instanceof Error ? error.name : "UnknownError",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonError(
      409,
      "confirmation_failed",
      error instanceof Error
        ? error.message
        : "Autoswap policy confirmation failed."
    );
  }
}
