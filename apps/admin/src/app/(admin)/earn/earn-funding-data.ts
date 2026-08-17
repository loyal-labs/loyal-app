import "server-only";

import {
  appSmartAccountSponsorshipTransactions,
  gaslessClaimTransactions,
} from "@loyal-labs/db-core/schema";
import { and, count, desc, eq, gte, inArray, max } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { serverEnv } from "@/lib/core/config/server";
import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

const LAMPORTS_PER_SOL = BigInt(1_000_000_000);
const POLICY_MINIMUM_LAMPORTS = BigInt(50_000_000);
const SPONSORSHIP_CRITICAL_RUNWAY_HOURS = 48;
const SPONSORSHIP_LOW_RUNWAY_HOURS = 168;
const MAINNET_APP_ENV = "mainnet";
const MAINNET_YIELD_CLUSTER = "mainnet-beta";
const DEFAULT_MAINNET_RPC_URL =
  "https://fredra-z7l52f-fast-mainnet.helius-rpc.com";

type FundingRole =
  | "sponsorship"
  | "policy"
  | "deployment"
  | "route_fee_payer"
  | "settings_authority";

// Roles whose outflow lands in a table this page reads. A wallet with no such
// role has no spend history to consult, which is different from having one that
// came back empty — see loadWalletSpend and calculateStatus.
const SPEND_TRACKED_ROLES = new Set<FundingRole>([
  "sponsorship",
  "policy",
  "deployment",
  "route_fee_payer",
]);

export type FundingStatus = "healthy" | "low" | "critical" | "unknown";

export type EarnFundingWallet = {
  address: string;
  balanceLamports: string | null;
  balanceObservedAt: string | null;
  balanceSlot: number | null;
  balanceError: string | null;
  configuredAddresses: string[];
  observedAddresses: string[];
  mismatch: boolean;
  roles: Array<{
    key: FundingRole;
    label: string;
    observedCount: number | null;
    latestObservedAt: string | null;
  }>;
  status: FundingStatus;
  statusDetail: string;
  minimumLamports: string | null;
  spend24hLamports: string | null;
  spend7dLamports: string | null;
  runwayHours: number | null;
};

export type OperationalWalletSpendGroup =
  | "gasless_store"
  | "gasless_top_up_to_0_01_sol"
  | "gasless_verify_telegram_init_data"
  | "lookup_table_close"
  | "lookup_table_create"
  | "lookup_table_deactivate"
  | "lookup_table_extend"
  | "lookup_table_rollover"
  | "lookup_table_verify"
  | "smart_account_sponsorship"
  | "yield_route_fee";

export type OperationalWalletSpendEvent = {
  address: string;
  amountBasis: "compiled_fee" | "confirmed_payer_outflow";
  group: OperationalWalletSpendGroup;
  lamports: string;
  occurredAt: string;
  signature: string | null;
};

export type EarnFundingData = {
  wallets: EarnFundingWallet[];
  missingRoles: Array<{ key: FundingRole; label: string; reason: string }>;
  spendEvents: OperationalWalletSpendEvent[];
  spendSourceErrors: string[];
  spendWindow: { endedAt: string; startedAt: string };
  sourceErrors: string[];
  observedAt: string;
};

type IdentityObservation = {
  address: string;
  count: number;
  latestObservedAt: string | null;
};

type PolicyObservationRow = {
  address: string | null;
  active_policy_count: string | number | null;
  latest_seen_at: string | Date | null;
};

type FeePayerObservationRow = {
  address: string | null;
  active_shard_count: string | number | null;
  latest_seen_at: string | Date | null;
};

type SpendEventObservationRow = {
  address: string | null;
  amount_basis: string | null;
  group_key: string | null;
  lamports: string | number | null;
  occurred_at: string | Date | null;
  signature: string | null;
};

type SpendSourceResult = {
  events: OperationalWalletSpendEvent[];
  failed: boolean;
};

type WalletSpend = {
  spend24hLamports: string | null;
  spend7dLamports: string | null;
};

type RpcAccount = {
  lamports: number;
};

type RpcAccountsResult = {
  context?: { slot?: number };
  value?: Array<RpcAccount | null>;
};

type RpcResponse = {
  error?: { message?: string };
  result?: RpcAccountsResult;
};

type RoleObservation = {
  configuredAddresses: string[];
  observedAddresses: IdentityObservation[];
};

type RoleDefinition = {
  key: FundingRole;
  label: string;
  observation: RoleObservation;
};

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNumber(value: string | number | bigint | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeAddress(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueAddresses(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map(normalizeAddress)
        .filter((value): value is string => Boolean(value))
    )
  );
}

function toObservedAddress(
  address: string | null | undefined,
  countValue: string | number | null | undefined,
  latestObservedAt: Date | string | null | undefined
): IdentityObservation | null {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    return null;
  }

  return {
    address: normalizedAddress,
    count: toNumber(countValue),
    latestObservedAt: toIsoString(latestObservedAt),
  };
}

async function loadAppIdentityObservations(): Promise<{
  sponsorship: IdentityObservation[];
  deployment: IdentityObservation[];
  sourceError: string | null;
}> {
  try {
    const db = getDatabase();
    const sponsorshipLatest = max(
      appSmartAccountSponsorshipTransactions.occurredAt
    );
    const gaslessLatest = max(gaslessClaimTransactions.occurredAt);

    const [sponsorshipRows, gaslessRows] = await Promise.all([
      db
        .select({
          address: appSmartAccountSponsorshipTransactions.payerAddress,
          count: count(),
          latestObservedAt: sponsorshipLatest,
        })
        .from(appSmartAccountSponsorshipTransactions)
        .where(
          eq(appSmartAccountSponsorshipTransactions.solanaEnv, MAINNET_APP_ENV)
        )
        .groupBy(appSmartAccountSponsorshipTransactions.payerAddress)
        .orderBy(desc(sponsorshipLatest))
        .limit(1),
      db
        .select({
          address: gaslessClaimTransactions.payerAddress,
          count: count(),
          latestObservedAt: gaslessLatest,
        })
        .from(gaslessClaimTransactions)
        .where(eq(gaslessClaimTransactions.solanaEnv, MAINNET_APP_ENV))
        .groupBy(gaslessClaimTransactions.payerAddress)
        .orderBy(desc(gaslessLatest))
        .limit(1),
    ]);

    return {
      sponsorship: sponsorshipRows
        .map((row) =>
          toObservedAddress(row.address, row.count, row.latestObservedAt)
        )
        .filter((row): row is IdentityObservation => Boolean(row)),
      deployment: gaslessRows
        .map((row) =>
          toObservedAddress(row.address, row.count, row.latestObservedAt)
        )
        .filter((row): row is IdentityObservation => Boolean(row)),
      sourceError: null,
    };
  } catch {
    return {
      deployment: [],
      sponsorship: [],
      sourceError: "App database identity observations unavailable",
    };
  }
}

// Settings authorities are per smart account, so there are thousands of them.
// Only the configured operational authority is looked up; enumerating the
// column would turn every user's account into a funding wallet card.
async function loadSettingsAuthorityObservations(
  sql: ReturnType<typeof getYieldNeonSql>,
  configuredAddresses: string[]
): Promise<PolicyObservationRow[]> {
  if (configuredAddresses.length === 0) {
    return [];
  }

  return sql.query(
    `
    SELECT
      authority AS address,
      COUNT(*)::text AS active_policy_count,
      MAX(last_seen_at) AS latest_seen_at
    FROM loyal_yield.route_policies
    WHERE active = true
      AND authority = ANY($1::text[])
    GROUP BY authority
    ORDER BY COUNT(*) DESC, MAX(last_seen_at) DESC
  `,
    [configuredAddresses]
  ) as unknown as Promise<PolicyObservationRow[]>;
}

async function loadYieldIdentityObservations(
  configuredSettingsAuthorities: string[]
): Promise<{
  policy: IdentityObservation[];
  routeFeePayer: IdentityObservation[];
  settingsAuthority: IdentityObservation[];
  sourceError: string | null;
}> {
  try {
    const sql = getYieldNeonSql();
    const [policyRows, feePayerRows, settingsAuthorityRows] = await Promise.all(
      [
        sql.query(`
        SELECT
          signer.address AS address,
          COUNT(*)::text AS active_policy_count,
          MAX(last_seen_at) AS latest_seen_at
        FROM loyal_yield.route_policies
        CROSS JOIN LATERAL unnest(delegated_signers) AS signer(address)
        WHERE active = true
        GROUP BY signer.address
        ORDER BY COUNT(*) DESC, MAX(last_seen_at) DESC
      `) as unknown as Promise<PolicyObservationRow[]>,
        sql.query(`
        SELECT
          fee_payer AS address,
          COUNT(*)::text AS active_shard_count,
          MAX(updated_at) AS latest_seen_at
        FROM loyal_yield.route_fee_payer_shard_status
        WHERE cluster = '${MAINNET_YIELD_CLUSTER}'
          AND enabled = true
        GROUP BY fee_payer
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
      `) as unknown as Promise<FeePayerObservationRow[]>,
        loadSettingsAuthorityObservations(sql, configuredSettingsAuthorities),
      ]
    );

    return {
      policy: policyRows
        .map((row) =>
          toObservedAddress(
            row.address,
            row.active_policy_count,
            row.latest_seen_at
          )
        )
        .filter((row): row is IdentityObservation => Boolean(row)),
      routeFeePayer: feePayerRows
        .map((row) =>
          toObservedAddress(
            row.address,
            row.active_shard_count,
            row.latest_seen_at
          )
        )
        .filter((row): row is IdentityObservation => Boolean(row)),
      settingsAuthority: settingsAuthorityRows
        .map((row) =>
          toObservedAddress(
            row.address,
            row.active_policy_count,
            row.latest_seen_at
          )
        )
        .filter((row): row is IdentityObservation => Boolean(row)),
      sourceError: null,
    };
  } catch {
    return {
      policy: [],
      routeFeePayer: [],
      settingsAuthority: [],
      sourceError: "Yield database identity observations unavailable",
    };
  }
}

function toSpendLamports(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) {
    return BigInt(0);
  }

  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    return BigInt(0);
  }

  const parsed = BigInt(text);
  return parsed > BigInt(0) ? parsed : BigInt(0);
}

const OPERATIONAL_WALLET_SPEND_GROUPS = new Set<OperationalWalletSpendGroup>([
  "gasless_store",
  "gasless_top_up_to_0_01_sol",
  "gasless_verify_telegram_init_data",
  "lookup_table_close",
  "lookup_table_create",
  "lookup_table_deactivate",
  "lookup_table_extend",
  "lookup_table_rollover",
  "lookup_table_verify",
  "smart_account_sponsorship",
  "yield_route_fee",
]);

function isOperationalWalletSpendGroup(
  value: string | null | undefined
): value is OperationalWalletSpendGroup {
  return OPERATIONAL_WALLET_SPEND_GROUPS.has(
    value as OperationalWalletSpendGroup
  );
}

function getOperationalWalletSpendWindow(now: Date) {
  const julyYear =
    now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

  return {
    endedAt: now,
    startedAt: new Date(Date.UTC(julyYear, 6, 1)),
  };
}

function toSpendEvent(args: {
  address: string | null | undefined;
  amountBasis: string | null | undefined;
  group: string | null | undefined;
  lamports: string | number | null | undefined;
  occurredAt: string | Date | null | undefined;
  signature: string | null | undefined;
}): OperationalWalletSpendEvent | null {
  const normalizedAddress = normalizeAddress(args.address);
  const occurredAt = toIsoString(args.occurredAt);
  const lamports = toSpendLamports(args.lamports);
  if (
    !normalizedAddress ||
    !occurredAt ||
    lamports === BigInt(0) ||
    !isOperationalWalletSpendGroup(args.group)
  ) {
    return null;
  }

  return {
    address: normalizedAddress,
    amountBasis:
      args.amountBasis === "compiled_fee"
        ? "compiled_fee"
        : "confirmed_payer_outflow",
    group: args.group,
    lamports: lamports.toString(),
    occurredAt,
    signature: normalizeAddress(args.signature),
  };
}

function gaslessSpendGroup(transactionType: string) {
  return `gasless_${transactionType}`;
}

// Sponsored smart-account deployments; rows are written by the app when each
// sponsored transaction finalizes.
async function loadSponsorshipSpendRows(
  addresses: string[],
  startedAt: Date
): Promise<SpendSourceResult> {
  try {
    const db = getDatabase();
    const rows = await db
      .select({
        address: appSmartAccountSponsorshipTransactions.payerAddress,
        lamports: appSmartAccountSponsorshipTransactions.spentLamports,
        occurredAt: appSmartAccountSponsorshipTransactions.occurredAt,
        signature: appSmartAccountSponsorshipTransactions.signature,
      })
      .from(appSmartAccountSponsorshipTransactions)
      .where(
        and(
          eq(appSmartAccountSponsorshipTransactions.solanaEnv, MAINNET_APP_ENV),
          inArray(
            appSmartAccountSponsorshipTransactions.payerAddress,
            addresses
          ),
          gte(appSmartAccountSponsorshipTransactions.occurredAt, startedAt)
        )
      );

    return {
      events: rows
        .map((row) =>
          toSpendEvent({
            address: row.address,
            amountBasis: "confirmed_payer_outflow",
            group: "smart_account_sponsorship",
            lamports: row.lamports,
            occurredAt: row.occurredAt,
            signature: row.signature,
          })
        )
        .filter((event): event is OperationalWalletSpendEvent =>
          Boolean(event)
        ),
      failed: false,
    };
  } catch {
    return { events: [], failed: true };
  }
}

// Gasless claim/verification transactions; rows are backfilled by the app's
// private-transfer-analytics cron.
async function loadGaslessClaimSpendRows(
  addresses: string[],
  startedAt: Date
): Promise<SpendSourceResult> {
  try {
    const db = getDatabase();
    const rows = await db
      .select({
        address: gaslessClaimTransactions.payerAddress,
        lamports: gaslessClaimTransactions.spentLamports,
        occurredAt: gaslessClaimTransactions.occurredAt,
        signature: gaslessClaimTransactions.signature,
        transactionType: gaslessClaimTransactions.transactionType,
      })
      .from(gaslessClaimTransactions)
      .where(
        and(
          eq(gaslessClaimTransactions.solanaEnv, MAINNET_APP_ENV),
          inArray(gaslessClaimTransactions.payerAddress, addresses),
          gte(gaslessClaimTransactions.occurredAt, startedAt)
        )
      );

    return {
      events: rows
        .map((row) =>
          toSpendEvent({
            address: row.address,
            amountBasis: "confirmed_payer_outflow",
            group: gaslessSpendGroup(row.transactionType),
            lamports: row.lamports,
            occurredAt: row.occurredAt,
            signature: row.signature,
          })
        )
        .filter((event): event is OperationalWalletSpendEvent =>
          Boolean(event)
        ),
      failed: false,
    };
  } catch {
    return { events: [], failed: true };
  }
}

// Route execution fees plus lookup-table provisioning fees and unreclaimed
// rent, both paid by the Earn policy wallet.
async function loadYieldSpendRows(
  addresses: string[],
  startedAt: Date
): Promise<SpendSourceResult> {
  try {
    const sql = getYieldNeonSql();
    const [routeRows, lookupTableRows] = await Promise.all([
      sql.query(
        `
        SELECT
          fee_payer AS address,
          'compiled_fee' AS amount_basis,
          'yield_route_fee' AS group_key,
          compiled_fee_lamports::text AS lamports,
          confirmed_at AS occurred_at,
          transaction_signature AS signature
        FROM loyal_yield.signed_route_submissions
        WHERE cluster = $1
          AND confirmed_at IS NOT NULL
          AND fee_payer = ANY($2::text[])
          AND confirmed_at >= $3::timestamptz
      `,
        [MAINNET_YIELD_CLUSTER, addresses, startedAt.toISOString()]
      ) as unknown as Promise<SpendEventObservationRow[]>,
      sql.query(
        `
        SELECT
          family.payer AS address,
          'confirmed_payer_outflow' AS amount_basis,
          'lookup_table_' || operation.operation_kind AS group_key,
          GREATEST(COALESCE(operation.actual_fee_lamports, 0) + COALESCE(operation.actual_rent_lamports, 0) - COALESCE(operation.reclaimed_rent_lamports, 0), 0)::text AS lamports,
          operation.confirmed_at AS occurred_at,
          operation.transaction_signature AS signature
        FROM loyal_yield.lookup_table_operations AS operation
        JOIN loyal_yield.lookup_table_families AS family
          ON family.id = operation.family_id
        WHERE family.cluster = $1
          AND operation.confirmed_at IS NOT NULL
          AND family.payer = ANY($2::text[])
          AND operation.confirmed_at >= $3::timestamptz
      `,
        [MAINNET_YIELD_CLUSTER, addresses, startedAt.toISOString()]
      ) as unknown as Promise<SpendEventObservationRow[]>,
    ]);

    return {
      events: [...routeRows, ...lookupTableRows]
        .map((row) =>
          toSpendEvent({
            address: row.address,
            amountBasis: row.amount_basis,
            group: row.group_key,
            lamports: row.lamports,
            occurredAt: row.occurred_at,
            signature: row.signature,
          })
        )
        .filter((event): event is OperationalWalletSpendEvent =>
          Boolean(event)
        ),
      failed: false,
    };
  } catch {
    return { events: [], failed: true };
  }
}

// Spend is summed per address across every source, because a wallet's roles do
// not partition the sources it appears in: the policy signer also has rows in
// the sponsorship table, and any key can turn up as a gasless payer. That makes
// a partial answer unusable — the missing source would understate some wallet's
// spend and inflate its runway with no way to tell which one. So if any source
// fails, no wallet reports spend and the failure is surfaced instead.
async function loadWalletSpend(
  addresses: string[],
  window: { endedAt: Date; startedAt: Date }
): Promise<{
  events: OperationalWalletSpendEvent[];
  spend: Map<string, WalletSpend>;
  sourceErrors: string[];
}> {
  const sourceErrors: string[] = [];
  if (addresses.length === 0) {
    return { events: [], sourceErrors, spend: new Map() };
  }

  const [sponsorship, gasless, yieldSpend] = await Promise.all([
    loadSponsorshipSpendRows(addresses, window.startedAt),
    loadGaslessClaimSpendRows(addresses, window.startedAt),
    loadYieldSpendRows(addresses, window.startedAt),
  ]);

  const sources: Array<{ error: string; result: SpendSourceResult }> = [
    {
      error: "Smart-account sponsorship spend history unavailable",
      result: sponsorship,
    },
    {
      error: "Gasless deployment spend history unavailable",
      result: gasless,
    },
    {
      error: "Yield execution spend history unavailable",
      result: yieldSpend,
    },
  ];

  for (const source of sources) {
    if (source.result.failed) {
      sourceErrors.push(source.error);
    }
  }

  if (sourceErrors.length > 0) {
    return { events: [], sourceErrors, spend: new Map() };
  }

  const events = sources
    .flatMap((source) => source.result.events)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const cutoff24h = window.endedAt.getTime() - 24 * 60 * 60 * 1000;
  const cutoff7d = window.endedAt.getTime() - 7 * 24 * 60 * 60 * 1000;

  // Every source answered, so each requested address now has a known spend.
  // Seed them all at zero: an address with no rows anywhere spent nothing,
  // which is an observation rather than missing data.
  const totals = new Map<string, { lamports24h: bigint; lamports7d: bigint }>(
    addresses.map((address) => [
      address,
      { lamports24h: BigInt(0), lamports7d: BigInt(0) },
    ])
  );
  for (const event of events) {
    const occurredAt = Date.parse(event.occurredAt);
    const lamports = BigInt(event.lamports);
    const existing = totals.get(event.address) ?? {
      lamports24h: BigInt(0),
      lamports7d: BigInt(0),
    };
    totals.set(event.address, {
      lamports24h:
        occurredAt >= cutoff24h
          ? existing.lamports24h + lamports
          : existing.lamports24h,
      lamports7d:
        occurredAt >= cutoff7d
          ? existing.lamports7d + lamports
          : existing.lamports7d,
    });
  }

  return {
    events,
    sourceErrors,
    spend: new Map(
      Array.from(totals.entries()).map(([address, total]) => [
        address,
        {
          spend24hLamports: total.lamports24h.toString(),
          spend7dLamports: total.lamports7d.toString(),
        },
      ])
    ),
  };
}

async function loadBalances(addresses: string[]): Promise<{
  balances: Map<string, string>;
  slot: number | null;
  observedAt: string;
  error: string | null;
}> {
  const observedAt = new Date().toISOString();
  if (addresses.length === 0) {
    return { balances: new Map(), error: null, observedAt, slot: null };
  }

  try {
    const response = await fetch(
      serverEnv.solanaMainnetRpcUrl ?? DEFAULT_MAINNET_RPC_URL,
      {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "getMultipleAccounts",
          params: [
            addresses,
            {
              commitment: "confirmed",
              dataSlice: { length: 0, offset: 0 },
              encoding: "base64",
            },
          ],
        }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );

    if (!response.ok) {
      return {
        balances: new Map(),
        error: `Solana RPC returned HTTP ${response.status}`,
        observedAt,
        slot: null,
      };
    }

    const payload = (await response.json()) as RpcResponse;
    if (payload.error || !payload.result?.value) {
      return {
        balances: new Map(),
        error: payload.error?.message ?? "Solana RPC returned no account data",
        observedAt,
        slot: payload.result?.context?.slot ?? null,
      };
    }

    const slot = payload.result.context?.slot;
    if (typeof slot !== "number") {
      return {
        balances: new Map(),
        error: "Solana RPC response omitted the confirmed observation slot",
        observedAt,
        slot: null,
      };
    }

    const balances = new Map<string, string>();
    for (const [index, account] of payload.result.value.entries()) {
      if (account) {
        balances.set(addresses[index], String(account.lamports));
      }
    }

    return {
      balances,
      error: null,
      observedAt,
      slot,
    };
  } catch {
    return {
      balances: new Map(),
      error: "Solana RPC balance read failed",
      observedAt,
      slot: null,
    };
  }
}

function formatLamports(lamports: bigint): string {
  return lamports.toString();
}

function calculateRunwayHours(
  balanceLamports: bigint | null,
  spend7dLamports: bigint | null
): number | null {
  if (
    balanceLamports === null ||
    spend7dLamports === null ||
    spend7dLamports <= BigInt(0)
  ) {
    return null;
  }

  return Number(balanceLamports) / (Number(spend7dLamports) / (7 * 24));
}

function calculateStatus(args: {
  balanceLamports: bigint | null;
  minimumLamports: bigint | null;
  roleKeys: FundingRole[];
  runwayHours: number | null;
  spendAvailable: boolean;
  spendTracked: boolean;
}): { status: FundingStatus; detail: string } {
  if (args.balanceLamports === null) {
    return {
      detail: "Balance unavailable from confirmed Solana RPC",
      status: "unknown",
    };
  }

  if (
    args.minimumLamports !== null &&
    args.balanceLamports < args.minimumLamports
  ) {
    return {
      detail: `Below ${
        Number(args.minimumLamports) / Number(LAMPORTS_PER_SOL)
      } SOL safety floor`,
      status: "critical",
    };
  }

  if (args.roleKeys.includes("sponsorship") && args.runwayHours !== null) {
    if (args.runwayHours < SPONSORSHIP_CRITICAL_RUNWAY_HOURS) {
      return {
        detail: `About ${args.runwayHours.toFixed(
          1
        )} hours of sponsorship runway`,
        status: "critical",
      };
    }

    if (args.runwayHours < SPONSORSHIP_LOW_RUNWAY_HOURS) {
      return {
        detail: `About ${(args.runwayHours / 24).toFixed(
          1
        )} days of sponsorship runway`,
        status: "low",
      };
    }
  }

  if (args.roleKeys.includes("sponsorship") && args.runwayHours === null) {
    return {
      detail: "Balance available; recent sponsorship spend is unavailable",
      status: "low",
    };
  }

  // No source records this wallet's outflow. It pays transaction fees, so
  // clearing the safety floor is not evidence of health: an unmeasured burn
  // rate is unknown, and only the floor above would catch a drain.
  if (!args.spendTracked) {
    return {
      detail:
        "Balance is above the safety floor, but spend is not tracked for this wallet so runway cannot be assessed",
      status: "unknown",
    };
  }

  // A wallet whose spend history could not be read has no runway to stand on,
  // so it must not claim to clear the operating thresholds. Spend that is
  // present but zero is a real observation and stays healthy.
  if (!args.spendAvailable) {
    return {
      detail: "Balance available; recent spend history is unavailable",
      status: "low",
    };
  }

  return {
    detail: "Balance is above the configured operating thresholds",
    status: "healthy",
  };
}

function createRoleDefinitions(args: {
  app: Awaited<ReturnType<typeof loadAppIdentityObservations>>;
  configuredDeployment: string | undefined;
  configuredPolicy: string | undefined;
  configuredSettingsAuthority: string | undefined;
  configuredSponsor: string | undefined;
  yield: Awaited<ReturnType<typeof loadYieldIdentityObservations>>;
}): RoleDefinition[] {
  return [
    {
      key: "sponsorship",
      label: "Smart-account sponsorship",
      observation: {
        configuredAddresses: uniqueAddresses([args.configuredSponsor]),
        observedAddresses: args.app.sponsorship,
      },
    },
    {
      key: "policy",
      label: "Earn policy / route execution",
      observation: {
        configuredAddresses: uniqueAddresses([args.configuredPolicy]),
        observedAddresses: args.yield.policy,
      },
    },
    {
      key: "deployment",
      label: "Gasless deployment payer",
      observation: {
        configuredAddresses: uniqueAddresses([args.configuredDeployment]),
        observedAddresses: args.app.deployment,
      },
    },
    {
      key: "settings_authority",
      label: "Earn settings authority",
      observation: {
        configuredAddresses: uniqueAddresses([
          args.configuredSettingsAuthority,
        ]),
        observedAddresses: args.yield.settingsAuthority,
      },
    },
    ...args.yield.routeFeePayer.map((observation) => ({
      key: "route_fee_payer" as const,
      label: "Route fee-payer shard",
      observation: {
        configuredAddresses: [],
        observedAddresses: [observation],
      },
    })),
  ];
}

function createWallets(args: {
  balances: Map<string, string>;
  definitions: RoleDefinition[];
  spend: Map<string, WalletSpend>;
  rpcError: string | null;
  rpcObservedAt: string;
  rpcSlot: number | null;
}): {
  missingRoles: EarnFundingData["missingRoles"];
  wallets: EarnFundingWallet[];
} {
  const wallets = new Map<
    string,
    {
      configuredAddresses: Set<string>;
      observedAddresses: Set<string>;
      roles: EarnFundingWallet["roles"];
    }
  >();
  const missingRoles: EarnFundingData["missingRoles"] = [];

  for (const definition of args.definitions) {
    const configuredAddresses = definition.observation.configuredAddresses;
    const observedAddresses = definition.observation.observedAddresses;
    const addresses = uniqueAddresses([
      ...configuredAddresses,
      ...observedAddresses.map((row) => row.address),
    ]);

    if (addresses.length === 0) {
      missingRoles.push({
        key: definition.key,
        label: definition.label,
        reason:
          observedAddresses.length === 0
            ? "No public address was configured or observed"
            : "No usable public address was resolved",
      });
      continue;
    }

    for (const address of addresses) {
      const existing = wallets.get(address) ?? {
        configuredAddresses: new Set<string>(),
        observedAddresses: new Set<string>(),
        roles: [],
      };
      configuredAddresses.forEach((value) =>
        existing.configuredAddresses.add(value)
      );
      observedAddresses.forEach((value) =>
        existing.observedAddresses.add(value.address)
      );
      existing.roles.push({
        key: definition.key,
        label: definition.label,
        observedCount:
          observedAddresses.find((row) => row.address === address)?.count ??
          null,
        latestObservedAt:
          observedAddresses.find((row) => row.address === address)
            ?.latestObservedAt ?? null,
      });
      wallets.set(address, existing);
    }
  }

  return {
    missingRoles,
    wallets: Array.from(wallets.entries()).map(([address, wallet]) => {
      const balanceLamportsText = args.balances.get(address) ?? null;
      const balanceLamports =
        balanceLamportsText === null ? null : BigInt(balanceLamportsText);
      const roleKeys = wallet.roles.map((role) => role.key);
      const spend = args.spend.get(address) ?? {
        spend24hLamports: null,
        spend7dLamports: null,
      };
      const spend7dLamports = spend.spend7dLamports
        ? BigInt(spend.spend7dLamports)
        : null;
      const runwayHours = calculateRunwayHours(
        balanceLamports,
        spend7dLamports
      );
      const minimumLamports = roleKeys.some(
        (key) =>
          key === "policy" ||
          key === "deployment" ||
          key === "route_fee_payer" ||
          key === "settings_authority"
      )
        ? POLICY_MINIMUM_LAMPORTS
        : null;
      const status = calculateStatus({
        balanceLamports,
        minimumLamports,
        roleKeys,
        runwayHours,
        spendAvailable: spend.spend7dLamports !== null,
        spendTracked: roleKeys.some((key) => SPEND_TRACKED_ROLES.has(key)),
      });
      const mismatch = wallet.roles.some((role) => {
        const definition = args.definitions.find(
          (candidate) => candidate.key === role.key
        );
        if (!definition) {
          return false;
        }
        const configuredAddresses = definition.observation.configuredAddresses;
        const observedAddresses = definition.observation.observedAddresses;
        return (
          configuredAddresses.length > 0 &&
          (observedAddresses.length === 0 ||
            configuredAddresses.some(
              (configuredAddress) =>
                !observedAddresses.some(
                  (observed) => observed.address === configuredAddress
                )
            ))
        );
      });

      return {
        address,
        balanceError:
          balanceLamports === null
            ? args.rpcError ?? "Account not found at the confirmed RPC slot"
            : null,
        balanceLamports: balanceLamportsText,
        balanceObservedAt: args.rpcError ? null : args.rpcObservedAt,
        balanceSlot: args.rpcError ? null : args.rpcSlot,
        configuredAddresses: Array.from(wallet.configuredAddresses),
        mismatch,
        minimumLamports: minimumLamports
          ? formatLamports(minimumLamports)
          : null,
        observedAddresses: Array.from(wallet.observedAddresses),
        roles: wallet.roles,
        runwayHours,
        spend24hLamports: spend.spend24hLamports,
        spend7dLamports: spend.spend7dLamports,
        status: status.status,
        statusDetail: status.detail,
      };
    }),
  };
}

async function loadFundingData(): Promise<EarnFundingData> {
  const spendWindow = getOperationalWalletSpendWindow(new Date());
  const configuredSettingsAuthority = serverEnv.earnSettingsAuthorityPublicKey;
  const [appObservations, yieldObservations] = await Promise.all([
    loadAppIdentityObservations(),
    loadYieldIdentityObservations(
      uniqueAddresses([configuredSettingsAuthority])
    ),
  ]);
  const sourceErrors = [
    appObservations.sourceError,
    yieldObservations.sourceError,
  ].filter((value): value is string => Boolean(value));
  const definitions = createRoleDefinitions({
    app: appObservations,
    configuredDeployment: serverEnv.deploymentPublicKey,
    configuredPolicy: serverEnv.earnPolicySignerPublicKey,
    configuredSettingsAuthority,
    configuredSponsor: serverEnv.smartAccountSponsorPublicKey,
    yield: yieldObservations,
  });
  const addresses = uniqueAddresses(
    definitions.flatMap((definition) => [
      ...definition.observation.configuredAddresses,
      ...definition.observation.observedAddresses.map((row) => row.address),
    ])
  );
  const balanceResult = await loadBalances(addresses);
  if (balanceResult.error) {
    sourceErrors.push(balanceResult.error);
  }

  // Only addresses with a spend-tracked role are queried. Seeding a zero for a
  // wallet no source covers would report "spent nothing" for outflow that is
  // simply never recorded.
  const spendTrackedAddresses = uniqueAddresses(
    definitions
      .filter((definition) => SPEND_TRACKED_ROLES.has(definition.key))
      .flatMap((definition) => [
        ...definition.observation.configuredAddresses,
        ...definition.observation.observedAddresses.map((row) => row.address),
      ])
  );
  const spendResult = await loadWalletSpend(spendTrackedAddresses, spendWindow);
  sourceErrors.push(...spendResult.sourceErrors);

  const walletResult = createWallets({
    balances: balanceResult.balances,
    definitions,
    rpcError: balanceResult.error,
    rpcObservedAt: balanceResult.observedAt,
    rpcSlot: balanceResult.slot,
    spend: spendResult.spend,
  });

  return {
    ...walletResult,
    observedAt: balanceResult.observedAt,
    spendEvents: spendResult.events,
    spendSourceErrors: spendResult.sourceErrors,
    spendWindow: {
      endedAt: spendWindow.endedAt.toISOString(),
      startedAt: spendWindow.startedAt.toISOString(),
    },
    sourceErrors,
  };
}

export async function getEarnFundingData(): Promise<EarnFundingData> {
  return loadFundingData();
}
