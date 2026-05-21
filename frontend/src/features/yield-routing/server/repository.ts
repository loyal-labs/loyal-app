import "server-only";

import { and, asc, eq, lte } from "drizzle-orm";
import {
  appSmartAccountVaultYieldPolicies,
  type AppSmartAccountVaultYieldPolicy,
  type AppUserSmartAccountSolanaEnv,
} from "@loyal-labs/db-core/schema";

import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { findAppUserSmartAccountByUserIdAndEnv } from "@/features/smart-accounts/server/repository";
import { getServerEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";
import type {
  SaveYieldRoutingPolicyRequest,
  YieldRoutingPolicyRecord,
} from "../types";

type CurrentSmartAccountContext = {
  smartAccountId: string;
  solanaEnv: AppUserSmartAccountSolanaEnv;
  userId: string;
};

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toRecord(
  policy: AppSmartAccountVaultYieldPolicy
): YieldRoutingPolicyRecord {
  return {
    id: policy.id,
    accountIndex: policy.accountIndex,
    vaultAddress: policy.vaultAddress,
    kind: policy.kind,
    state: policy.state,
    routeMint: policy.routeMint,
    rebalancePolicyPda: policy.rebalancePolicyPda,
    rebalancePolicySeed: policy.rebalancePolicySeed,
    delegatedSigner: policy.delegatedSigner,
    allowedReserves: policy.allowedReserves,
    allowedMarkets: policy.allowedMarkets,
    allowedLiquidityMints: policy.allowedLiquidityMints,
    creationSignature: policy.creationSignature,
    lastCrankedAt: serializeDate(policy.lastCrankedAt),
    nextCrankAfter: serializeDate(policy.nextCrankAfter),
    lastCrankSignature: policy.lastCrankSignature,
    lastErrorCode: policy.lastErrorCode,
    lastErrorMessage: policy.lastErrorMessage,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  };
}

async function getCurrentSmartAccountContext(
  principal: AuthenticatedPrincipal
): Promise<CurrentSmartAccountContext> {
  const user = await getOrCreateCurrentUser(principal);
  const solanaEnv = getServerEnv().solanaEnv as AppUserSmartAccountSolanaEnv;
  const smartAccount = await findAppUserSmartAccountByUserIdAndEnv(
    user.id,
    solanaEnv
  );

  if (!smartAccount || smartAccount.state !== "ready") {
    throw new Error("Smart account is not ready for yield routing.");
  }

  if (smartAccount.settingsPda !== principal.settingsPda) {
    throw new Error("Authenticated smart account does not match session.");
  }

  return {
    smartAccountId: smartAccount.id,
    solanaEnv,
    userId: user.id,
  };
}

export async function listYieldRoutingPoliciesForPrincipal(
  principal: AuthenticatedPrincipal
): Promise<YieldRoutingPolicyRecord[]> {
  const context = await getCurrentSmartAccountContext(principal);
  const db = getDatabase();
  const policies = await db.query.appSmartAccountVaultYieldPolicies.findMany({
    where: and(
      eq(appSmartAccountVaultYieldPolicies.userId, context.userId),
      eq(appSmartAccountVaultYieldPolicies.solanaEnv, context.solanaEnv)
    ),
    orderBy: asc(appSmartAccountVaultYieldPolicies.createdAt),
  });

  return policies.map(toRecord);
}

export async function saveYieldRoutingPolicyForPrincipal(args: {
  principal: AuthenticatedPrincipal;
  policy: SaveYieldRoutingPolicyRequest;
}): Promise<YieldRoutingPolicyRecord> {
  const context = await getCurrentSmartAccountContext(args.principal);
  const db = getDatabase();
  const now = new Date();
  const [result] = await db
    .insert(appSmartAccountVaultYieldPolicies)
    .values({
      userId: context.userId,
      smartAccountId: context.smartAccountId,
      solanaEnv: context.solanaEnv,
      settingsPda: args.principal.settingsPda,
      vaultAddress: args.policy.vaultAddress,
      accountIndex: args.policy.accountIndex,
      kind: "kamino_rebalance",
      state: "active",
      routeMint: args.policy.routeMint,
      rebalancePolicyPda: args.policy.rebalancePolicyPda,
      rebalancePolicySeed: args.policy.rebalancePolicySeed,
      delegatedSigner: args.policy.delegatedSigner,
      allowedReserves: args.policy.allowedReserves,
      allowedMarkets: args.policy.allowedMarkets,
      allowedLiquidityMints: args.policy.allowedLiquidityMints,
      creationSignature: args.policy.creationSignature ?? null,
      nextCrankAfter: now,
      lastCrankedAt: null,
      lastCrankSignature: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        appSmartAccountVaultYieldPolicies.solanaEnv,
        appSmartAccountVaultYieldPolicies.settingsPda,
        appSmartAccountVaultYieldPolicies.accountIndex,
        appSmartAccountVaultYieldPolicies.routeMint,
      ],
      set: {
        vaultAddress: args.policy.vaultAddress,
        kind: "kamino_rebalance",
        state: "active",
        rebalancePolicyPda: args.policy.rebalancePolicyPda,
        rebalancePolicySeed: args.policy.rebalancePolicySeed,
        delegatedSigner: args.policy.delegatedSigner,
        allowedReserves: args.policy.allowedReserves,
        allowedMarkets: args.policy.allowedMarkets,
        allowedLiquidityMints: args.policy.allowedLiquidityMints,
        creationSignature: args.policy.creationSignature ?? null,
        nextCrankAfter: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: now,
      },
    })
    .returning();

  if (!result) {
    throw new Error("Failed to save yield-routing policy.");
  }

  return toRecord(result);
}

export async function listDueYieldRoutingPolicies(args: {
  limit: number;
  now?: Date;
}): Promise<YieldRoutingPolicyRecord[]> {
  const db = getDatabase();
  const now = args.now ?? new Date();
  const rows = await db.query.appSmartAccountVaultYieldPolicies.findMany({
    where: and(
      eq(appSmartAccountVaultYieldPolicies.state, "active"),
      lte(appSmartAccountVaultYieldPolicies.nextCrankAfter, now)
    ),
    orderBy: asc(appSmartAccountVaultYieldPolicies.nextCrankAfter),
    limit: args.limit,
  });

  return rows.map(toRecord);
}
