import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import {
  deriveEarnCrossMintPolicyIndex,
  type EarnCrossMintPolicyIndex,
} from "./earn-cross-mint-policy-index.shared";
import { getYieldOptimizationClient } from "./yield-neon-client.server";

export type EarnCrossMintBoundPolicy = {
  account: string;
  seed: string;
  sourceShard: "classic" | "token_2022";
};

export type EarnCrossMintPolicyState = EarnCrossMintBoundPolicy & {
  lastSeenSignature: string;
  lastSeenSlot: string;
};

export type EarnCrossMintState = {
  boundPolicies: readonly [EarnCrossMintBoundPolicy, EarnCrossMintBoundPolicy];
  dailySourceMintSpendingCap: string;
  enabled: boolean;
  generation: string;
  maxSlippageBps: number;
  policies: EarnCrossMintPolicyState[];
  status: "finalizing" | "on" | "paused";
};

export type EarnCrossMintEnrollment = Omit<
  EarnCrossMintState,
  "policies" | "status"
>;

export type EarnCrossMintTransitionResult =
  | { enrollment: EarnCrossMintEnrollment; kind: "applied" | "idempotent" }
  | { enrollment: EarnCrossMintEnrollment; kind: "stale" }
  | { enrollment: null; kind: "missing" };

export type EarnCrossMintScope = {
  authority: string;
  cluster: string;
  settings: string;
  vaultIndex: number;
  vaultPubkey: string;
};

export type EarnCrossMintSnapshot = {
  autoswap: EarnCrossMintState | null;
  autoswapIndex: EarnCrossMintPolicyIndex;
};

type EarnCrossMintStoredScope = Omit<EarnCrossMintScope, "authority">;

function optInWhere(
  scope: EarnCrossMintStoredScope,
  table: ReturnType<
    typeof getYieldOptimizationClient
  >["tables"]["crossMintVaultOptIns"]
) {
  return and(
    eq(table.cluster, scope.cluster),
    eq(table.settings, scope.settings),
    eq(table.vaultIndex, scope.vaultIndex),
    eq(table.vaultPubkey, scope.vaultPubkey)
  );
}

async function loadEarnCrossMintOptIn(scope: EarnCrossMintStoredScope) {
  const client = getYieldOptimizationClient();
  const [optIn] = await client.db
    .select()
    .from(client.tables.crossMintVaultOptIns)
    .where(optInWhere(scope, client.tables.crossMintVaultOptIns))
    .limit(1);
  return optIn ?? null;
}

function getExecuteRows(result: unknown): Record<string, unknown>[] {
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

export async function findEarnCrossMintSnapshot(
  scope: EarnCrossMintScope
): Promise<EarnCrossMintSnapshot> {
  const client = getYieldOptimizationClient();
  const { crossMintSwapPolicies, crossMintVaultOptIns } = client.tables;
  const [[optIn], rows] = await Promise.all([
    client.db
      .select()
      .from(crossMintVaultOptIns)
      .where(optInWhere(scope, crossMintVaultOptIns))
      .limit(1),
    client.db
      .select()
      .from(crossMintSwapPolicies)
      .where(
        and(
          eq(crossMintSwapPolicies.cluster, scope.cluster),
          eq(crossMintSwapPolicies.settings, scope.settings),
          eq(crossMintSwapPolicies.authority, scope.authority),
          eq(crossMintSwapPolicies.vaultIndex, scope.vaultIndex),
          eq(crossMintSwapPolicies.vaultPubkey, scope.vaultPubkey)
        )
      )
      .orderBy(desc(crossMintSwapPolicies.lastSeenSlot)),
  ]);
  const autoswapIndex = deriveEarnCrossMintPolicyIndex(rows);
  if (!optIn || autoswapIndex.state !== "complete") {
    return { autoswap: null, autoswapIndex };
  }

  const [classic, token2022] = autoswapIndex.policies;
  if (!(classic && token2022)) {
    return { autoswap: null, autoswapIndex };
  }
  const pairIsFinalized = autoswapIndex.policies.every(
    (policy) => policy.sourceCommitment === "finalized"
  );
  const boundPolicies: EarnCrossMintState["boundPolicies"] = [
    {
      account: classic.account,
      seed: classic.seed,
      sourceShard: "classic",
    },
    {
      account: token2022.account,
      seed: token2022.seed,
      sourceShard: "token_2022",
    },
  ];
  const policies = pairIsFinalized
    ? [classic, token2022].map((policy, index) => ({
        ...boundPolicies[index],
        lastSeenSignature: policy.lastSeenSignature,
        lastSeenSlot: policy.lastSeenSlot,
      }))
    : [];

  return {
    autoswap: {
      boundPolicies,
      dailySourceMintSpendingCap: classic.dailySourceMintSpendingCap,
      enabled: optIn.enabled,
      generation: optIn.generation.toString(),
      maxSlippageBps: classic.maxSlippageBps,
      policies,
      status: optIn.enabled
        ? pairIsFinalized
          ? "on"
          : "finalizing"
        : "paused",
    },
    autoswapIndex,
  };
}

export async function findEarnCrossMintState(
  scope: EarnCrossMintScope
): Promise<EarnCrossMintState | null> {
  return (await findEarnCrossMintSnapshot(scope)).autoswap;
}

export async function setEarnCrossMintEnabled(
  scope: EarnCrossMintScope & {
    enabled: boolean;
    expectedGeneration: bigint;
  }
): Promise<EarnCrossMintTransitionResult> {
  const client = getYieldOptimizationClient();
  const { crossMintVaultOptIns } = client.tables;
  const queryResult = await client.db.execute(sql`
    WITH current_enrollment AS (
      SELECT *
      FROM ${crossMintVaultOptIns}
      WHERE ${crossMintVaultOptIns.cluster} = ${scope.cluster}
        AND ${crossMintVaultOptIns.settings} = ${scope.settings}
        AND ${crossMintVaultOptIns.vaultIndex} = ${scope.vaultIndex}
        AND ${crossMintVaultOptIns.vaultPubkey} = ${scope.vaultPubkey}
      FOR UPDATE
    ),
    updated_enrollment AS (
      UPDATE ${crossMintVaultOptIns} AS enrollment
      SET enabled = ${scope.enabled},
          generation = enrollment.generation + 1,
          updated_at = CURRENT_TIMESTAMP
      FROM current_enrollment AS current
      WHERE enrollment.cluster = current.cluster
        AND enrollment.settings = current.settings
        AND enrollment.vault_index = current.vault_index
        AND enrollment.vault_pubkey = current.vault_pubkey
        AND current.generation = ${scope.expectedGeneration}
        AND current.enabled <> ${scope.enabled}
      RETURNING enrollment.*
    )
    SELECT
      CASE
        WHEN updated.generation IS NOT NULL THEN 'applied'
        WHEN current.enabled = ${scope.enabled}
          AND current.generation IN (
            ${scope.expectedGeneration},
            ${scope.expectedGeneration + BigInt(1)}
          ) THEN 'idempotent'
        ELSE 'stale'
      END AS kind
    FROM current_enrollment AS current
    LEFT JOIN updated_enrollment AS updated ON true
    UNION ALL
    SELECT
      'missing' AS kind
    WHERE NOT EXISTS (SELECT 1 FROM current_enrollment)
  `);
  const [row] = getExecuteRows(queryResult);
  if (!row || row.kind === "missing") {
    return { enrollment: null, kind: "missing" };
  }
  if (
    row.kind !== "applied" &&
    row.kind !== "idempotent" &&
    row.kind !== "stale"
  ) {
    throw new Error("Autoswap transition returned an invalid outcome.");
  }
  const state = await findEarnCrossMintState(scope);
  if (!state) {
    return { enrollment: null, kind: "missing" };
  }
  const enrollment: EarnCrossMintEnrollment = {
    boundPolicies: state.boundPolicies,
    dailySourceMintSpendingCap: state.dailySourceMintSpendingCap,
    enabled: state.enabled,
    generation: state.generation,
    maxSlippageBps: state.maxSlippageBps,
  };
  return { enrollment, kind: row.kind };
}

export async function hasNonTerminalEarnCrossMintMovement(
  scope: Pick<EarnCrossMintScope, "settings" | "vaultIndex" | "vaultPubkey">
): Promise<boolean> {
  const client = getYieldOptimizationClient();
  const { managedVaults, rebalanceDecisions } = client.tables;
  const rows = await client.db
    .select({ id: rebalanceDecisions.id })
    .from(rebalanceDecisions)
    .innerJoin(managedVaults, eq(managedVaults.id, rebalanceDecisions.vaultId))
    .where(
      and(
        eq(managedVaults.settings, scope.settings),
        eq(managedVaults.vaultIndex, scope.vaultIndex),
        eq(managedVaults.vaultPubkey, scope.vaultPubkey),
        eq(rebalanceDecisions.movementRoute, "cross_mint_jupiter"),
        isNull(rebalanceDecisions.terminalOutcome)
      )
    )
    .limit(1);
  return rows.length === 1;
}

export async function removeEarnCrossMintOptIn(
  scope: EarnCrossMintScope & {
    expectedGeneration: bigint;
    expectedPolicyAccounts: readonly string[];
  }
): Promise<void> {
  const client = getYieldOptimizationClient();
  const { crossMintVaultOptIns } = client.tables;
  const [optIn, current] = await Promise.all([
    loadEarnCrossMintOptIn(scope),
    findEarnCrossMintState(scope),
  ]);
  if (!optIn) {
    return;
  }
  if (!current) {
    throw new Error("Autoswap policy state is unavailable for deletion.");
  }
  if (optIn.enabled) {
    throw new Error("Autoswap must be paused before deletion.");
  }
  if (optIn.generation !== scope.expectedGeneration) {
    throw new Error("Autoswap state changed before deletion confirmation.");
  }
  const expected = new Set(scope.expectedPolicyAccounts);
  const bound = new Set(current.boundPolicies.map((policy) => policy.account));
  if (
    expected.size !== 2 ||
    bound.size !== 2 ||
    [...expected].some((account) => !bound.has(account))
  ) {
    throw new Error(
      "Autoswap removal evidence does not match the enrolled policy pair."
    );
  }
  const removed = await client.db
    .delete(crossMintVaultOptIns)
    .where(
      and(
        optInWhere(scope, crossMintVaultOptIns),
        eq(crossMintVaultOptIns.enabled, false),
        eq(crossMintVaultOptIns.generation, scope.expectedGeneration)
      )
    )
    .returning({ generation: crossMintVaultOptIns.generation });
  if (removed.length !== 1) {
    throw new Error("Autoswap state changed before deletion confirmation.");
  }
}
