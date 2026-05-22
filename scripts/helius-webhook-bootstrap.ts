#!/usr/bin/env -S bun --conditions=react-server
/**
 * One-shot operator script to register the initial Helius webhook(s) for
 * every currently-registered wallet.
 *
 * Usage:
 *   bun run scripts/helius-webhook-bootstrap.ts --dry-run   (default)
 *   bun run scripts/helius-webhook-bootstrap.ts --apply
 *
 * Idempotency: refuses to run if `helius_webhooks` already has a
 * non-archived row. Bootstrap is meant for a clean slate; the resync
 * cron handles delta updates.
 *
 * Per CLAUDE.md webhook reliability guardrails: writes are `critical`,
 * we fail loudly on any DB/Helius error and leave half-state for the
 * operator to investigate. Uses `db.batch([...])` for Neon HTTP atomic
 * multi-step writes (Neon HTTP does not support `db.transaction()`).
 *
 * The shebang sets `--conditions=react-server` so Bun resolves the
 * `server-only` marker package's empty export — `aggregateAddressesForWallet`
 * and `createHeliusWebhook` both import "server-only" because they are
 * normally consumed by Next.js server code.
 */

import { createNeonDb } from "@loyal-labs/db-adapter-neon";
import * as schema from "@loyal-labs/db-core/schema";
import {
  heliusWebhookAddresses,
  heliusWebhooks,
  pushTokens,
} from "@loyal-labs/db-core/schema";
import { Connection } from "@solana/web3.js";
import { isNotNull, isNull } from "drizzle-orm";

import { aggregateAddressesForWallet } from "../app/src/features/push-incoming-transfers/server/address-aggregator";
import { createHeliusWebhook } from "../app/src/features/push-incoming-transfers/server/helius-client";

// Helius advertises a 100k accountAddresses cap per webhook. We keep
// 50% headroom for ATA churn and accidental duplicates.
const SHARD_LIMIT = 50_000;
// ATA aggregation hits Solana RPC; throttle a touch to stay under
// Helius free-tier ~10 req/s when iterating many wallets.
const PER_WALLET_THROTTLE_MS = 200;
const THROTTLE_AFTER_WALLET_COUNT = 100;

type Mode = "dry-run" | "apply";

type ParsedArgs = {
  mode: Mode;
  modeExplicit: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let mode: Mode = "dry-run";
  let modeExplicit = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      mode = "apply";
      modeExplicit = true;
    } else if (arg === "--dry-run") {
      mode = "dry-run";
      modeExplicit = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { mode, modeExplicit };
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run scripts/helius-webhook-bootstrap.ts [--dry-run|--apply]

  --dry-run   (default) Print plan without calling Helius or writing DB.
  --apply     Actually create webhooks and persist rows.

Required env (all modes):
  DATABASE_URL

Required env (--apply only):
  HELIUS_API_KEY
  HELIUS_WEBHOOK_SECRET
  HELIUS_WEBHOOK_URL

Optional:
  HELIUS_RPC_URL_FOR_BOOTSTRAP  (defaults to https://api.mainnet-beta.solana.com)
`);
  process.exit(0);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const { mode, modeExplicit } = parseArgs(process.argv.slice(2));

  if (!modeExplicit) {
    console.log(
      "Notice: no mode flag supplied; defaulting to --dry-run. Pass --apply to execute."
    );
  }

  // Required env: DATABASE_URL always.
  const databaseUrl = requireEnv("DATABASE_URL");

  // Helius env vars: required only for --apply.
  let heliusApiKey = "";
  let heliusWebhookSecret = "";
  let heliusWebhookUrl = "";
  if (mode === "apply") {
    heliusApiKey = requireEnv("HELIUS_API_KEY");
    heliusWebhookSecret = requireEnv("HELIUS_WEBHOOK_SECRET");
    heliusWebhookUrl = requireEnv("HELIUS_WEBHOOK_URL");
  } else {
    const missing = [
      "HELIUS_API_KEY",
      "HELIUS_WEBHOOK_SECRET",
      "HELIUS_WEBHOOK_URL",
    ].filter((name) => !process.env[name]);
    if (missing.length > 0) {
      console.log(
        `Note: ${missing.join(", ")} not set (only needed with --apply).`
      );
    }
  }

  const rpcUrl =
    process.env.HELIUS_RPC_URL_FOR_BOOTSTRAP ??
    "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const db = createNeonDb({ databaseUrl, schema });

  // Idempotency guard. Bootstrap only runs on a clean slate.
  const existing = await db
    .select({ id: heliusWebhooks.id })
    .from(heliusWebhooks)
    .where(isNull(heliusWebhooks.archivedAt))
    .limit(1);
  if (existing.length > 0) {
    console.error(
      "Existing non-archived Helius webhooks found. Use the resync cron, or archive them first."
    );
    process.exit(1);
  }

  // Distinct registered wallets from push_tokens.
  const walletRows = await db
    .selectDistinct({ walletPublicKey: pushTokens.walletPublicKey })
    .from(pushTokens)
    .where(isNotNull(pushTokens.walletPublicKey));
  const wallets = walletRows
    .map((row) => row.walletPublicKey)
    .filter((value): value is string => value !== null && value.length > 0);

  console.log(
    `Helius webhook bootstrap [${mode === "apply" ? "APPLY" : "DRY RUN"}]`
  );
  console.log(`  Wallets registered:    ${wallets.length}`);

  if (wallets.length === 0) {
    console.log("  Addresses aggregated:  0");
    console.log("  Shards (<=50,000 ea):  0");
    console.log("  Webhooks to create:    0");
    if (mode === "dry-run") {
      console.log(
        "\n[DRY RUN] Nothing to do (no registered wallets). Run again with --apply to execute."
      );
    } else {
      console.log(
        "\n[APPLY] Nothing to do (no registered wallets); no webhooks created."
      );
    }
    process.exit(0);
  }

  // Aggregate addresses for every wallet. Throttle once we exceed
  // THROTTLE_AFTER_WALLET_COUNT to stay polite to Solana RPC.
  const aggregated: {
    address: string;
    kind: "wallet" | "ata";
    walletPublicKey: string;
  }[] = [];
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const rows = await aggregateAddressesForWallet(connection, wallet);
    aggregated.push(...rows);
    if (
      wallets.length > THROTTLE_AFTER_WALLET_COUNT &&
      i + 1 < wallets.length
    ) {
      await sleep(PER_WALLET_THROTTLE_MS);
    }
  }

  // Defensive dedupe in case two wallets happen to share an ATA owner
  // (shouldn't happen for SPL ATAs, but the `address` column has a
  // unique constraint in `helius_webhook_addresses`).
  const dedupedByAddress = new Map<string, (typeof aggregated)[number]>();
  for (const row of aggregated) {
    if (!dedupedByAddress.has(row.address)) {
      dedupedByAddress.set(row.address, row);
    }
  }
  const allAddresses = [...dedupedByAddress.values()];

  const shards = chunk(allAddresses, SHARD_LIMIT);

  console.log(`  Addresses aggregated:  ${allAddresses.length}`);
  console.log(
    `  Shards (<=${SHARD_LIMIT.toLocaleString()} ea):  ${shards.length}`
  );
  console.log(`  Webhooks to create:    ${shards.length}`);

  if (mode === "dry-run") {
    console.log(
      "\n[DRY RUN] No changes made. Run again with --apply to execute."
    );
    process.exit(0);
  }

  // --apply path. For each shard: call Helius, then atomically insert
  // the helius_webhooks row + all helius_webhook_addresses rows via
  // db.batch (Neon HTTP does NOT support db.transaction; batch is the
  // closest atomic-ish primitive per CLAUDE.md). Failures bubble up
  // and leave half-state for the operator to investigate, as required
  // by webhook reliability guardrails.
  const ADDRESS_INSERT_CHUNK = 5_000;
  for (let shardIdx = 0; shardIdx < shards.length; shardIdx++) {
    const shard = shards[shardIdx];
    const addressList = shard.map((row) => row.address);

    const { webhookId } = await createHeliusWebhook({
      accountAddresses: addressList,
      apiKey: heliusApiKey,
      authHeader: heliusWebhookSecret,
      webhookUrl: heliusWebhookUrl,
    });

    // Insert the webhook row first so we can use its UUID as FK on
    // address rows. We still batch this single insert through db.batch
    // for symmetry with the rest of the codebase's atomic-write idiom.
    const [webhookRows] = await db.batch([
      db
        .insert(heliusWebhooks)
        .values({
          heliusWebhookId: webhookId,
          webhookUrl: heliusWebhookUrl,
          addressCount: shard.length,
        })
        .returning({ id: heliusWebhooks.id }),
    ]);
    const inserted = webhookRows[0];
    if (!inserted?.id) {
      throw new Error(
        `Failed to insert helius_webhooks row for ${webhookId}; investigate manually before retrying.`
      );
    }

    const addressRows = shard.map((row) => ({
      webhookId: inserted.id,
      address: row.address,
      walletPublicKey: row.walletPublicKey,
      kind: row.kind,
    }));

    // Drizzle/neon-http has a practical per-statement size limit, so
    // chunk large shards at 5000 rows per INSERT and batch them.
    const addressInsertChunks = chunk(addressRows, ADDRESS_INSERT_CHUNK);
    if (addressInsertChunks.length > 0) {
      const [first, ...rest] = addressInsertChunks.map((rows) =>
        db.insert(heliusWebhookAddresses).values(rows)
      );
      await db.batch([first, ...rest]);
    }

    console.log(
      `[APPLY] Created webhook ${webhookId} with ${shard.length} addresses.`
    );
  }

  console.log(
    `\n[APPLY] Bootstrap complete: ${shards.length} webhook(s) covering ${allAddresses.length} addresses across ${wallets.length} wallets.`
  );
  process.exit(0);
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("Helius webhook bootstrap failed:", message);
  process.exit(1);
});
