#!/usr/bin/env bun

// Runs the real Drizzle queries against disposable in-memory PostgreSQL.
// Pass an installed @electric-sql/pglite module path as argv[2]; no database
// credentials are read and no production database or RPC is contacted.
import assert from "node:assert/strict";

import {
  RISK_BASKET_MARKETS,
  STABLECOIN_MINTS,
} from "@loyal-labs/actions/constants";
import { RiskBasket, Stablecoin } from "@loyal-labs/actions/types";
import { drizzle } from "drizzle-orm/pg-proxy";

import { TimescaleReserveClient } from "../src/lib/kamino/timescale-reserve-client.server";

type LocalPostgres = {
  exec: (sql: string) => Promise<unknown>;
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{
    rows: Record<string, unknown>[];
    fields: { name: string }[];
  }>;
  close: () => Promise<void>;
};

const { PGlite } = (await import(
  process.argv[2] ?? "@electric-sql/pglite"
)) as { PGlite: new () => LocalPostgres };
const database = new PGlite();
const client = new TimescaleReserveClient({
  databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
});
// Only the transport is replaced. Query construction, predicates, decoding,
// ranking and public return values all execute through the production methods.
Object.defineProperty(client, "db", {
  value: drizzle(async (sql, params) => {
    const result = await database.query(sql, params);
    return {
      rows: result.rows.map((row) =>
        result.fields.map(({ name }) => row[name])
      ),
    };
  }),
});

const now = new Date();
const safeMarket = RISK_BASKET_MARKETS[RiskBasket.Safe][0].toBase58();
const usdc = STABLECOIN_MINTS[Stablecoin.USDC].toBase58();
const usdt = STABLECOIN_MINTS[Stablecoin.USDT].toBase58();
let sequence = 0;
let checks = 0;

async function verify(name: string, run: () => Promise<void>) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function seed(
  reserve: string,
  overrides: Partial<{
    ageSeconds: number;
    slot: number;
    source: string;
    commitment: string;
    mint: string;
    market: string;
    catalogMint: string;
    catalogMarket: string;
    active: boolean;
    supply: number;
    apy: number;
    stale: boolean;
    pointerHash: string;
  }> = {}
) {
  sequence += 1;
  const row = {
    ageSeconds: 10,
    slot: 1000 + sequence,
    source: "laserstream_grpc",
    commitment: "confirmed",
    mint: usdc,
    market: safeMarket,
    active: true,
    supply: 1_000_000,
    apy: 0.04,
    stale: false,
    ...overrides,
  };
  const observedAt = new Date(
    now.getTime() - row.ageSeconds * 1000
  ).toISOString();
  const hash = sequence.toString(16).padStart(64, "0");
  await database.query(
    `INSERT INTO kamino.reserve_updates
       (event_id,reserve,observed_at,slot,source,source_commitment,account_data_hash,
        liquidity_mint,market,supply_apy,total_supply_usd_estimate,reserve_last_update_stale)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      sequence,
      reserve,
      observedAt,
      row.slot,
      row.source,
      row.commitment,
      hash,
      row.mint,
      row.market,
      row.apy,
      row.supply,
      row.stale,
    ]
  );
  await database.query(
    `INSERT INTO kamino.reserve_current_states
       (reserve,state_event_id,account_data_hash,state_slot,state_observed_at,state_source)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      reserve,
      sequence,
      row.pointerHash ?? hash,
      row.slot,
      observedAt,
      row.source,
    ]
  );
  await database.query(
    `INSERT INTO kamino.supported_reserves (reserve,market,liquidity_mint,active)
     VALUES ($1,$2,$3,$4)`,
    [
      reserve,
      row.catalogMarket ?? row.market,
      row.catalogMint ?? row.mint,
      row.active,
    ]
  );
}

const eligible = () =>
  client.getCurrentEligibleSafeReserves({ riskProfile: RiskBasket.Safe });
const presence = (reserves: string[]) =>
  client.getLatestReserveObservationsByReserve({ reserves });

try {
  // Deliberately no legacy verification table or view: the regression cannot
  // pass by accidentally reading the retired data source.
  await database.exec(`
    CREATE SCHEMA kamino;
    CREATE TABLE kamino.reserve_updates (
      event_id bigint PRIMARY KEY, reserve text NOT NULL, observed_at timestamptz NOT NULL,
      slot bigint NOT NULL, source text NOT NULL, source_commitment text NOT NULL,
      account_data_hash text NOT NULL, liquidity_mint text NOT NULL, market text,
      market_name text, symbol text, supply_apy double precision NOT NULL,
      borrow_apy double precision NOT NULL DEFAULT 0, utilization double precision NOT NULL DEFAULT 0,
      total_supply_usd_estimate double precision NOT NULL,
      total_borrow_usd_estimate double precision NOT NULL DEFAULT 0,
      reserve_last_update_stale boolean NOT NULL DEFAULT false,
      diff_changed boolean NOT NULL DEFAULT false, changed_fields text[] NOT NULL DEFAULT '{}',
      diff_summary text NOT NULL DEFAULT ''
    );
    CREATE TABLE kamino.reserve_current_states (
      reserve text PRIMARY KEY, state_event_id bigint NOT NULL, account_data_hash text NOT NULL,
      state_slot bigint NOT NULL, state_observed_at timestamptz NOT NULL, state_source text NOT NULL
    );
    CREATE TABLE kamino.supported_reserves (
      reserve text PRIMARY KEY, market text NOT NULL, liquidity_mint text NOT NULL,
      active boolean NOT NULL
    );
  `);

  await verify(
    "an empty feed offers no new or existing deposit target",
    async () => {
      assert.deepEqual(await eligible(), []);
      assert.deepEqual(await presence(["missing"]), []);
    }
  );

  await seed("quiet-usdc", {
    ageSeconds: 3600,
    slot: 100,
    apy: 0.05,
    stale: true,
  });
  await seed("fresh-usdt", { mint: usdt, apy: 0.03 });
  await verify(
    "a quiet confirmed reserve stays eligible while another mint advances the stream",
    async () => {
      const best = await client.getCurrentBestApyReserveByStablecoin({
        riskProfile: RiskBasket.Safe,
      });
      assert.equal(
        best.find((row) => row.stablecoin === Stablecoin.USDC)?.reserve,
        "quiet-usdc"
      );
      assert.equal(
        best.find((row) => row.stablecoin === Stablecoin.USDT)?.reserve,
        "fresh-usdt"
      );
      assert.deepEqual(
        (await presence(["quiet-usdc"])).map((row) => row.reserve),
        ["quiet-usdc"]
      );
      assert.doesNotThrow(() => JSON.stringify(best));
    }
  );

  await seed("low-liquidity", { supply: 100_000, apy: 0.49 });
  await seed("excessive-apy", { apy: 0.5 });
  await seed("negative-apy", { apy: -0.01 });
  await seed("nan-apy", { apy: Number.NaN });
  await seed("unsafe-market", {
    market: "outside-safe-universe",
    apy: 0.49,
  });
  await seed("unsupported-mint", {
    mint: "outside-earn-registry",
    apy: 0.49,
  });
  await verify(
    "liquidity, APY, Safe-market and supported-mint filters remain enforced",
    async () => {
      assert.deepEqual(
        (await eligible()).map((row) => row.reserve).sort(),
        ["fresh-usdt", "quiet-usdc"]
      );
    }
  );

  await seed("processed", { commitment: "processed", apy: 0.49 });
  await seed("backfill", { source: "api_backfill", apy: 0.49 });
  await seed("inactive", { active: false, apy: 0.49 });
  await seed("mismatched-hash", {
    pointerHash: "f".repeat(64),
    apy: 0.49,
  });
  await seed("mismatched-mint", { catalogMint: usdt, apy: 0.49 });
  await seed("mismatched-market", {
    catalogMarket: "another-market",
    apy: 0.49,
  });
  await verify(
    "unconfirmed, backfilled, inactive and identity-mismatched observations cannot become targets",
    async () => {
      assert.deepEqual(
        (await eligible()).map((row) => row.reserve).sort(),
        ["fresh-usdt", "quiet-usdc"]
      );
      assert.deepEqual(
        await presence([
          "processed",
          "backfill",
          "inactive",
          "mismatched-hash",
          "mismatched-mint",
          "mismatched-market",
          "missing",
        ]),
        []
      );
    }
  );

  await seed("startup-seed", { source: "http_snapshot", apy: 0.06 });
  await verify(
    "a confirmed startup seed is usable before the reserve's next stream update",
    async () => {
      const best = await client.getCurrentBestApyReserveByStablecoin({
        riskProfile: RiskBasket.Safe,
      });
      assert.equal(
        best.find((row) => row.stablecoin === Stablecoin.USDC)?.reserve,
        "startup-seed"
      );
    }
  );

  await verify(
    "top-up presence keeps the transaction-refresh stale bit and liquidity evidence",
    async () => {
      const rows = await presence(["quiet-usdc", "low-liquidity"]);
      assert.equal(rows.length, 2);
      assert.equal(
        rows.find((row) => row.reserve === "low-liquidity")
          ?.totalSupplyUsdEstimate,
        100_000
      );
    }
  );

  await database.exec(`UPDATE kamino.reserve_updates SET observed_at = observed_at - interval '10 minutes';
    UPDATE kamino.reserve_current_states SET state_observed_at = state_observed_at - interval '10 minutes';`);
  await verify(
    "an expired stream fails closed for both new deposits and top-ups",
    async () => {
      assert.deepEqual(await eligible(), []);
      assert.deepEqual(await presence(["quiet-usdc", "startup-seed"]), []);
    }
  );

  await seed("fresh-processed", { commitment: "processed", slot: 2000 });
  await seed("fresh-backfill", { source: "api_backfill", slot: 2001 });
  await seed("fresh-inactive", { active: false, slot: 2002 });
  await verify(
    "invalid fresh observations cannot keep an expired stream alive",
    async () => {
      assert.deepEqual(await eligible(), []);
      assert.deepEqual(await presence(["quiet-usdc"]), []);
    }
  );

  await seed("recovered-stream", { mint: usdt, slot: 3000 });
  await verify(
    "confirmed stream recovery restores quiet same-mint targets",
    async () => {
      assert.ok(
        (await eligible()).some((row) => row.reserve === "quiet-usdc")
      );
      assert.equal((await presence(["quiet-usdc"])).length, 1);
    }
  );

  await seed("future-frontier", { ageSeconds: -60, slot: 4000 });
  await verify(
    "a future-dated frontier fails closed instead of falling back to older evidence",
    async () => {
      assert.deepEqual(await eligible(), []);
      assert.deepEqual(await presence(["quiet-usdc"]), []);
    }
  );

  console.log(`\n${checks}/${checks} PostgreSQL contract checks passed.`);
} finally {
  await client.close();
  await database.close();
}
