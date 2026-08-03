import "server-only";

import {
  appSmartAccountSponsorshipTransactions,
  gaslessClaimTransactions,
} from "@loyal-labs/db-core/schema";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  max,
  sql as drizzleSql,
  sum,
} from "drizzle-orm";

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

type FundingRole = "sponsorship" | "policy" | "deployment" | "route_fee_payer";

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

export type EarnFundingData = {
  wallets: EarnFundingWallet[];
  missingRoles: Array<{ key: FundingRole; label: string; reason: string }>;
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

type SpendObservationRow = {
  address: string | null;
  lamports_24h: string | number | null;
  lamports_7d: string | number | null;
};

type SpendRow = {
  address: string;
  lamports24h: bigint;
  lamports7d: bigint;
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

async function loadYieldIdentityObservations(): Promise<{
  policy: IdentityObservation[];
  routeFeePayer: IdentityObservation[];
  sourceError: string | null;
}> {
  try {
    const sql = getYieldNeonSql();
    const [policyRows, feePayerRows] = await Promise.all([
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
    ]);

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
      sourceError: null,
    };
  } catch {
    return {
      policy: [],
      routeFeePayer: [],
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

function toSpendRow(
  address: string | null | undefined,
  lamports24h: string | number | null | undefined,
  lamports7d: string | number | null | undefined
): SpendRow | null {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    return null;
  }

  return {
    address: normalizedAddress,
    lamports24h: toSpendLamports(lamports24h),
    lamports7d: toSpendLamports(lamports7d),
  };
}

// Sponsored smart-account deployments; rows are written by the app when each
// sponsored transaction finalizes.
async function loadSponsorshipSpendRows(
  addresses: string[]
): Promise<SpendRow[]> {
  try {
    const db = getDatabase();
    const rows = await db
      .select({
        address: appSmartAccountSponsorshipTransactions.payerAddress,
        lamports24h: sum(
          drizzleSql`CASE WHEN ${appSmartAccountSponsorshipTransactions.occurredAt} >= NOW() - INTERVAL '24 hours' THEN ${appSmartAccountSponsorshipTransactions.spentLamports} ELSE 0 END`
        ),
        lamports7d: sum(
          drizzleSql`CASE WHEN ${appSmartAccountSponsorshipTransactions.occurredAt} >= NOW() - INTERVAL '7 days' THEN ${appSmartAccountSponsorshipTransactions.spentLamports} ELSE 0 END`
        ),
      })
      .from(appSmartAccountSponsorshipTransactions)
      .where(
        and(
          eq(appSmartAccountSponsorshipTransactions.solanaEnv, MAINNET_APP_ENV),
          inArray(
            appSmartAccountSponsorshipTransactions.payerAddress,
            addresses
          )
        )
      )
      .groupBy(appSmartAccountSponsorshipTransactions.payerAddress);

    return rows
      .map((row) => toSpendRow(row.address, row.lamports24h, row.lamports7d))
      .filter((row): row is SpendRow => Boolean(row));
  } catch {
    return [];
  }
}

// Gasless claim/verification transactions; rows are backfilled by the app's
// private-transfer-analytics cron.
async function loadGaslessClaimSpendRows(
  addresses: string[]
): Promise<SpendRow[]> {
  try {
    const db = getDatabase();
    const rows = await db
      .select({
        address: gaslessClaimTransactions.payerAddress,
        lamports24h: sum(
          drizzleSql`CASE WHEN ${gaslessClaimTransactions.occurredAt} >= NOW() - INTERVAL '24 hours' THEN ${gaslessClaimTransactions.spentLamports} ELSE 0 END`
        ),
        lamports7d: sum(
          drizzleSql`CASE WHEN ${gaslessClaimTransactions.occurredAt} >= NOW() - INTERVAL '7 days' THEN ${gaslessClaimTransactions.spentLamports} ELSE 0 END`
        ),
      })
      .from(gaslessClaimTransactions)
      .where(
        and(
          eq(gaslessClaimTransactions.solanaEnv, MAINNET_APP_ENV),
          inArray(gaslessClaimTransactions.payerAddress, addresses)
        )
      )
      .groupBy(gaslessClaimTransactions.payerAddress);

    return rows
      .map((row) => toSpendRow(row.address, row.lamports24h, row.lamports7d))
      .filter((row): row is SpendRow => Boolean(row));
  } catch {
    return [];
  }
}

// Route execution fees plus lookup-table provisioning fees and unreclaimed
// rent, both paid by the Earn policy wallet.
async function loadYieldSpendRows(addresses: string[]): Promise<SpendRow[]> {
  try {
    const sql = getYieldNeonSql();
    const [routeRows, lookupTableRows] = await Promise.all([
      sql.query(
        `
        SELECT
          fee_payer AS address,
          COALESCE(SUM(compiled_fee_lamports) FILTER (WHERE confirmed_at >= NOW() - INTERVAL '24 hours'), 0)::text AS lamports_24h,
          COALESCE(SUM(compiled_fee_lamports) FILTER (WHERE confirmed_at >= NOW() - INTERVAL '7 days'), 0)::text AS lamports_7d
        FROM loyal_yield.signed_route_submissions
        WHERE cluster = $1
          AND confirmed_at IS NOT NULL
          AND fee_payer = ANY($2::text[])
        GROUP BY fee_payer
      `,
        [MAINNET_YIELD_CLUSTER, addresses]
      ) as unknown as Promise<SpendObservationRow[]>,
      sql.query(
        `
        SELECT
          family.payer AS address,
          COALESCE(SUM(GREATEST(COALESCE(operation.actual_fee_lamports, 0) + COALESCE(operation.actual_rent_lamports, 0) - COALESCE(operation.reclaimed_rent_lamports, 0), 0)) FILTER (WHERE operation.confirmed_at >= NOW() - INTERVAL '24 hours'), 0)::text AS lamports_24h,
          COALESCE(SUM(GREATEST(COALESCE(operation.actual_fee_lamports, 0) + COALESCE(operation.actual_rent_lamports, 0) - COALESCE(operation.reclaimed_rent_lamports, 0), 0)) FILTER (WHERE operation.confirmed_at >= NOW() - INTERVAL '7 days'), 0)::text AS lamports_7d
        FROM loyal_yield.lookup_table_operations AS operation
        JOIN loyal_yield.lookup_table_families AS family
          ON family.id = operation.family_id
        WHERE family.cluster = $1
          AND operation.confirmed_at IS NOT NULL
          AND family.payer = ANY($2::text[])
        GROUP BY family.payer
      `,
        [MAINNET_YIELD_CLUSTER, addresses]
      ) as unknown as Promise<SpendObservationRow[]>,
    ]);

    return [...routeRows, ...lookupTableRows]
      .map((row) => toSpendRow(row.address, row.lamports_24h, row.lamports_7d))
      .filter((row): row is SpendRow => Boolean(row));
  } catch {
    return [];
  }
}

async function loadWalletSpend(
  addresses: string[]
): Promise<Map<string, WalletSpend>> {
  if (addresses.length === 0) {
    return new Map();
  }

  const rowGroups = await Promise.all([
    loadSponsorshipSpendRows(addresses),
    loadGaslessClaimSpendRows(addresses),
    loadYieldSpendRows(addresses),
  ]);

  const totals = new Map<string, { lamports24h: bigint; lamports7d: bigint }>();
  for (const row of rowGroups.flat()) {
    const existing = totals.get(row.address) ?? {
      lamports24h: BigInt(0),
      lamports7d: BigInt(0),
    };
    totals.set(row.address, {
      lamports24h: existing.lamports24h + row.lamports24h,
      lamports7d: existing.lamports7d + row.lamports7d,
    });
  }

  return new Map(
    Array.from(totals.entries()).map(([address, total]) => [
      address,
      {
        spend24hLamports: total.lamports24h.toString(),
        spend7dLamports: total.lamports7d.toString(),
      },
    ])
  );
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

  return {
    detail: "Balance is above the configured operating thresholds",
    status: "healthy",
  };
}

function createRoleDefinitions(args: {
  app: Awaited<ReturnType<typeof loadAppIdentityObservations>>;
  configuredDeployment: string | undefined;
  configuredPolicy: string | undefined;
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
      const roleKeys = wallet.roles.map((role) => role.key);
      const minimumLamports = roleKeys.some(
        (key) =>
          key === "policy" || key === "deployment" || key === "route_fee_payer"
      )
        ? POLICY_MINIMUM_LAMPORTS
        : null;
      const status = calculateStatus({
        balanceLamports,
        minimumLamports,
        roleKeys,
        runwayHours,
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
  const [appObservations, yieldObservations] = await Promise.all([
    loadAppIdentityObservations(),
    loadYieldIdentityObservations(),
  ]);
  const sourceErrors = [
    appObservations.sourceError,
    yieldObservations.sourceError,
  ].filter((value): value is string => Boolean(value));
  const definitions = createRoleDefinitions({
    app: appObservations,
    configuredDeployment: serverEnv.deploymentPublicKey,
    configuredPolicy: serverEnv.earnPolicySignerPublicKey,
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

  const spend = await loadWalletSpend(addresses);

  const walletResult = createWallets({
    balances: balanceResult.balances,
    definitions,
    rpcError: balanceResult.error,
    rpcObservedAt: balanceResult.observedAt,
    rpcSlot: balanceResult.slot,
    spend,
  });

  return {
    ...walletResult,
    observedAt: balanceResult.observedAt,
    sourceErrors,
  };
}

export async function getEarnFundingData(): Promise<EarnFundingData> {
  return loadFundingData();
}
