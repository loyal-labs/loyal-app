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
import { and, eq, ne, sql } from "drizzle-orm";
import { inArray } from "drizzle-orm/sql/expressions/conditions";

import type { EarnPolicyRefundRecurringDelegation } from "@/lib/yield-optimization/earn-policy-refund-contracts.shared";
import {
  balanceSweepPolicies,
  balanceSweepTargets,
  getYieldOptimizationClient,
  managedVaults,
  routePolicies,
  userYieldPositions,
} from "@/lib/yield-optimization/yield-neon-client.server";

const EARN_VAULT_INDEX = 1;

type AutodepositPolicyRow = {
  policyAccount: string;
  recurringDelegation: string | null;
  recurringDelegationExpiryTimestamp: bigint | null;
  source: "metadata";
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
  routePolicyAccounts: Set<string>;
};

function emptyPolicyRefundDbState(): EarnPolicyRefundDbState {
  return {
    activeAutodepositAccounts: new Set(),
    activeManagedVaultAccounts: new Set(),
    activePositionAccounts: new Set(),
    recurringDelegationsByPolicyAccount: new Map(),
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

function inspectRecurringDelegationAccount(args: {
  account: AccountInfo<Buffer> | null;
  row: AutodepositPolicyRow;
  nowSeconds: bigint;
}): EarnPolicyRefundRecurringDelegation {
  const expiryTimestamp = args.row.recurringDelegationExpiryTimestamp;
  const base = {
    account: args.row.recurringDelegation ?? "",
    amountPerPeriodRaw: null,
    amountPulledRaw: null,
    authority: null,
    delegatee: null,
    delegator: null,
    expiryTimestamp: stringifyBigint(expiryTimestamp),
    lamports: null,
    lifecycleStatus: args.row.targetLifecycleStatus,
    mint: null,
    source: args.row.source,
    targetActive: args.row.targetActive,
  };

  if (!args.row.recurringDelegation) {
    return {
      ...base,
      active: false,
      exists: false,
      status: "missing",
    };
  }

  if (!args.account) {
    return {
      ...base,
      active: false,
      exists: false,
      status: "missing",
    };
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
    return {
      ...base,
      active: false,
      amountPerPeriodRaw: stringifyBigint(amountPerPeriodRaw),
      amountPulledRaw: stringifyBigint(amountPulledRaw),
      authority,
      delegatee,
      delegator,
      exists: true,
      lamports: args.account.lamports,
      mint,
      status: "invalid",
    };
  }

  if (isExpired(expiryTimestamp, args.nowSeconds)) {
    return {
      ...base,
      active: false,
      amountPerPeriodRaw: stringifyBigint(amountPerPeriodRaw),
      amountPulledRaw: stringifyBigint(amountPulledRaw),
      authority,
      delegatee,
      delegator,
      exists: true,
      lamports: args.account.lamports,
      mint,
      status: "expired",
    };
  }

  return {
    ...base,
    active: true,
    amountPerPeriodRaw: stringifyBigint(amountPerPeriodRaw),
    amountPulledRaw: stringifyBigint(amountPulledRaw),
    authority,
    delegatee,
    delegator,
    exists: true,
    lamports: args.account.lamports,
    mint,
    status: "active",
  };
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
          policyAccount: "",
          recurringDelegation: pubkey.toBase58(),
          recurringDelegationExpiryTimestamp: null,
          source: "chain",
          targetActive: true,
          targetLifecycleStatus: "active",
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
    const existing = byPolicy.get(row.policyAccount) ?? [];
    existing.push(delegation);
    byPolicy.set(row.policyAccount, existing);
  }

  return byPolicy;
}

export async function findEarnPolicyRefundDbState(args: {
  connection: Connection;
  policyAccounts: string[];
  settings: string;
}): Promise<EarnPolicyRefundDbState> {
  if (args.policyAccounts.length === 0) {
    return emptyPolicyRefundDbState();
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

  const recurringDelegationsByPolicyAccount = await inspectRecurringDelegations(
    {
      connection: args.connection,
      rows: autodepositRows,
    }
  );
  const activeAutodepositAccounts = new Set<string>();
  for (const [
    policyAccount,
    delegations,
  ] of recurringDelegationsByPolicyAccount) {
    if (delegations.some((delegation) => delegation.active)) {
      activeAutodepositAccounts.add(policyAccount);
    }
  }

  return {
    activeAutodepositAccounts,
    activeManagedVaultAccounts,
    activePositionAccounts: new Set(
      activePositionRows.map((row) => row.policyAccount)
    ),
    recurringDelegationsByPolicyAccount,
    routePolicyAccounts,
  };
}

export async function findSingleEarnPolicyRefundDbState(args: {
  connection: Connection;
  policyAccount: string;
  settings: string;
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
