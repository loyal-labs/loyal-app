import { PublicKey } from "@solana/web3.js";

import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

// Current Earn + Earn MAX holdings per smart account, for the 01Resolved
// growth-metrics feed (repo loyal-growth-metrics-feed). The feed Worker polls
// this hourly and publishes the last reading before each UTC midnight.
//
// - Earn: current redeemable reserves plus idle balance of every Loyal vault a
//   user has deposited through (any stablecoin, whether or not the position is
//   still marked active), grouped by smart account. Same rule as the history
//   rebuilt in loyal-growth-metrics-feed/backfill. Slightly above the public
//   stats AUM, which counts active positions only.
// - Earn MAX: a pooled Voltr vault, so ownership lives on-chain as LP tokens.
//   Each holder is valued at the vault share price and mapped back to its smart
//   account through the index-0 vault PDA. Holders that are not Loyal smart
//   accounts count as their own user.

const EARN_MAX_VOLTR_VAULT = "HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA";
const EARN_MAX_LP_MINT = "6tNheTBYSpQkfMLhcczKgmTLSGffK54npKMG1WQR2tvb";
const EARN_MAX_VAULT_INDEX = 0;
const SMART_ACCOUNT_PROGRAM_ID = new PublicKey(
  "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"
);
const SMART_ACCOUNT_SEED = new TextEncoder().encode("smart_account");
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// Same mainnet node as apps/web/src/lib/solana/rpc-endpoints.ts.
const DEFAULT_RPC_URL = "https://fredra-z7l52f-fast-mainnet.helius-rpc.com";
const REQUEST_TIMEOUT_MS = 15_000;
const QUERY_TIMEOUT_MS = 50_000;

export const ACTIVE_USER_MIN_USD = 1;

export type GrowthMetricsReading = {
  observedAt: string;
  tvlUsd: number;
  activeUsers: number;
  earnUsd: number;
  earnMaxUsd: number;
};

type EarnRow = { settings: string; raw: string };

async function loadEarnBySettings(): Promise<Map<string, number>> {
  const sql = getYieldNeonSql();
  const [, , result] = await sql.transaction((txn) => [
    txn.query(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT_MS}ms'`),
    // The planner expects one user vault instead of ~7.5k and re-scans the
    // aggregates per vault in a nested loop (~15s); hash joins take ~2s.
    txn.query("SET LOCAL enable_nestloop = off"),
    txn.query(
      `
      WITH user_vaults AS (
        SELECT DISTINCT vault.id AS vault_id, position.settings
        FROM loyal_yield.user_yield_positions AS position
        INNER JOIN loyal_yield.managed_vaults AS vault
          ON vault.settings = position.settings
          AND vault.vault_index = position.vault_index
          AND vault.vault_pubkey = position.vault_pubkey
      ),
      reserve AS (
        SELECT
          current.vault_id,
          SUM(
            CASE
              WHEN semantics IS NULL
                OR semantics IN ('kamino_redeemable_liquidity', 'redeemable_liquidity_amount')
                THEN current.amount_raw
              WHEN semantics = 'kamino_obligation_collateral_deposited_amount'
                AND redeemable ~ '^[0-9]+$'
                THEN redeemable::bigint
              ELSE 0
            END
          ) AS raw
        FROM loyal_yield.vault_reserve_positions_current AS current
        CROSS JOIN LATERAL (
          SELECT
            COALESCE(
              current.planning_metadata ->> 'amountSemantics',
              current.planning_metadata ->> 'amount_semantics'
            ) AS semantics,
            COALESCE(
              current.planning_metadata ->> 'redeemable_liquidity_amount_raw',
              current.planning_metadata ->> 'redeemable_source_liquidity_amount_raw'
            ) AS redeemable
        ) AS meta
        GROUP BY current.vault_id
      ),
      idle AS (
        SELECT vault_id, SUM(amount_raw) AS raw
        FROM loyal_yield.vault_idle_token_balances_current
        GROUP BY vault_id
      )
      SELECT
        user_vaults.settings,
        SUM(COALESCE(reserve.raw, 0) + COALESCE(idle.raw, 0))::text AS raw
      FROM user_vaults
      LEFT JOIN reserve ON reserve.vault_id = user_vaults.vault_id
      LEFT JOIN idle ON idle.vault_id = user_vaults.vault_id
      GROUP BY user_vaults.settings
      `
    ),
  ]);
  if (!Array.isArray(result)) {
    throw new Error("unexpected neon result shape");
  }
  return new Map(
    (result as EarnRow[]).map((row) => [
      row.settings,
      Number(BigInt(row.raw)) / 1_000_000,
    ])
  );
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json()) as { result?: T; error?: unknown };
  if (!response.ok || body.result === undefined) {
    throw new Error(`${method} failed: HTTP ${response.status}`);
  }
  return body.result;
}

type ParsedTokenAccount = {
  account: {
    data: {
      parsed: { info: { owner: string; tokenAmount: { amount: string } } };
    };
  };
};

/** Earn MAX USD per LP holder (token-account owner). */
async function loadEarnMaxByHolder(): Promise<Map<string, number>> {
  const [sharePrice, supply, accounts] = await Promise.all([
    fetch(`https://api.voltr.xyz/vault/${EARN_MAX_VOLTR_VAULT}/share-price`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).then(
      (response) =>
        response.json() as Promise<{
          success?: boolean;
          data?: { totalValue?: number };
        }>
    ),
    rpc<{ value: { amount: string } }>("getTokenSupply", [EARN_MAX_LP_MINT]),
    rpc<ParsedTokenAccount[]>("getProgramAccounts", [
      TOKEN_PROGRAM_ID,
      {
        encoding: "jsonParsed",
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: EARN_MAX_LP_MINT } },
        ],
      },
    ]),
  ]);
  const totalValueRaw = sharePrice.data?.totalValue;
  const supplyRaw = Number(supply.value.amount);
  if (
    sharePrice.success !== true ||
    typeof totalValueRaw !== "number" ||
    !(supplyRaw > 0)
  ) {
    throw new Error("Invalid Earn MAX valuation");
  }
  const usdPerLpRaw = totalValueRaw / 1_000_000 / supplyRaw;

  const byHolder = new Map<string, number>();
  for (const { account } of accounts) {
    const { owner, tokenAmount } = account.data.parsed.info;
    const amount = Number(tokenAmount.amount);
    if (amount > 0) {
      byHolder.set(owner, (byHolder.get(owner) ?? 0) + amount * usdPerLpRaw);
    }
  }
  return byHolder;
}

function earnMaxVaultOf(settings: string): string | null {
  try {
    return PublicKey.findProgramAddressSync(
      [
        SMART_ACCOUNT_SEED,
        new PublicKey(settings).toBytes(),
        SMART_ACCOUNT_SEED,
        Uint8Array.of(EARN_MAX_VAULT_INDEX),
      ],
      SMART_ACCOUNT_PROGRAM_ID
    )[0].toBase58();
  } catch {
    return null;
  }
}

export async function loadGrowthMetricsReading(): Promise<GrowthMetricsReading> {
  const [earnBySettings, earnMaxByHolder] = await Promise.all([
    loadEarnBySettings(),
    loadEarnMaxByHolder(),
  ]);

  const settingsByEarnMaxVault = new Map<string, string>();
  for (const settings of earnBySettings.keys()) {
    const vault = earnMaxVaultOf(settings);
    if (vault) settingsByEarnMaxVault.set(vault, settings);
  }

  const perUser = new Map(earnBySettings);
  for (const [holder, usd] of earnMaxByHolder) {
    const user = settingsByEarnMaxVault.get(holder) ?? `holder:${holder}`;
    perUser.set(user, (perUser.get(user) ?? 0) + usd);
  }

  const sum = (values: Iterable<number>) =>
    [...values].reduce((total, value) => total + value, 0);
  const earnUsd = sum(earnBySettings.values());
  const earnMaxUsd = sum(earnMaxByHolder.values());
  return {
    observedAt: new Date().toISOString(),
    tvlUsd: earnUsd + earnMaxUsd,
    activeUsers: [...perUser.values()].filter(
      (usd) => usd > ACTIVE_USER_MIN_USD
    ).length,
    earnUsd,
    earnMaxUsd,
  };
}
