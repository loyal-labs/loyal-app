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
import type { EarnCrossMintToggleRequest } from "@/lib/yield-optimization/earn-cross-mint-policy-contracts.shared";
import {
  findEarnCrossMintState,
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

function parseRequest(value: unknown): EarnCrossMintToggleRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Autoswap toggle input is required.");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.enabled !== "boolean" ||
    typeof input.expectedGeneration !== "string" ||
    !/^\d+$/.test(input.expectedGeneration) ||
    BigInt(input.expectedGeneration) <= BigInt(0)
  ) {
    throw new Error("Autoswap toggle input is invalid.");
  }
  return {
    enabled: input.enabled,
    expectedGeneration: input.expectedGeneration,
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }
  let input: EarnCrossMintToggleRequest;
  try {
    input = parseRequest(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid Autoswap toggle."
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  if (solanaEnv !== "mainnet") {
    return jsonError(409, "unsupported_cluster", "Autoswap requires mainnet.");
  }
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
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

  try {
    const state = await findEarnCrossMintState(scope);
    if (!state) {
      return jsonError(404, "autoswap_not_found", "Autoswap is not installed.");
    }
    if (input.enabled) {
      if (state.policies.length !== 2) {
        return jsonError(
          409,
          "autoswap_policy_unavailable",
          "Autoswap permissions are not ready. Keep it paused and try again after refreshing."
        );
      }
      const client = createSmartAccountVaultsClient({
        connection: getConnection(solanaEnv),
        programId,
      });
      await client.assertEarnCrossMintCanonicalArtifacts({
        cluster,
        dailySourceMintSpendingCap: BigInt(state.dailySourceMintSpendingCap),
        maxSlippageBps: state.maxSlippageBps,
        policies: [
          {
            account: new PublicKey(state.boundPolicies[0].account),
            seed: BigInt(state.boundPolicies[0].seed),
            sourceShard: state.boundPolicies[0].sourceShard,
          },
          {
            account: new PublicKey(state.boundPolicies[1].account),
            seed: BigInt(state.boundPolicies[1].seed),
            sourceShard: state.boundPolicies[1].sourceShard,
          },
        ],
        settingsPda,
        signer: getDeploymentPolicySignerPublicKey(),
        walletAddress: new PublicKey(principal.walletAddress),
      });
    }
    const changed = await setEarnCrossMintEnabled({
      cluster,
      enabled: input.enabled,
      expectedGeneration: BigInt(input.expectedGeneration),
      settings: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: vaultPubkey.toBase58(),
    });
    if (!changed) {
      return jsonError(404, "autoswap_not_found", "Autoswap is not installed.");
    }
    const updated = await findEarnCrossMintState(scope);
    if (!updated) {
      throw new Error("Autoswap disappeared during its state transition.");
    }
    return NextResponse.json({
      enabled: updated.enabled,
      generation: updated.generation,
      status: updated.enabled ? "on" : "paused",
    });
  } catch (error) {
    return jsonError(
      409,
      "autoswap_toggle_failed",
      error instanceof Error ? error.message : "Autoswap toggle failed."
    );
  }
}
