import {
  SUBSCRIPTIONS_PROGRAM_ID,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PULLED_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET,
} from "@loyal-labs/actions";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { EarnPolicyRefundRecurringDelegation } from "@/lib/yield-optimization/earn-policy-refund-contracts.shared";
import {
  balanceSweepLotClaims,
  balanceSweepPolicies,
  balanceSweepSurplusLots,
  balanceSweepTargets,
  getYieldOptimizationClient,
  managedVaults,
  routePolicies,
  userYieldPositions,
} from "@/lib/yield-optimization/yield-neon-client.server";

const EARN_VAULT_INDEX = 1;

type AutodepositPolicyRow = {
  policyAccount: string | null;
  recurringDelegation: string | null;
  recurringDelegationExpiryTimestamp: bigint | null;
  scheduledSweepCount: number;
  source: "chain" | "metadata";
  targetId: bigint | null;
  targetActive: boolean;
  targetLifecycleStatus: string;
};

export type EarnPolicyRefundDbState = {
  activeAutodepositAccounts: Set<string>;
  activeManagedVaultAccounts: Set<string>;
  activePositionAccounts: Set<string>;
  recurringDelegationsByPolicyAccount: Map<
    string,
    EarnPolicyRefundRecurringDelegation[]
  >;
  recurringDelegations: EarnPolicyRefundRecurringDelegation[];
  routePolicyAccounts: Set<string>;
};

function emptyPolicyRefundDbState(): EarnPolicyRefundDbState {
  return {
    activeAutodepositAccounts: new Set(),
    activeManagedVaultAccounts: new Set(),
    activePositionAccounts: new Set(),
    recurringDelegationsByPolicyAccount: new Map(),
    recurringDelegations: [],
    routePolicyAccounts: new Set(),
  };
}

function readU64Le(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) {
    return null;
  }

  let value = BigInt(0);
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index] ?? 0) << BigInt(index * 8);
  }
  return value;
}

function stringifyBigint(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function readPublicKey(data: Uint8Array, offset: number): string | null {
  if (data.length < offset + 32) {
    return null;
  }
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function isExpired(
  expiryTimestamp: bigint | null,
  nowSeconds: bigint
): boolean {
  return (
    expiryTimestamp !== null &&
    expiryTimestamp > BigInt(0) &&
    expiryTimestamp <= nowSeconds
  );
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

  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }

  return [];
}

function resolveRecurringDelegationUsage(
  row: AutodepositPolicyRow
): Pick<
  EarnPolicyRefundRecurringDelegation,
  "blockedReason" | "protected" | "usage"
> {
  if (row.targetLifecycleStatus === "pending_delegation") {
    return {
      blockedReason: "Pending Autodeposit setup",
      protected: true,
      usage: "pending",
    };
  }

  if (row.scheduledSweepCount > 0) {
    return {
      blockedReason: "Scheduled Autodeposit sweep",
      protected: true,
      usage: "scheduled",
    };
  }

  if (row.targetId !== null && row.targetActive) {
    return {
      blockedReason: "Current Autodeposit delegation",
      protected: true,
      usage: "current",
    };
  }

  if (row.targetId !== null) {
    return {
      blockedReason: "Paused Autodeposit delegation",
      protected: true,
      usage: "paused",
    };
  }

  return {
    blockedReason: null,
    protected: false,
    usage: "unused",
  };
}

function canRefundRecurringDelegation(args: {
  exists: boolean;
  protected: boolean;
  status: EarnPolicyRefundRecurringDelegation["status"];
}): boolean {
  return (
    args.exists &&
    !args.protected &&
    (args.status === "active" || args.status === "expired")
  );
}

function finalizeRecurringDelegation(args: {
  base: Omit<
    EarnPolicyRefundRecurringDelegation,
    "active" | "canRefund" | "exists" | "status"
  >;
  exists: boolean;
  status: EarnPolicyRefundRecurringDelegation["status"];
}): EarnPolicyRefundRecurringDelegation {
  return {
    ...args.base,
    active: args.status === "active",
    canRefund: canRefundRecurringDelegation({
      exists: args.exists,
      protected: args.base.protected,
      status: args.status,
    }),
    exists: args.exists,
    status: args.status,
  };
}

function inspectRecurringDelegationAccount(args: {
  account: AccountInfo<Buffer> | null;
  row: AutodepositPolicyRow;
  nowSeconds: bigint;
}): EarnPolicyRefundRecurringDelegation {
  const expiryTimestamp = args.row.recurringDelegationExpiryTimestamp;
  const usage = resolveRecurringDelegationUsage(args.row);
  const base = {
    account: args.row.recurringDelegation ?? "",
    amountPerPeriodRaw: null,
    amountPulledRaw: null,
    authority: null,
    blockedReason: usage.blockedReason,
    delegatee: null,
    delegator: null,
    expiryTimestamp: stringifyBigint(expiryTimestamp),
    lamports: null,
    lifecycleStatus: args.row.targetLifecycleStatus,
    mint: null,
    policyAccount: args.row.policyAccount,
    protected: usage.protected,
    scheduledSweepCount: args.row.scheduledSweepCount,
    source: args.row.source,
    targetActive: args.row.targetActive,
    targetId: stringifyBigint(args.row.targetId),
    usage: usage.usage,
  };

  if (!args.row.recurringDelegation) {
    return finalizeRecurringDelegation({
      base,
      exists: false,
      status: "missing",
    });
  }

  if (!args.account) {
    return finalizeRecurringDelegation({
      base,
      exists: false,
      status: "missing",
    });
  }

  const amountPerPeriodRaw = readU64Le(
    args.account.data,
    SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET
  );
  const amountPulledRaw = readU64Le(
    args.account.data,
    SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PULLED_OFFSET
  );
  const authority = readPublicKey(
    args.account.data,
    SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET
  );
  const delegatee = readPublicKey(
    args.account.data,
    SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET
  );
  const delegator = readPublicKey(
    args.account.data,
    SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET
  );
  const mint = readPublicKey(
    args.account.data,
    SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET
  );
  const validAccount =
    args.account.owner.equals(SUBSCRIPTIONS_PROGRAM_ID) &&
    args.account.data.length >= SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN &&
    args.account.data[
      SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET
    ] === SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR;

  if (!validAccount) {
    return finalizeRecurringDelegation({
      base: {
        ...base,
        amountPerPeriodRaw: stringifyBigint(amountPerPeriodRaw),
        amountPulledRaw: stringifyBigint(amountPulledRaw),
        authority,
        delegatee,
        delegator,
        lamports: args.account.lamports,
        mint,
      },
      exists: true,
      status: "invalid",
    });
  }

  if (isExpired(expiryTimestamp, args.nowSeconds)) {
    return finalizeRecurringDelegation({
      base: {
        ...base,
        amountPerPeriodRaw: stringifyBigint(amountPerPeriodRaw),
        amountPulledRaw: stringifyBigint(amountPulledRaw),
        authority,
        delegatee,
        delegator,
        lamports: args.account.lamports,
        mint,
      },
      exists: true,
      status: "expired",
    });
  }

  return finalizeRecurringDelegation({
    base: {
      ...base,
      amountPerPeriodRaw: stringifyBigint(amountPerPeriodRaw),
      amountPulledRaw: stringifyBigint(amountPulledRaw),
      authority,
      delegatee,
      delegator,
      lamports: args.account.lamports,
      mint,
    },
    exists: true,
    status: "active",
  });
}

async function findOpenWalletToEarnVaultRecurringDelegations(args: {
  connection: Connection;
  vaultPubkey: string;
  walletAddress: string;
}): Promise<EarnPolicyRefundRecurringDelegation[]> {
  const accounts = await args.connection.getProgramAccounts(
    SUBSCRIPTIONS_PROGRAM_ID,
    {
      filters: [
        { dataSize: SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN },
        {
          memcmp: {
            offset: SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET,
            bytes: bs58.encode(
              Uint8Array.from([SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR])
            ),
          },
        },
        {
          memcmp: {
            offset: SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
            bytes: args.walletAddress,
          },
        },
        {
          memcmp: {
            offset: SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
            bytes: args.vaultPubkey,
          },
        },
      ],
    }
  );
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

  return accounts
    .map(({ account, pubkey }) =>
      inspectRecurringDelegationAccount({
        account,
        nowSeconds,
        row: {
          policyAccount: null,
          recurringDelegation: pubkey.toBase58(),
          recurringDelegationExpiryTimestamp: null,
          scheduledSweepCount: 0,
          source: "chain",
          targetActive: false,
          targetId: null,
          targetLifecycleStatus: "chain_open",
        },
      })
    )
    .sort((left, right) => left.account.localeCompare(right.account));
}

async function inspectRecurringDelegations(args: {
  connection: Connection;
  rows: AutodepositPolicyRow[];
}): Promise<Map<string, EarnPolicyRefundRecurringDelegation[]>> {
  const recurringDelegationRows = args.rows.filter(
    (row) => row.recurringDelegation
  );
  if (recurringDelegationRows.length === 0) {
    return new Map();
  }

  const publicKeys: PublicKey[] = [];
  const seenAddresses = new Set<string>();
  for (const row of recurringDelegationRows) {
    const address = row.recurringDelegation;
    if (!address) {
      continue;
    }
    try {
      if (!seenAddresses.has(address)) {
        publicKeys.push(new PublicKey(address));
        seenAddresses.add(address);
      }
    } catch {
      // Invalid persisted addresses are surfaced as missing delegation accounts.
    }
  }

  const accountInfos =
    publicKeys.length === 0
      ? []
      : await args.connection.getMultipleAccountsInfo(publicKeys, "confirmed");
  const accountInfoByAddress = new Map(
    publicKeys.map((key, index) => [
      key.toBase58(),
      accountInfos[index] ?? null,
    ])
  );
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const byPolicy = new Map<string, EarnPolicyRefundRecurringDelegation[]>();

  for (const row of recurringDelegationRows) {
    const address = row.recurringDelegation;
    const accountInfo = address ? accountInfoByAddress.get(address) : null;
    const delegation = inspectRecurringDelegationAccount({
      account: accountInfo ?? null,
      nowSeconds,
      row,
    });
    if (!row.policyAccount) {
      continue;
    }
    const existing = byPolicy.get(row.policyAccount) ?? [];
    existing.push(delegation);
    byPolicy.set(row.policyAccount, existing);
  }

  return byPolicy;
}

function mergeRecurringDelegations(
  metadataDelegations: EarnPolicyRefundRecurringDelegation[],
  chainDelegations: EarnPolicyRefundRecurringDelegation[]
): EarnPolicyRefundRecurringDelegation[] {
  const mergedByAccount = new Map<
    string,
    EarnPolicyRefundRecurringDelegation
  >();

  for (const delegation of metadataDelegations) {
    mergedByAccount.set(delegation.account, delegation);
  }
  for (const delegation of chainDelegations) {
    const metadataDelegation = mergedByAccount.get(delegation.account);
    mergedByAccount.set(
      delegation.account,
      metadataDelegation
        ? {
            ...delegation,
            blockedReason: metadataDelegation.blockedReason,
            canRefund: canRefundRecurringDelegation({
              exists: delegation.exists,
              protected: metadataDelegation.protected,
              status: delegation.status,
            }),
            lifecycleStatus: metadataDelegation.lifecycleStatus,
            policyAccount: metadataDelegation.policyAccount,
            protected: metadataDelegation.protected,
            scheduledSweepCount: metadataDelegation.scheduledSweepCount,
            targetActive: metadataDelegation.targetActive,
            targetId: metadataDelegation.targetId,
            usage: metadataDelegation.usage,
          }
        : delegation
    );
  }

  return [...mergedByAccount.values()].sort((left, right) =>
    left.account.localeCompare(right.account)
  );
}

function collectRecurringDelegations(
  delegationsByPolicyAccount: Map<
    string,
    EarnPolicyRefundRecurringDelegation[]
  >,
  chainDelegations: EarnPolicyRefundRecurringDelegation[]
): EarnPolicyRefundRecurringDelegation[] {
  const byAccount = new Map<string, EarnPolicyRefundRecurringDelegation>();
  for (const delegation of chainDelegations) {
    byAccount.set(delegation.account, delegation);
  }
  for (const delegations of delegationsByPolicyAccount.values()) {
    for (const delegation of delegations) {
      byAccount.set(delegation.account, delegation);
    }
  }
  return [...byAccount.values()].sort((left, right) =>
    left.account.localeCompare(right.account)
  );
}

async function findScheduledSweepCounts(args: {
  client: ReturnType<typeof getYieldOptimizationClient>;
  targetIds: bigint[];
}): Promise<Map<string, number>> {
  if (args.targetIds.length === 0) {
    return new Map();
  }

  const targetIds = sql.join(
    args.targetIds.map((targetId) => sql`${targetId}`),
    sql`, `
  );
  const result = await args.client.db.execute(sql`
    SELECT pending.target_id::text AS "targetId", COUNT(*)::integer AS "count"
    FROM (
      SELECT ${balanceSweepSurplusLots.targetId} AS target_id
      FROM ${balanceSweepSurplusLots}
      WHERE ${balanceSweepSurplusLots.targetId} IN (${targetIds})
        AND ${balanceSweepSurplusLots.status} IN ('open', 'selected')
        AND ${balanceSweepSurplusLots.remainingAmountRaw} > 0
      UNION ALL
      SELECT ${balanceSweepLotClaims.targetId} AS target_id
      FROM ${balanceSweepLotClaims}
      WHERE ${balanceSweepLotClaims.targetId} IN (${targetIds})
        AND ${balanceSweepLotClaims.status} = 'selected'
    ) pending
    GROUP BY pending.target_id
  `);

  return new Map(
    getExecuteRows(result).map((row) => [
      String(row.targetId),
      Number(row.count ?? 0),
    ])
  );
}

export async function findEarnPolicyRefundDbState(args: {
  connection: Connection;
  policyAccounts: string[];
  settings: string;
  vaultPubkey: string;
  walletAddress: string;
}): Promise<EarnPolicyRefundDbState> {
  if (args.policyAccounts.length === 0) {
    const openRecurringDelegations =
      await findOpenWalletToEarnVaultRecurringDelegations({
        connection: args.connection,
        vaultPubkey: args.vaultPubkey,
        walletAddress: args.walletAddress,
      });

    return {
      ...emptyPolicyRefundDbState(),
      recurringDelegations: openRecurringDelegations,
    };
  }

  const client = getYieldOptimizationClient();
  const [
    policyRows,
    activeVaultRows,
    activePositionRows,
    autodepositRows,
    openRecurringDelegations,
  ] = await Promise.all([
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
        id: balanceSweepTargets.id,
        policyAccount: balanceSweepPolicies.policyAccount,
        recurringDelegation: balanceSweepTargets.recurringDelegation,
        recurringDelegationExpiryTimestamp:
          balanceSweepTargets.recurringDelegationExpiryTimestamp,
        source: sql<"metadata">`'metadata'`,
        targetActive: balanceSweepTargets.active,
        targetLifecycleStatus: balanceSweepTargets.lifecycleStatus,
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
    findOpenWalletToEarnVaultRecurringDelegations({
      connection: args.connection,
      vaultPubkey: args.vaultPubkey,
      walletAddress: args.walletAddress,
    }),
  ]);
  const scheduledSweepCountByTargetId = await findScheduledSweepCounts({
    client,
    targetIds: autodepositRows.map((row) => row.id),
  });
  const autodepositRowsWithScheduleCounts: AutodepositPolicyRow[] =
    autodepositRows.map((row) => ({
      ...row,
      scheduledSweepCount:
        scheduledSweepCountByTargetId.get(row.id.toString()) ?? 0,
      targetId: row.id,
    }));

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

  const recurringDelegationsByPolicyAccount = await inspectRecurringDelegations(
    {
      connection: args.connection,
      rows: autodepositRowsWithScheduleCounts,
    }
  );
  const autodepositPolicyAccounts = new Set(
    autodepositRowsWithScheduleCounts.map((row) => row.policyAccount)
  );
  for (const policyAccount of autodepositPolicyAccounts) {
    if (!policyAccount) {
      continue;
    }
    recurringDelegationsByPolicyAccount.set(
      policyAccount,
      mergeRecurringDelegations(
        recurringDelegationsByPolicyAccount.get(policyAccount) ?? [],
        openRecurringDelegations
      )
    );
  }

  const activeAutodepositAccounts = new Set<string>();
  for (const [
    policyAccount,
    delegations,
  ] of recurringDelegationsByPolicyAccount) {
    if (
      delegations.some(
        (delegation) => delegation.exists && delegation.protected
      )
    ) {
      activeAutodepositAccounts.add(policyAccount);
    }
  }
  const recurringDelegations = collectRecurringDelegations(
    recurringDelegationsByPolicyAccount,
    openRecurringDelegations
  );

  return {
    activeAutodepositAccounts,
    activeManagedVaultAccounts,
    activePositionAccounts: new Set(
      activePositionRows.map((row) => row.policyAccount)
    ),
    recurringDelegationsByPolicyAccount,
    recurringDelegations,
    routePolicyAccounts,
  };
}

// Vault-level (not per-policy) liveness flags gating the vault-accounts
// refund: sweeping the vault's SOL and closing its token accounts is only
// safe once nothing can still deposit into or hold funds in the vault. Any
// non-closed autodeposit target counts — including pending_delegation rows
// mid-setup.
export async function findEarnVaultRefundDbState(args: {
  settings: string;
}): Promise<{
  hasActiveAutodeposit: boolean;
  hasActiveManagedVault: boolean;
  hasActivePosition: boolean;
}> {
  const client = getYieldOptimizationClient();
  const [activePosition, activeManagedVault, openAutodepositTarget] =
    await Promise.all([
      client.db.query.userYieldPositions.findFirst({
        columns: { id: true },
        where: and(
          eq(userYieldPositions.settings, args.settings),
          eq(userYieldPositions.vaultIndex, EARN_VAULT_INDEX),
          eq(userYieldPositions.status, "active")
        ),
      }),
      client.db.query.managedVaults.findFirst({
        columns: { id: true },
        where: and(
          eq(managedVaults.active, true),
          eq(managedVaults.settings, args.settings),
          eq(managedVaults.vaultIndex, EARN_VAULT_INDEX)
        ),
      }),
      client.db.query.balanceSweepTargets.findFirst({
        columns: { id: true },
        where: and(
          eq(balanceSweepTargets.settings, args.settings),
          eq(balanceSweepTargets.vaultIndex, EARN_VAULT_INDEX),
          ne(balanceSweepTargets.lifecycleStatus, "closed")
        ),
      }),
    ]);

  return {
    hasActiveAutodeposit: openAutodepositTarget !== undefined,
    hasActiveManagedVault: activeManagedVault !== undefined,
    hasActivePosition: activePosition !== undefined,
  };
}

export async function findSingleEarnPolicyRefundDbState(args: {
  connection: Connection;
  policyAccount: string;
  settings: string;
  vaultPubkey: string;
  walletAddress: string;
}): Promise<{
  activeAutodeposit: boolean;
  activeManagedVault: boolean;
  dbPresent: boolean;
  recurringDelegations: EarnPolicyRefundRecurringDelegation[];
  referencedByActivePosition: boolean;
}> {
  const state = await findEarnPolicyRefundDbState({
    connection: args.connection,
    policyAccounts: [args.policyAccount],
    settings: args.settings,
    vaultPubkey: args.vaultPubkey,
    walletAddress: args.walletAddress,
  });

  return {
    activeAutodeposit: state.activeAutodepositAccounts.has(args.policyAccount),
    activeManagedVault: state.activeManagedVaultAccounts.has(
      args.policyAccount
    ),
    dbPresent: state.routePolicyAccounts.has(args.policyAccount),
    recurringDelegations:
      state.recurringDelegationsByPolicyAccount.get(args.policyAccount) ?? [],
    referencedByActivePosition: state.activePositionAccounts.has(
      args.policyAccount
    ),
  };
}
