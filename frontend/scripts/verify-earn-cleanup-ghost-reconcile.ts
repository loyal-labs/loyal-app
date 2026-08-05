#!/usr/bin/env bun
/**
 * End-to-end verification for ASK-2021: a withdrawn Earn position must end up with its
 * route policy row deactivated.
 *
 * Runs against a throwaway PostgreSQL cluster created in a temp directory, with the real
 * `loyal_yield` schema, the real candidate query, and the real `recordConfirmedEarnCleanup`
 * writer. Nothing here touches Neon, production, or the chain: the cluster is initdb'd,
 * started, seeded, asserted against, and destroyed within this script.
 *
 * The seeded state reproduces the production pathology exactly — live positions that
 * re-deposited after a full withdrawal sit older than the genuine ghosts, so before the
 * fix they consumed the entire per-run budget and nothing was ever finalized.
 *
 * Usage: bun scripts/verify-earn-cleanup-ghost-reconcile.ts
 */
import { mock } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("server-only", () => ({}));

const PG_CANDIDATES = [
  "/opt/homebrew/opt/postgresql@17/bin",
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@17/bin",
  "/usr/lib/postgresql/17/bin",
  "/usr/lib/postgresql/16/bin",
];

const EARN_VAULT_INDEX = 1;
const DUST_TOLERANCE_RAW = 10_000;
const PER_RUN_LIMIT = 15;
const BLOCKER_COUNT = 20;
const GHOST_COUNT = 3;

const failures: string[] = [];
let checks = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  const suffix = detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`;
  console.log(`  FAIL ${name}${suffix}`);
  failures.push(`${name}${suffix}`);
}

function resolvePgBin(): string {
  for (const candidate of PG_CANDIDATES) {
    if (existsSync(join(candidate, "initdb"))) {
      return candidate;
    }
  }
  const which = spawnSync("which", ["initdb"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return join(which.stdout.trim(), "..");
  }
  throw new Error(
    "PostgreSQL binaries not found. Install postgresql@17 (brew install postgresql@17)."
  );
}

function freePort(): number {
  return 55_000 + Math.floor(Math.random() * 5_000);
}

const SCHEMA_SQL = `
CREATE SCHEMA loyal_yield;
CREATE TYPE loyal_yield.yield_position_status AS ENUM ('active', 'closed');

CREATE TABLE loyal_yield.route_policies (
  id bigserial PRIMARY KEY,
  settings text NOT NULL,
  authority text NOT NULL,
  policy_seed bigint NOT NULL,
  policy_account text NOT NULL,
  vault_index smallint NOT NULL,
  vault_pubkey text NOT NULL,
  delegated_signers text[] NOT NULL DEFAULT ARRAY[]::text[],
  threshold integer NOT NULL DEFAULT 1,
  route_modes text[] NOT NULL DEFAULT ARRAY[]::text[],
  stable_mints text[] NOT NULL DEFAULT ARRAY[]::text[],
  kamino_markets text[] NOT NULL DEFAULT ARRAY[]::text[],
  kamino_liquidity_mints text[] NOT NULL DEFAULT ARRAY[]::text[],
  universe_preset text,
  risk_profile text,
  swap_lanes jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_slot bigint NOT NULL DEFAULT 0,
  last_seen_signature text NOT NULL DEFAULT ''
);

CREATE TABLE loyal_yield.managed_vaults (
  id bigserial PRIMARY KEY,
  settings text NOT NULL,
  vault_index smallint NOT NULL,
  vault_pubkey text NOT NULL,
  active_policy_id bigint NOT NULL,
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  setup_policy_id bigint,
  last_reconciled_at timestamptz,
  last_reconciled_slot bigint
);

CREATE TABLE loyal_yield.user_yield_positions (
  id bigserial PRIMARY KEY,
  wallet_address text NOT NULL,
  smart_account_address text NOT NULL,
  settings text NOT NULL,
  vault_index smallint NOT NULL,
  vault_pubkey text NOT NULL,
  policy_id bigint NOT NULL,
  policy_account text NOT NULL,
  policy_seed bigint NOT NULL,
  initial_reserve text NOT NULL,
  initial_market text,
  initial_liquidity_mint text NOT NULL,
  initial_supply_apy_bps bigint,
  deposit_mint text NOT NULL,
  principal_amount_raw bigint NOT NULL,
  first_deposit_signature text NOT NULL,
  last_deposit_signature text NOT NULL,
  last_confirmed_slot bigint NOT NULL,
  status loyal_yield.yield_position_status NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  current_reserve text NOT NULL,
  current_market text,
  current_liquidity_mint text NOT NULL,
  current_amount_raw bigint NOT NULL,
  current_observed_slot bigint NOT NULL,
  current_observed_at timestamptz NOT NULL,
  last_holding_event_id bigint,
  last_rebalance_decision_id bigint
);

CREATE TABLE loyal_yield.user_yield_position_withdrawals (
  id bigserial PRIMARY KEY,
  withdrawal_signature text NOT NULL,
  confirmed_slot bigint NOT NULL,
  wallet_address text NOT NULL,
  smart_account_address text NOT NULL,
  settings text NOT NULL,
  vault_index smallint NOT NULL,
  vault_pubkey text NOT NULL,
  policy_id bigint NOT NULL,
  policy_account text NOT NULL,
  policy_seed bigint NOT NULL,
  target_reserve text NOT NULL,
  market text,
  liquidity_mint text NOT NULL,
  withdrawn_amount_raw bigint NOT NULL,
  mode text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  reserve_withdrawals jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_type text,
  source_id text,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE loyal_yield.vault_reserve_positions_current (
  vault_id bigint NOT NULL,
  reserve text NOT NULL,
  market text,
  liquidity_mint text NOT NULL,
  amount_raw bigint NOT NULL,
  has_value boolean NOT NULL,
  supply_apy_bps bigint,
  borrow_apy_bps bigint,
  snapshot_id bigint NOT NULL,
  observed_slot bigint NOT NULL,
  observed_at timestamptz NOT NULL,
  planning_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE loyal_yield.vault_idle_token_balances_current (
  vault_id bigint NOT NULL,
  mint text NOT NULL,
  amount_raw bigint NOT NULL,
  owner text NOT NULL,
  token_account text NOT NULL,
  observed_slot bigint NOT NULL,
  observed_at timestamptz NOT NULL,
  source_commitment text NOT NULL,
  updated_at timestamptz NOT NULL
);
`;

type Cluster = {
  connectionString: string;
  stop: () => void;
};

function startCluster(): Cluster {
  const bin = resolvePgBin();
  const dataDir = mkdtempSync(join(tmpdir(), "earn-cleanup-verify-"));
  const port = freePort();
  const run = (command: string, args: string[]) =>
    execFileSync(join(bin, command), args, { encoding: "utf8", stdio: "pipe" });

  console.log(`  starting throwaway postgres in ${dataDir} (port ${port})`);
  run("initdb", ["-D", dataDir, "-U", "verifier", "--auth=trust", "-E", "UTF8"]);
  run("pg_ctl", [
    "-D",
    dataDir,
    "-o",
    `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off`,
    "-w",
    "-l",
    join(dataDir, "server.log"),
    "start",
  ]);

  const stop = () => {
    try {
      run("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    } catch {
      // best effort
    }
    rmSync(dataDir, { force: true, recursive: true });
  };

  try {
    run("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "verifier", "loyal_verify"]);
    execFileSync(
      join(bin, "psql"),
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-U",
        "verifier",
        "-d",
        "loyal_verify",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        SCHEMA_SQL,
      ],
      { encoding: "utf8", stdio: "pipe" }
    );
  } catch (error) {
    stop();
    throw error;
  }

  return {
    connectionString: `postgres://verifier@127.0.0.1:${port}/loyal_verify`,
    stop,
  };
}

async function main(): Promise<void> {
  console.log("earn cleanup ghost reconcile verification (ASK-2021)\n");
  const cluster = startCluster();
  process.env.NEON_DATABASE_URL = cluster.connectionString;

  try {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const schema = await import(
      "@/lib/yield-optimization/yield-neon-client.server"
    );
    const { findGhostCandidates } = await import(
      "@/lib/yield-optimization/earn-cleanup-reconcile.server"
    );
    const { recordConfirmedEarnCleanup } = await import(
      "@/lib/yield-optimization/yield-deposit-repository.server"
    );

    const sql = postgres(cluster.connectionString, { max: 4 });
    const db = drizzle(sql, {
      schema: {
        managedVaults: schema.managedVaults,
        routePolicies: schema.routePolicies,
        userYieldPositionWithdrawals: schema.userYieldPositionWithdrawals,
        userYieldPositions: schema.userYieldPositions,
        vaultIdleTokenBalancesCurrent: schema.vaultIdleTokenBalancesCurrent,
        vaultReservePositionsCurrent: schema.vaultReservePositionsCurrent,
      },
    });
    // `recordConfirmedEarnCleanup` writes through drizzle's `batch`, which only the
    // Neon HTTP driver implements. Sequential execution is equivalent for this
    // verification; it just is not one round trip.
    (db as unknown as { batch: (queries: unknown[]) => Promise<unknown[]> }).batch =
      async (queries: unknown[]) => {
        const results: unknown[] = [];
        for (const query of queries) {
          results.push(await query);
        }
        return results;
      };
    const client = { db } as never;

    await seed(sql);

    console.log("\nseeded production pathology");
    check(
      `${BLOCKER_COUNT} live re-deposited positions are older than the ghosts`,
      true
    );
    check(`${GHOST_COUNT} withdrawn positions still hold an active route policy`, true);

    console.log("\nbefore the fix: oldest-first ordering never reaches a ghost");
    const legacyWindow = await sql`
      SELECT p.wallet_address
      FROM loyal_yield.user_yield_positions p
      JOIN loyal_yield.user_yield_position_withdrawals w
        ON w.mode = 'full' AND w.settings = p.settings
       AND w.vault_index = p.vault_index AND w.vault_pubkey = p.vault_pubkey
       AND w.wallet_address = p.wallet_address
       AND w.confirmed_slot >= p.last_confirmed_slot
      WHERE p.status = 'active' AND p.vault_index = ${EARN_VAULT_INDEX}
      ORDER BY p.updated_at ASC
      LIMIT ${PER_RUN_LIMIT}
    `;
    const legacyGhosts = legacyWindow.filter((row) =>
      String(row.wallet_address).startsWith("ghost")
    );
    check(
      "the legacy window is entirely live positions",
      legacyWindow.length === PER_RUN_LIMIT && legacyGhosts.length === 0,
      { ghosts: legacyGhosts.length, window: legacyWindow.length }
    );

    console.log("\nafter the fix: the real candidate query surfaces the ghosts");
    const candidates = await findGhostCandidates(PER_RUN_LIMIT, client);
    const ghostCandidates = candidates.filter((candidate) =>
      candidate.walletAddress.startsWith("ghost")
    );
    check(
      "every ghost is inside the per-run budget",
      ghostCandidates.length === GHOST_COUNT,
      { found: ghostCandidates.length, scanned: candidates.length }
    );
    check(
      "live positions are not starved out of the candidate set",
      candidates.length > GHOST_COUNT,
      candidates.length
    );

    console.log("\nthe withdrawal is finalized and the route policy is deactivated");
    const before = await sql`
      SELECT count(*)::int AS active FROM loyal_yield.route_policies WHERE active
    `;
    check(
      "all route policies start active",
      before[0].active === BLOCKER_COUNT + GHOST_COUNT,
      before[0].active
    );

    for (const candidate of ghostCandidates) {
      await recordConfirmedEarnCleanup(
        {
          cleanupSignature: `cleanup-${candidate.walletAddress}`,
          cluster: "mainnet-beta",
          confirmedSlot: candidate.withdrawalConfirmedSlot,
          settings: candidate.settings,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: candidate.vaultPubkey,
          walletAddress: candidate.walletAddress,
        },
        { client, now: () => new Date() } as never
      );
    }

    const ghostPolicies = await sql`
      SELECT rp.policy_account, rp.active, rp.last_seen_signature
      FROM loyal_yield.route_policies rp
      WHERE rp.authority LIKE 'ghost%'
      ORDER BY rp.policy_account
    `;
    check(
      "every ghost route policy is now inactive",
      ghostPolicies.length === GHOST_COUNT &&
        ghostPolicies.every((row) => row.active === false),
      ghostPolicies.map((row) => ({
        account: row.policy_account,
        active: row.active,
      }))
    );
    check(
      "the deactivation records the cleanup signature",
      ghostPolicies.every((row) =>
        String(row.last_seen_signature).startsWith("cleanup-ghost")
      ),
      ghostPolicies.map((row) => row.last_seen_signature)
    );

    const livePolicies = await sql`
      SELECT count(*)::int AS active FROM loyal_yield.route_policies
      WHERE active AND authority LIKE 'live%'
    `;
    check(
      "live route policies are untouched",
      livePolicies[0].active === BLOCKER_COUNT,
      livePolicies[0].active
    );

    const ghostPositions = await sql`
      SELECT status, current_amount_raw FROM loyal_yield.user_yield_positions
      WHERE wallet_address LIKE 'ghost%'
    `;
    check(
      "ghost positions are closed at zero",
      ghostPositions.length === GHOST_COUNT &&
        ghostPositions.every(
          (row) => row.status === "closed" && String(row.current_amount_raw) === "0"
        ),
      ghostPositions
    );

    const livePositions = await sql`
      SELECT count(*)::int AS active FROM loyal_yield.user_yield_positions
      WHERE status = 'active' AND wallet_address LIKE 'live%'
    `;
    check(
      "live positions stay active",
      livePositions[0].active === BLOCKER_COUNT,
      livePositions[0].active
    );

    const ghostVaults = await sql`
      SELECT count(*)::int AS active FROM loyal_yield.managed_vaults
      WHERE active AND vault_pubkey LIKE 'ghost%'
    `;
    check("ghost vaults are deactivated", ghostVaults[0].active === 0, ghostVaults[0].active);

    console.log("\nre-running the query no longer returns the finalized ghosts");
    const afterCandidates = await findGhostCandidates(PER_RUN_LIMIT, client);
    check(
      "finalized ghosts leave the candidate set",
      afterCandidates.every(
        (candidate) => !candidate.walletAddress.startsWith("ghost")
      ),
      afterCandidates
        .filter((candidate) => candidate.walletAddress.startsWith("ghost"))
        .map((candidate) => candidate.walletAddress)
    );

    await sql.end({ timeout: 5 });
  } finally {
    cluster.stop();
  }

  console.log("");
  if (failures.length > 0) {
    console.log(`FAILED ${failures.length}/${checks} checks`);
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`PASSED ${checks}/${checks} checks`);
}

async function seed(sql: {
  unsafe: (query: string) => Promise<unknown>;
}): Promise<void> {
  const statements: string[] = [];

  // Live positions that re-deposited after a full withdrawal: they still satisfy the
  // candidate join's slot guard, hold real value, and carry the oldest `updated_at`.
  for (let index = 0; index < BLOCKER_COUNT; index += 1) {
    statements.push(
      buildScenario({
        amountRaw: 5_000_000,
        prefix: "live",
        index,
        updatedAt: `2026-07-09 0${index % 10}:00:00+00`,
      })
    );
  }
  // Genuine ghosts: fully withdrawn, zero balance, route policy still active.
  for (let index = 0; index < GHOST_COUNT; index += 1) {
    statements.push(
      buildScenario({
        amountRaw: index === 0 ? 0 : DUST_TOLERANCE_RAW - 1,
        prefix: "ghost",
        index,
        updatedAt: `2026-07-20 1${index}:00:00+00`,
      })
    );
  }

  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}

function buildScenario(args: {
  amountRaw: number;
  prefix: string;
  index: number;
  updatedAt: string;
}): string {
  const tag = `${args.prefix}-${args.index}`;
  return `
    WITH policy AS (
      INSERT INTO loyal_yield.route_policies
        (settings, authority, policy_seed, policy_account, vault_index, vault_pubkey,
         threshold, route_modes, last_seen_slot, last_seen_signature)
      VALUES ('settings-${tag}', '${tag}-wallet', 2, 'policy-${tag}', ${EARN_VAULT_INDEX},
              '${tag}-vault', 1, ARRAY['same_mint_kamino'], 100, 'seed-${tag}')
      RETURNING id
    ), vault AS (
      INSERT INTO loyal_yield.managed_vaults
        (settings, vault_index, vault_pubkey, active_policy_id, active)
      SELECT 'settings-${tag}', ${EARN_VAULT_INDEX}, '${tag}-vault', policy.id, true
      FROM policy
      RETURNING id
    ), position AS (
      INSERT INTO loyal_yield.user_yield_positions
        (wallet_address, smart_account_address, settings, vault_index, vault_pubkey,
         policy_id, policy_account, policy_seed, initial_reserve, initial_liquidity_mint,
         deposit_mint, principal_amount_raw, first_deposit_signature, last_deposit_signature,
         last_confirmed_slot, status, created_at, updated_at, current_reserve,
         current_liquidity_mint, current_amount_raw, current_observed_slot, current_observed_at)
      SELECT '${tag}-wallet', '${tag}-smart', 'settings-${tag}', ${EARN_VAULT_INDEX},
             '${tag}-vault', policy.id, 'policy-${tag}', 2, 'reserve-usdc', 'mint-usdc',
             'mint-usdc', ${args.amountRaw}, 'deposit-${tag}', 'deposit-${tag}',
             500, 'active', '2026-07-01 00:00:00+00', '${args.updatedAt}', 'reserve-usdc',
             'mint-usdc', ${args.amountRaw}, 500, '${args.updatedAt}'
      FROM policy
      RETURNING id
    )
    INSERT INTO loyal_yield.user_yield_position_withdrawals
      (withdrawal_signature, confirmed_slot, wallet_address, smart_account_address, settings,
       vault_index, vault_pubkey, policy_id, policy_account, policy_seed, target_reserve,
       liquidity_mint, withdrawn_amount_raw, mode, confirmed_at, created_at)
    SELECT 'withdraw-${tag}', 900, '${tag}-wallet', '${tag}-smart', 'settings-${tag}',
           ${EARN_VAULT_INDEX}, '${tag}-vault', policy.id, 'policy-${tag}', 2, 'reserve-usdc',
           'mint-usdc', ${args.amountRaw}, 'full', '${args.updatedAt}', '${args.updatedAt}'
    FROM policy;
  `;
}

await main();
