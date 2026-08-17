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
import { serializePreparedOperation } from "@/lib/smart-accounts/prepared-operation-wire.shared";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import {
  findEarnCrossMintState,
  hasNonTerminalEarnCrossMintMovement,
  removeEarnCrossMintOptIn,
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

function parseRequest(value: unknown): bigint {
  if (!value || typeof value !== "object") {
    throw new Error("Autoswap deletion input is required.");
  }
  const expectedGeneration = (value as Record<string, unknown>)
    .expectedGeneration;
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
    expectedGeneration = parseRequest(await request.json());
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
    const initial = await findEarnCrossMintState(scope);
    if (!initial) {
      return jsonError(404, "autoswap_not_found", "Autoswap is not installed.");
    }
    if (
      !(await setEarnCrossMintEnabled({
        cluster,
        enabled: false,
        expectedGeneration,
        settings: principal.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        vaultPubkey: vaultPubkey.toBase58(),
      }))
    ) {
      return jsonError(404, "autoswap_not_found", "Autoswap is not installed.");
    }
    const paused = await findEarnCrossMintState(scope);
    if (!paused) {
      throw new Error("Autoswap disappeared while pausing for deletion.");
    }
    if (await hasNonTerminalEarnCrossMintMovement(scope)) {
      return jsonError(
        409,
        "movement_in_progress",
        "Autoswap is paused. Delete it after the current movement reaches a safe final state."
      );
    }

    const policies = paused.boundPolicies.map((policy) => {
      const seed = BigInt(policy.seed);
      if (seed > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Autoswap policy seed is too large for this client.");
      }
      const account = new PublicKey(policy.account);
      const expectedAccount = pda.getPolicyPda({
        policySeed: Number(seed),
        programId,
        settingsPda,
      })[0];
      if (!account.equals(expectedAccount)) {
        throw new Error(
          `Autoswap ${policy.sourceShard} permission does not match its enrolled seed.`
        );
      }
      return account;
    }) as [PublicKey, PublicKey];
    const connection = getConnection(solanaEnv);
    const accounts = await connection.getMultipleAccountsInfo(
      policies,
      "finalized"
    );
    if (accounts.every((account) => account === null)) {
      await removeEarnCrossMintOptIn({
        ...scope,
        expectedGeneration: BigInt(paused.generation),
        expectedPolicyAccounts: policies.map((policy) => policy.toBase58()),
      });
      return NextResponse.json({
        expectedGeneration: paused.generation,
        policies: policies.map((policy) => policy.toBase58()),
        status: "off",
      });
    }
    const remainingPolicies = policies.filter(
      (_policy, index) => accounts[index] !== null
    );

    const client = createSmartAccountVaultsClient({ connection, programId });
    const prepared = await client.prepareClosePoliciesSync({
      feePayer: new PublicKey(principal.walletAddress),
      policies: remainingPolicies,
      settingsPda,
      signers: [new PublicKey(principal.walletAddress)],
    });
    return NextResponse.json({
      expectedGeneration: paused.generation,
      policies: policies.map((policy) => policy.toBase58()),
      prepared: serializePreparedOperation(prepared),
      status: "prepared",
    });
  } catch (error) {
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[earn-cross-mint-delete-prepare] prepare failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(
      409,
      "delete_prepare_failed",
      error instanceof Error
        ? error.message
        : "Failed to prepare Autoswap deletion."
    );
  }
}
