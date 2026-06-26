import { NextResponse } from "next/server";
import {
  pda,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  SUBSCRIPTIONS_PROGRAM_ID,
  subscriptionRevokeDelegationData,
} from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import {
  findEarnPolicyRefundDbState,
  findSingleEarnPolicyRefundDbState,
} from "@/lib/yield-optimization/earn-policy-refund-state.server";
import {
  parseEarnPolicyRefundPrepareRequestBody,
  serializePreparedEarnRecurringDelegationRefund,
  serializePreparedEarnPolicyRefund,
  type EarnPolicyRefundPrepareResponse,
  type EarnPolicyRefundPrepareRequestBody,
  type EarnPolicyRefundScanPolicy,
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

function createSubscriptionRevokeDelegationInstruction(args: {
  authority: PublicKey;
  delegation: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.from(subscriptionRevokeDelegationData()),
    keys: [
      { isSigner: true, isWritable: true, pubkey: args.authority },
      { isSigner: false, isWritable: true, pubkey: args.delegation },
    ],
    programId: SUBSCRIPTIONS_PROGRAM_ID,
  });
}

function prepareRecurringDelegationRefund(args: {
  feePayer: PublicKey;
  recurringDelegation: PublicKey;
}): PreparedLoyalSmartAccountsOperation<string> {
  return {
    instructions: [
      createSubscriptionRevokeDelegationInstruction({
        authority: args.feePayer,
        delegation: args.recurringDelegation,
      }),
    ],
    lookupTableAccounts: [],
    operation: "earnRecurringDelegationRentRefund",
    payer: args.feePayer,
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    requiresConfirmation: true,
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let parsed: EarnPolicyRefundPrepareRequestBody;
  try {
    parsed = parseEarnPolicyRefundPrepareRequestBody(await request.json());
    if (parsed.kind === "recurring_delegation") {
      new PublicKey(parsed.recurringDelegation);
    } else {
      new PublicKey(parsed.policyAccount);
    }
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
    const [vaultPubkey] = pda.getSmartAccountPda({
      accountIndex: EARN_VAULT_INDEX,
      programId,
      settingsPda,
    });

    if (parsed.kind === "recurring_delegation") {
      const overview = await client.fetchPolicyOverview({
        settingsPda,
        rootSigners: [],
      });
      const policyAddresses = overview.policies.map((policy) => policy.address);
      const dbState = await findEarnPolicyRefundDbState({
        connection,
        policyAccounts: policyAddresses,
        settings: principal.settingsPda,
        vaultPubkey: vaultPubkey.toBase58(),
        walletAddress: principal.walletAddress,
      });
      const recurringDelegation = dbState.recurringDelegations.find(
        (delegation) => delegation.account === parsed.recurringDelegation
      );

      if (!recurringDelegation) {
        return jsonError(
          404,
          "delegation_not_found",
          "Recurring delegation account was not found."
        );
      }
      if (!recurringDelegation.canRefund) {
        return jsonError(
          409,
          "delegation_protected",
          recurringDelegation.blockedReason ??
            "Recurring delegation is not reclaimable."
        );
      }

      const recurringDelegationPubkey = new PublicKey(
        parsed.recurringDelegation
      );
      const prepared = prepareRecurringDelegationRefund({
        feePayer,
        recurringDelegation: recurringDelegationPubkey,
      });
      const response: EarnPolicyRefundPrepareResponse = {
        preparedRecurringDelegationRefund:
          serializePreparedEarnRecurringDelegationRefund({
            estimatedRefundLamports: recurringDelegation.lamports,
            prepared,
            recurringDelegation,
            settingsPda: principal.settingsPda,
            vaultIndex: EARN_VAULT_INDEX,
          }),
      };

      return NextResponse.json(response);
    }

    const policyAccount = new PublicKey(parsed.policyAccount);
    const [overview, accountInfo, dbState] = await Promise.all([
      client.fetchPolicyOverview({ settingsPda, rootSigners: [] }),
      connection.getAccountInfo(policyAccount, "confirmed"),
      findSingleEarnPolicyRefundDbState({
        connection,
        policyAccount: policyAccount.toBase58(),
        settings: principal.settingsPda,
        vaultPubkey: vaultPubkey.toBase58(),
        walletAddress: principal.walletAddress,
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
      recurringDelegations: dbState.recurringDelegations,
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
      requestedAccount:
        parsed.kind === "recurring_delegation"
          ? parsed.recurringDelegation
          : parsed.policyAccount,
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
