import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

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

function boundPoliciesFromOptIn(
  optIn: NonNullable<Awaited<ReturnType<typeof loadEarnCrossMintOptIn>>>
): EarnCrossMintState["boundPolicies"] {
  return [
    {
      account: optIn.classicPolicyAccount,
      seed: optIn.classicPolicySeed.toString(),
      sourceShard: "classic",
    },
    {
      account: optIn.token2022PolicyAccount,
      seed: optIn.token2022PolicySeed.toString(),
      sourceShard: "token_2022",
    },
  ];
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

export async function findEarnCrossMintState(
  scope: EarnCrossMintScope
): Promise<EarnCrossMintState | null> {
  const client = getYieldOptimizationClient();
  const { crossMintSwapPolicies, crossMintVaultOptIns } = client.tables;
  const [optIn] = await client.db
    .select()
    .from(crossMintVaultOptIns)
    .where(optInWhere(scope, crossMintVaultOptIns))
    .limit(1);
  if (!optIn) {
    return null;
  }

  const boundPolicies = boundPoliciesFromOptIn(optIn);
  const rows = await client.db
    .select()
    .from(crossMintSwapPolicies)
    .where(
      and(
        eq(crossMintSwapPolicies.cluster, scope.cluster),
        eq(crossMintSwapPolicies.settings, scope.settings),
        eq(crossMintSwapPolicies.authority, scope.authority),
        eq(crossMintSwapPolicies.vaultIndex, scope.vaultIndex),
        eq(crossMintSwapPolicies.vaultPubkey, scope.vaultPubkey),
        inArray(
          crossMintSwapPolicies.policyAccount,
          boundPolicies.map((policy) => policy.account)
        )
      )
    );
  const byAccount = new Map(rows.map((row) => [row.policyAccount, row]));
  if (byAccount.size !== rows.length) {
    throw new Error(
      "Autoswap policy state is ambiguous; an enrolled policy has duplicate catalog rows."
    );
  }

  const policies = boundPolicies.flatMap((bound) => {
    const row = byAccount.get(bound.account);
    if (!row) {
      return [];
    }
    if (
      row.policySeed?.toString() !== bound.seed ||
      row.sourceShard !== bound.sourceShard ||
      row.maxSlippageBps !== optIn.maxSlippageBps ||
      row.dailySourceMintSpendingCap !== optIn.dailySourceMintSpendingCap
    ) {
      // Invalid catalog evidence must block resume/start without hiding the
      // exact enrolled accounts that the user still needs to delete.
      return [];
    }
    if (
      !row.active ||
      !row.startEligible ||
      row.sourceCommitment !== "finalized" ||
      (row.lastMutation !== "create" && row.lastMutation !== "update")
    ) {
      return [];
    }
    return [
      {
        ...bound,
        lastSeenSignature: row.lastSeenSignature,
        lastSeenSlot: row.lastSeenSlot.toString(),
      },
    ];
  });

  return {
    boundPolicies,
    dailySourceMintSpendingCap: optIn.dailySourceMintSpendingCap.toString(),
    enabled: optIn.enabled,
    generation: optIn.generation.toString(),
    maxSlippageBps: optIn.maxSlippageBps,
    policies,
    status: optIn.enabled
      ? policies.length === 2
        ? "on"
        : "finalizing"
      : "paused",
  };
}

export async function recordEarnCrossMintEnrollment(
  args: EarnCrossMintScope & {
    boundPolicies: EarnCrossMintState["boundPolicies"];
    dailySourceMintSpendingCap: bigint;
    maxSlippageBps: number;
  }
): Promise<boolean> {
  const client = getYieldOptimizationClient();
  const { crossMintVaultOptIns } = client.tables;
  const byShard = new Map(
    args.boundPolicies.map((policy) => [policy.sourceShard, policy] as const)
  );
  const classic = byShard.get("classic");
  const token2022 = byShard.get("token_2022");
  if (!(classic && token2022) || byShard.size !== 2) {
    throw new Error("Autoswap enrollment requires exactly two permissions.");
  }

  const inserted = await client.db
    .insert(crossMintVaultOptIns)
    .values({
      classicPolicyAccount: classic.account,
      classicPolicySeed: BigInt(classic.seed),
      cluster: args.cluster,
      createdAt: new Date(),
      dailySourceMintSpendingCap: args.dailySourceMintSpendingCap,
      enabled: true,
      generation: BigInt(1),
      maxSlippageBps: args.maxSlippageBps,
      settings: args.settings,
      token2022PolicyAccount: token2022.account,
      token2022PolicySeed: BigInt(token2022.seed),
      updatedAt: new Date(),
      vaultIndex: args.vaultIndex,
      vaultPubkey: args.vaultPubkey,
    })
    .onConflictDoNothing()
    .returning({ generation: crossMintVaultOptIns.generation });
  if (inserted.length === 1) {
    return true;
  }

  const existing = await loadEarnCrossMintOptIn(args);
  if (
    !existing ||
    existing.classicPolicyAccount !== classic.account ||
    existing.classicPolicySeed !== BigInt(classic.seed) ||
    existing.token2022PolicyAccount !== token2022.account ||
    existing.token2022PolicySeed !== BigInt(token2022.seed) ||
    existing.maxSlippageBps !== args.maxSlippageBps ||
    existing.dailySourceMintSpendingCap !== args.dailySourceMintSpendingCap
  ) {
    throw new Error(
      "Autoswap policy identity and risk settings are immutable; delete the existing enrollment first."
    );
  }
  // Preserve the existing `enabled` value: an old setup-confirm retry must not
  // silently resume an enrollment the user paused after setup.
  return existing.enabled;
}

export async function setEarnCrossMintEnabled(
  scope: EarnCrossMintStoredScope & {
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
      END AS kind,
      COALESCE(updated.enabled, current.enabled) AS enabled,
      COALESCE(updated.generation, current.generation) AS generation,
      COALESCE(updated.classic_policy_account, current.classic_policy_account)
        AS "classicPolicyAccount",
      COALESCE(updated.classic_policy_seed, current.classic_policy_seed)
        AS "classicPolicySeed",
      COALESCE(updated.token_2022_policy_account, current.token_2022_policy_account)
        AS "token2022PolicyAccount",
      COALESCE(updated.token_2022_policy_seed, current.token_2022_policy_seed)
        AS "token2022PolicySeed",
      COALESCE(updated.max_slippage_bps, current.max_slippage_bps)
        AS "maxSlippageBps",
      COALESCE(
        updated.daily_source_mint_spending_cap,
        current.daily_source_mint_spending_cap
      ) AS "dailySourceMintSpendingCap"
    FROM current_enrollment AS current
    LEFT JOIN updated_enrollment AS updated ON true
    UNION ALL
    SELECT
      'missing' AS kind,
      NULL AS enabled,
      NULL AS generation,
      NULL AS "classicPolicyAccount",
      NULL AS "classicPolicySeed",
      NULL AS "token2022PolicyAccount",
      NULL AS "token2022PolicySeed",
      NULL AS "maxSlippageBps",
      NULL AS "dailySourceMintSpendingCap"
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
  const enrollment: EarnCrossMintEnrollment = {
    boundPolicies: [
      {
        account: String(row.classicPolicyAccount),
        seed: String(row.classicPolicySeed),
        sourceShard: "classic",
      },
      {
        account: String(row.token2022PolicyAccount),
        seed: String(row.token2022PolicySeed),
        sourceShard: "token_2022",
      },
    ],
    dailySourceMintSpendingCap: String(row.dailySourceMintSpendingCap),
    enabled: row.enabled === true,
    generation: String(row.generation),
    maxSlippageBps: Number(row.maxSlippageBps),
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
  const current = await loadEarnCrossMintOptIn(scope);
  if (!current) {
    return;
  }
  if (current.enabled) {
    throw new Error("Autoswap must be paused before deletion.");
  }
  if (current.generation !== scope.expectedGeneration) {
    throw new Error("Autoswap state changed before deletion confirmation.");
  }
  const expected = new Set(scope.expectedPolicyAccounts);
  const bound = new Set([
    current.classicPolicyAccount,
    current.token2022PolicyAccount,
  ]);
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
        eq(crossMintVaultOptIns.generation, scope.expectedGeneration),
        eq(
          crossMintVaultOptIns.classicPolicyAccount,
          current.classicPolicyAccount
        ),
        eq(
          crossMintVaultOptIns.token2022PolicyAccount,
          current.token2022PolicyAccount
        ),
        eq(crossMintVaultOptIns.classicPolicySeed, current.classicPolicySeed),
        eq(
          crossMintVaultOptIns.token2022PolicySeed,
          current.token2022PolicySeed
        )
      )
    )
    .returning({ generation: crossMintVaultOptIns.generation });
  if (removed.length !== 1) {
    throw new Error("Autoswap state changed before deletion confirmation.");
  }
}
