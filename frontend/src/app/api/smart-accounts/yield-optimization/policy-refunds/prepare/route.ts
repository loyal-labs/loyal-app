import { NextResponse } from "next/server";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { and, eq, ne } from "drizzle-orm";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import {
  parseEarnPolicyRefundPrepareRequestBody,
  serializePreparedEarnPolicyRefund,
  type EarnPolicyRefundPrepareResponse,
  type EarnPolicyRefundScanPolicy,
} from "@/lib/yield-optimization/earn-policy-refund-contracts.shared";
import {
  balanceSweepPolicies,
  balanceSweepTargets,
  getYieldOptimizationClient,
  managedVaults,
  routePolicies,
  userYieldPositions,
} from "@/lib/yield-optimization/yield-neon-client.server";

const EARN_VAULT_INDEX = 1;

const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
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

async function findSinglePolicyDbState(args: {
  policyAccount: string;
  settings: string;
}): Promise<{
  activeAutodeposit: boolean;
  activeManagedVault: boolean;
  dbPresent: boolean;
  referencedByActivePosition: boolean;
}> {
  const client = getYieldOptimizationClient();
  const [policyRows, activeVaultRows, activePositionRows, autodepositRows] =
    await Promise.all([
      client.db.query.routePolicies.findMany({
        where: and(
          eq(routePolicies.settings, args.settings),
          eq(routePolicies.vaultIndex, EARN_VAULT_INDEX),
          eq(routePolicies.policyAccount, args.policyAccount)
        ),
      }),
      client.db.query.managedVaults.findMany({
        where: and(
          eq(managedVaults.active, true),
          eq(managedVaults.settings, args.settings),
          eq(managedVaults.vaultIndex, EARN_VAULT_INDEX)
        ),
      }),
      client.db.query.userYieldPositions.findMany({
        columns: { id: true },
        where: and(
          eq(userYieldPositions.settings, args.settings),
          eq(userYieldPositions.vaultIndex, EARN_VAULT_INDEX),
          eq(userYieldPositions.status, "active"),
          eq(userYieldPositions.policyAccount, args.policyAccount)
        ),
      }),
      client.db
        .select({
          policyAccount: balanceSweepPolicies.policyAccount,
        })
        .from(balanceSweepPolicies)
        .innerJoin(
          balanceSweepTargets,
          eq(balanceSweepTargets.balanceSweepPolicyId, balanceSweepPolicies.id)
        )
        .where(
          and(
            eq(balanceSweepPolicies.active, true),
            eq(balanceSweepPolicies.settings, args.settings),
            eq(balanceSweepPolicies.policyAccount, args.policyAccount),
            eq(balanceSweepPolicies.policyType, "subscription_sweep"),
            eq(balanceSweepPolicies.vaultIndex, EARN_VAULT_INDEX),
            eq(balanceSweepTargets.policyAccount, args.policyAccount),
            eq(balanceSweepTargets.settings, args.settings),
            eq(balanceSweepTargets.vaultIndex, EARN_VAULT_INDEX),
            ne(balanceSweepTargets.lifecycleStatus, "closed")
          )
        )
        .limit(1),
    ]);

  const policyIds = new Set(policyRows.map((row) => row.id.toString()));
  const activeManagedVault = activeVaultRows.some(
    (vault) =>
      policyIds.has(vault.activePolicyId.toString()) ||
      (typeof vault.setupPolicyId === "bigint" &&
        policyIds.has(vault.setupPolicyId.toString()))
  );

  return {
    activeAutodeposit: autodepositRows.length > 0,
    activeManagedVault,
    dbPresent: policyRows.length > 0,
    referencedByActivePosition: activePositionRows.length > 0,
  };
}

function getBlockedReason(args: {
  activeAutodeposit: boolean;
  activeManagedVault: boolean;
  referencedByActivePosition: boolean;
}): string | null {
  if (args.referencedByActivePosition) {
    return "Active Earn position";
  }
  if (args.activeAutodeposit) {
    return "Active Autodeposit policy";
  }
  if (args.activeManagedVault) {
    return "Active Earn vault policy";
  }
  return null;
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let policyAccount: PublicKey;
  try {
    const body = parseEarnPolicyRefundPrepareRequestBody(await request.json());
    policyAccount = new PublicKey(body.policyAccount);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  try {
    const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(principal.settingsPda);
    const feePayer = new PublicKey(principal.walletAddress);
    const connection = getConnection(solanaEnv);
    const client = createSmartAccountVaultsClient({ connection, programId });
    const [overview, accountInfo, dbState] = await Promise.all([
      client.fetchPolicyOverview({ settingsPda, rootSigners: [] }),
      connection.getAccountInfo(policyAccount, "confirmed"),
      findSinglePolicyDbState({
        policyAccount: policyAccount.toBase58(),
        settings: principal.settingsPda,
      }),
    ]);
    if (!accountInfo) {
      return jsonError(
        409,
        "policy_closed",
        "Policy account is already closed."
      );
    }

    const overviewPolicy = overview.policies.find(
      (policy) => policy.address === policyAccount.toBase58()
    );
    if (!overviewPolicy) {
      return jsonError(
        403,
        "policy_not_owned",
        "Policy does not belong to this smart account."
      );
    }

    const blockedReason = getBlockedReason(dbState);
    const policy: EarnPolicyRefundScanPolicy = {
      account: overviewPolicy.address,
      accountIndex: overviewPolicy.accountIndex,
      activeAutodeposit: dbState.activeAutodeposit,
      activeManagedVault: dbState.activeManagedVault,
      blockedReason,
      canRefund: blockedReason === null,
      dbPresent: dbState.dbPresent,
      lamports: accountInfo.lamports,
      referencedByActivePosition: dbState.referencedByActivePosition,
      seed: overviewPolicy.seed,
      state: overviewPolicy.state,
    };

    if (blockedReason) {
      return jsonError(409, "policy_active", blockedReason);
    }

    const prepared = await client.prepareClosePoliciesSync({
      feePayer,
      policies: [policyAccount],
      settingsPda,
      signers: [feePayer],
    });
    const response: EarnPolicyRefundPrepareResponse = {
      preparedRefund: serializePreparedEarnPolicyRefund({
        estimatedRefundLamports: accountInfo.lamports,
        policy,
        prepared,
        settingsPda: principal.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
      }),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[earn-policy-refunds-prepare] failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      policyAccount: policyAccount.toBase58(),
      settings: principal.settingsPda,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error ? error.message : "Failed to prepare refund."
    );
  }
}
