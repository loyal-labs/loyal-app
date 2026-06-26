import { NextResponse } from "next/server";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { findEarnPolicyRefundDbState } from "@/lib/yield-optimization/earn-policy-refund-state.server";
import type {
  EarnPolicyRefundScanPolicy,
  EarnPolicyRefundScanResponse,
} from "@/lib/yield-optimization/earn-policy-refund-contracts.shared";

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

function getBlockedReason(args: {
  activeAutodeposit: boolean;
  activeManagedVault: boolean;
  referencedByActivePosition: boolean;
}): string | null {
  if (args.referencedByActivePosition) {
    return "Active Earn position";
  }
  if (args.activeAutodeposit) {
    return "Protected recurring delegation";
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
      findEarnPolicyRefundDbState({
        connection,
        policyAccounts: policyAddresses,
        settings: principal.settingsPda,
        vaultPubkey: vaultPubkey.toBase58(),
        walletAddress: principal.walletAddress,
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
        const recurringDelegations =
          dbState.recurringDelegationsByPolicyAccount.get(policy.address) ?? [];
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
          recurringDelegations,
          referencedByActivePosition,
          seed: policy.seed,
          state: policy.state,
        };
      }
    );

    const response: EarnPolicyRefundScanResponse = {
      policies,
      recurringDelegations: dbState.recurringDelegations,
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
