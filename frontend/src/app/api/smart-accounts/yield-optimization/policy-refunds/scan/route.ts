import { NextResponse } from "next/server";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { and, eq, inArray, ne } from "drizzle-orm";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import type {
  EarnPolicyRefundScanPolicy,
  EarnPolicyRefundScanResponse,
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

async function findDbPolicyState(args: {
  policyAccounts: string[];
  settings: string;
}): Promise<{
  activeAutodepositAccounts: Set<string>;
  activeManagedVaultAccounts: Set<string>;
  activePositionAccounts: Set<string>;
  routePolicyAccounts: Set<string>;
}> {
  if (args.policyAccounts.length === 0) {
    return {
      activeAutodepositAccounts: new Set(),
      activeManagedVaultAccounts: new Set(),
      activePositionAccounts: new Set(),
      routePolicyAccounts: new Set(),
    };
  }

  const client = getYieldOptimizationClient();
  const [policyRows, activeVaultRows, activePositionRows, autodepositRows] =
    await Promise.all([
      client.db.query.routePolicies.findMany({
        where: and(
          eq(routePolicies.settings, args.settings),
          eq(routePolicies.vaultIndex, EARN_VAULT_INDEX),
          inArray(routePolicies.policyAccount, args.policyAccounts)
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
        columns: { policyAccount: true },
        where: and(
          eq(userYieldPositions.settings, args.settings),
          eq(userYieldPositions.vaultIndex, EARN_VAULT_INDEX),
          eq(userYieldPositions.status, "active"),
          inArray(userYieldPositions.policyAccount, args.policyAccounts)
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
            eq(balanceSweepPolicies.policyType, "subscription_sweep"),
            eq(balanceSweepPolicies.vaultIndex, EARN_VAULT_INDEX),
            inArray(balanceSweepPolicies.policyAccount, args.policyAccounts),
            inArray(balanceSweepTargets.policyAccount, args.policyAccounts),
            eq(balanceSweepTargets.settings, args.settings),
            eq(balanceSweepTargets.vaultIndex, EARN_VAULT_INDEX),
            ne(balanceSweepTargets.lifecycleStatus, "closed")
          )
        ),
    ]);

  const routePolicyAccounts = new Set(
    policyRows.map((row) => row.policyAccount)
  );
  const policyAccountById = new Map(
    policyRows.map((row) => [row.id.toString(), row.policyAccount])
  );
  const activeManagedVaultAccounts = new Set<string>();
  for (const vault of activeVaultRows) {
    const activePolicyAccount = policyAccountById.get(
      vault.activePolicyId.toString()
    );
    const setupPolicyAccount =
      typeof vault.setupPolicyId === "bigint"
        ? policyAccountById.get(vault.setupPolicyId.toString())
        : null;
    if (activePolicyAccount) {
      activeManagedVaultAccounts.add(activePolicyAccount);
    }
    if (setupPolicyAccount) {
      activeManagedVaultAccounts.add(setupPolicyAccount);
    }
  }

  return {
    activeAutodepositAccounts: new Set(
      autodepositRows.map((row) => row.policyAccount)
    ),
    activeManagedVaultAccounts,
    activePositionAccounts: new Set(
      activePositionRows.map((row) => row.policyAccount)
    ),
    routePolicyAccounts,
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

  try {
    const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(principal.settingsPda);
    const connection = getConnection(solanaEnv);
    const client = createSmartAccountVaultsClient({ connection, programId });
    const [vaultPubkey] = pda.getSmartAccountPda({
      accountIndex: EARN_VAULT_INDEX,
      programId,
      settingsPda,
    });

    const overview = await client.fetchPolicyOverview({
      settingsPda,
      rootSigners: [],
    });
    const policyAddresses = overview.policies.map((policy) => policy.address);
    const [accounts, dbState] = await Promise.all([
      policyAddresses.length === 0
        ? Promise.resolve([])
        : connection.getMultipleAccountsInfo(
            policyAddresses.map((address) => new PublicKey(address)),
            "confirmed"
          ),
      findDbPolicyState({
        policyAccounts: policyAddresses,
        settings: principal.settingsPda,
      }),
    ]);

    const policies: EarnPolicyRefundScanPolicy[] = overview.policies.map(
      (policy, index) => {
        const activeManagedVault = dbState.activeManagedVaultAccounts.has(
          policy.address
        );
        const activeAutodeposit = dbState.activeAutodepositAccounts.has(
          policy.address
        );
        const referencedByActivePosition = dbState.activePositionAccounts.has(
          policy.address
        );
        const blockedReason = getBlockedReason({
          activeAutodeposit,
          activeManagedVault,
          referencedByActivePosition,
        });

        return {
          account: policy.address,
          accountIndex: policy.accountIndex,
          activeAutodeposit,
          activeManagedVault,
          blockedReason,
          canRefund: blockedReason === null,
          dbPresent: dbState.routePolicyAccounts.has(policy.address),
          lamports: accounts[index]?.lamports ?? null,
          referencedByActivePosition,
          seed: policy.seed,
          state: policy.state,
        };
      }
    );

    const response: EarnPolicyRefundScanResponse = {
      policies,
      settingsPda: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: vaultPubkey.toBase58(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[earn-policy-refunds-scan] failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      settings: principal.settingsPda,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "scan_failed",
      error instanceof Error ? error.message : "Failed to scan policies."
    );
  }
}
