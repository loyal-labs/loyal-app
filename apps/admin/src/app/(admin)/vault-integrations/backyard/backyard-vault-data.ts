import "server-only";

import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

const MANIFEST = {
  adaptor: "FSj27QT2PtP7365pQRtgSAwSwk5h2m2ATCBoXQjwTSxW",
  strategyReceipt: "4sycXz9Xwevedo6eiXR8QEhY8yrQrkNS4G1deY9tAD2Y",
  squadsSettings: "5YQ78RwqukvCcykpmjmgRFmbEUeAgLpuVDxx1xNZnHD6",
  squadsVault: "ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh",
  voltrProgram: "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8",
  voltrVault: "HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA",
  vaultCapRaw: BigInt("1000000000000"),
  withdrawalWaitSeconds: 600,
} as const;

type DashboardRow = {
  collateral_raw: string | null;
  collateral_value_usd_micros: string | null;
  debt_raw: string | null;
  debt_value_usd_micros: string | null;
  equity_usd_micros: string | null;
  forecast_apy_bps: string | null;
  ltv_bps: string | null;
  observed_at: Date | string | null;
  route_key: string;
  state: unknown;
  strategy_key: string | null;
};

type OperationRow = {
  action: string;
  amount_raw: string | null;
  created_at: Date | string;
  status: string;
  transaction_signature: string | null;
};

type VaultSettings = Array<{ key: string; value: string }>;

export type BackyardVaultData =
  | { available: false; error: string; observedAt: string }
  | {
      available: true;
      aumUsdMicros: bigint | null;
      currentPosition: {
        collateralRaw: bigint | null;
        debtRaw: bigint | null;
        ltvBps: bigint | null;
        strategy: string | null;
      };
      history: OperationRow[];
      navUsdMicros: bigint | null;
      observedAt: string;
      projectedApyBps: bigint | null;
      report: {
        fresh: boolean | null;
        observedAt: string | null;
        slot: bigint | null;
      };
      routeStatus: string | null;
      settings: VaultSettings;
      squadsIdleRaw: bigint | null;
      strategyIdleRaw: bigint | null;
      voltrIdleRaw: bigint | null;
      vaultCapRaw: bigint;
      withdrawalWaitSeconds: number;
    };

function toBigInt(value: string | null) {
  return value === null ? null : BigInt(value);
}

function toIso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

function scalarSettings(value: unknown): VaultSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value)
    .filter(([, nested]) =>
      ["string", "number", "boolean"].includes(typeof nested)
    )
    .slice(0, 12)
    .map(([key, nested]) => ({ key, value: String(nested) }));
}

function projectedValue(state: Record<string, unknown> | null, keys: string[]) {
  if (!state) return null;
  const groups = [
    state,
    state.snapshot,
    state.observation,
    state.balances,
    state.report,
  ].filter(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value)
  );
  for (const group of groups) {
    for (const key of keys) {
      const value = group[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      )
        return value;
    }
  }
  return null;
}

function projectedBigInt(
  state: Record<string, unknown> | null,
  keys: string[]
) {
  const value = projectedValue(state, keys);
  try {
    return value === null ? null : BigInt(value);
  } catch {
    return null;
  }
}

function projectedBoolean(
  state: Record<string, unknown> | null,
  keys: string[]
) {
  if (!state) return null;
  const groups = [
    state,
    state.snapshot,
    state.observation,
    state.balances,
    state.report,
  ].filter(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value)
  );
  for (const group of groups) {
    for (const key of keys) {
      if (typeof group[key] === "boolean") return group[key];
    }
  }
  return null;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The Backyard RWA projection could not be loaded.";
}

export async function getBackyardVaultData(): Promise<BackyardVaultData> {
  const observedAt = new Date().toISOString();

  try {
    const sql = getYieldNeonSql();
    const rows = (await sql.query(`
      SELECT route.route_key, route.state,
        snapshot.strategy_key, snapshot.collateral_raw::text,
        snapshot.debt_raw::text, snapshot.equity_usd_micros::text,
        snapshot.collateral_value_usd_micros::text,
        snapshot.debt_value_usd_micros::text, snapshot.ltv_bps::text,
        snapshot.forecast_apy_bps::text, snapshot.observed_at
      FROM loyal_yield.multiply_route_states AS route
      LEFT JOIN LATERAL (
        SELECT * FROM loyal_yield.multiply_position_snapshots
        WHERE route_key = route.route_key
        ORDER BY observed_at DESC, id DESC
        LIMIT 1
      ) AS snapshot ON true
      WHERE route.state ->> 'engineVersion' = 'backyard_rwa_v1'
      ORDER BY snapshot.observed_at DESC NULLS LAST, route.updated_at DESC
      LIMIT 1
    `)) as unknown as DashboardRow[];
    const row = rows[0];

    if (!row) {
      return {
        available: false,
        error:
          "No Backyard RWA route projection exists yet. The page will populate after the Go worker records its first observation.",
        observedAt,
      };
    }

    const history = (await sql.query(
      `
      SELECT action, status, expected_effects -> 'decision' ->> 'amountRaw' AS amount_raw,
        transaction_signature, created_at
      FROM loyal_yield.multiply_operations
      WHERE route_key = $1 AND engine_version = 'backyard_rwa_v1'
      ORDER BY created_at DESC, operation_id DESC
      LIMIT 20
    `,
      [row.route_key]
    )) as unknown as OperationRow[];

    const state = row.state as Record<string, unknown> | null;
    const routeSettings = scalarSettings(state?.vaultSettings);
    const observedSnapshotAt = toIso(row.observed_at);
    // Position equity is only one NAV component. Never present it as vault
    // AUM or adaptor NAV when idle balances/report state are unavailable.
    const aumUsdMicros = projectedBigInt(state, [
      "aumUsdMicros",
      "aum_usd_micros",
      "aumRaw",
    ]);
    const navUsdMicros = projectedBigInt(state, [
      "navUsdMicros",
      "nav_usd_micros",
      "reportedNavRaw",
      "navRaw",
    ]);

    return {
      available: true,
      aumUsdMicros,
      currentPosition: {
        collateralRaw: toBigInt(row.collateral_raw),
        debtRaw: toBigInt(row.debt_raw),
        ltvBps: toBigInt(row.ltv_bps),
        strategy: row.strategy_key,
      },
      history,
      navUsdMicros,
      observedAt: observedSnapshotAt ?? observedAt,
      projectedApyBps: toBigInt(row.forecast_apy_bps),
      report: {
        fresh: projectedBoolean(state, ["fresh", "navFresh"]),
        observedAt:
          String(
            projectedValue(state, ["reportObservedAt", "navObservedAt"]) ?? ""
          ) || null,
        slot: projectedBigInt(state, ["reportSlot", "navSlot", "slot"]),
      },
      routeStatus:
        String(projectedValue(state, ["routeStatus", "status"]) ?? "") || null,
      settings: [
        { key: "Voltr vault", value: MANIFEST.voltrVault },
        { key: "Voltr program", value: MANIFEST.voltrProgram },
        { key: "Squads vault", value: MANIFEST.squadsVault },
        { key: "Squads settings", value: MANIFEST.squadsSettings },
        { key: "Adaptor", value: MANIFEST.adaptor },
        { key: "Strategy receipt", value: MANIFEST.strategyReceipt },
        ...routeSettings,
      ],
      squadsIdleRaw: projectedBigInt(state, [
        "squadsIdleRaw",
        "squads_idle_raw",
      ]),
      strategyIdleRaw: projectedBigInt(state, [
        "voltrStrategyIdleRaw",
        "voltr_strategy_idle_raw",
      ]),
      voltrIdleRaw: projectedBigInt(state, ["voltrIdleRaw", "voltr_idle_raw"]),
      vaultCapRaw: MANIFEST.vaultCapRaw,
      withdrawalWaitSeconds: MANIFEST.withdrawalWaitSeconds,
    };
  } catch (error) {
    return { available: false, error: errorMessage(error), observedAt };
  }
}
