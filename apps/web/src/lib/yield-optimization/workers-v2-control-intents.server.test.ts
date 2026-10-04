import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { YieldOptimizationClient } from "./yield-neon-client.server";

mock.module("server-only", () => ({}));

const endpoint = process.env.WORKERS_V2_APP_INTENT_TEST_DATABASE_URL;
const registeredTest = endpoint ? test : test.skip;
let connection: ReturnType<typeof postgres>;
let client: YieldOptimizationClient;
let targetId: string;
let priorFlag: string | undefined;

beforeAll(async () => {
  if (!endpoint) {
    return;
  }
  const url = new URL(endpoint);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    Number(url.port) < 1024 ||
    Number(url.port) > 65_535 ||
    url.username !== "workers_v2" ||
    url.password ||
    url.pathname !== "/workers_v2_autodeposit_intent" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Refusing unregistered Apps intent database.");
  }
  connection = postgres(endpoint, { max: 2, onnotice: () => {} });
  const [identity] = await connection`
    SELECT current_database() AS database, current_user AS role
  `;
  if (
    identity.database !== "workers_v2_autodeposit_intent" ||
    identity.role !== "workers_v2"
  ) {
    throw new Error("Apps intent fixture identity mismatch.");
  }
  // The repository consumes the same concrete Drizzle SQL implementation as
  // the runtime's explicit development PostgreSQL adapter, with owned cleanup.
  client = { db: drizzle(connection) } as unknown as YieldOptimizationClient;
  await connection`TRUNCATE loyal_yield.balance_sweep_targets RESTART IDENTITY CASCADE`;
  const [target] = await connection`
    INSERT INTO loyal_yield.balance_sweep_targets
      (cluster,settings,authority,policy_seed,policy_account,vault_index,vault_pubkey,
       wallet,wallet_usdc_ata,vault_usdc_ata,wallet_token_ata,vault_token_ata,
       token_mint,threshold,max_amount_per_period,desired_active,chain_status,
       wallet_balance_floor_raw,recurring_delegation,last_seen_slot,last_seen_signature)
    VALUES ('mainnet-beta','intent-settings','intent-wallet',7,'intent-policy',1,'intent-vault',
       'intent-wallet','intent-wallet-ata','intent-vault-ata','intent-wallet-ata',
       'intent-vault-ata','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',1,
       1000000000,true,'active',4000000,'intent-recurring',1,'intent-fixture')
    RETURNING id
  `;
  targetId = String(target.id);
  priorFlag = process.env.WORKERS_V2_APP_READ_ONLY_GETS;
  process.env.WORKERS_V2_APP_READ_ONLY_GETS = "true";
});

afterAll(async () => {
  if (!endpoint) {
    return;
  }
  if (priorFlag === undefined) {
    delete process.env.WORKERS_V2_APP_READ_ONLY_GETS;
  } else {
    process.env.WORKERS_V2_APP_READ_ONLY_GETS = priorFlag;
  }
  await connection.end();
});

registeredTest(
  "floor and pause write only desired intent and atomically enqueue revisions",
  async () => {
    const {
      updateAutodepositTargetActive,
      updateAutodepositWalletBalanceFloor,
    } = await import("./earn-autodeposit-repository.server");
    const input = {
      policyAccount: "intent-policy",
      recurringDelegation: "intent-recurring",
      settings: "intent-settings",
      vaultIndex: 1 as const,
      walletAddress: "intent-wallet",
      walletBalanceFloorRaw: BigInt(2_000_000),
    };
    const result = await updateAutodepositWalletBalanceFloor(input, { client });
    expect(result.rebaselineSweep).toEqual({
      reason: "worker_reconciliation_pending",
      status: "skipped",
    });
    await updateAutodepositWalletBalanceFloor(input, { client });
    const [floor] = await connection`
    SELECT t.desired_revision,t.applied_desired_revision,r.requested_revision,
           r.requested_generation,r.processed_generation
    FROM loyal_yield.balance_sweep_targets t
    JOIN loyal_yield.autodeposit_desired_control_requests r ON r.target_id=t.id
    WHERE t.id=${targetId}
  `;
    expect(String(floor.desired_revision)).toBe("2");
    expect(String(floor.requested_revision)).toBe("2");
    expect(String(floor.requested_generation)).toBe("2");
    expect(String(floor.applied_desired_revision)).toBe("0");
    expect(String(floor.processed_generation)).toBe("0");
    await updateAutodepositTargetActive(
      { ...input, active: false },
      { client },
    );
    const [paused] = await connection`
    SELECT desired_active,desired_revision FROM loyal_yield.balance_sweep_targets WHERE id=${targetId}
  `;
    expect(paused.desired_active).toBe(false);
    expect(String(paused.desired_revision)).toBe("3");
    for (const table of [
      "balance_sweep_wallet_balance_events",
      "balance_sweep_surplus_lots",
      "balance_sweep_scheduled_slots",
      "balance_sweep_transaction_attempts",
    ]) {
      const [count] = await connection.unsafe(
        `SELECT count(*)::integer AS count FROM loyal_yield.${table}`,
      );
      expect(count.count).toBe(0);
    }
    await expect(
      updateAutodepositWalletBalanceFloor(
        { ...input, walletAddress: "different-wallet" },
        { client },
      ),
    ).rejects.toThrow("does not match the wallet");
    const [unchanged] = await connection`
    SELECT desired_revision FROM loyal_yield.balance_sweep_targets WHERE id=${targetId}
  `;
    expect(String(unchanged.desired_revision)).toBe("3");
  },
);
