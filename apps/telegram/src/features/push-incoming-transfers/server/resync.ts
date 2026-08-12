import "server-only";

import {
  heliusWebhookAddresses,
  heliusWebhooks,
  pushTokens,
} from "@loyal-labs/db-core/schema";
import { Connection } from "@solana/web3.js";
import { eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { serverEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";

import { aggregateAddressesForWallet } from "./address-aggregator";
import { MAX_ADDRESSES_PER_WEBHOOK } from "./constants";
import {
  createHeliusWebhook as defaultCreateHeliusWebhook,
  patchHeliusWebhookAddresses as defaultPatchHeliusWebhookAddresses,
} from "./helius-client";

export type DesiredAddress = {
  address: string;
  walletPublicKey: string;
  kind: "wallet" | "ata";
};

export type CurrentAddress = DesiredAddress & {
  webhookId: string; // the DB uuid of the helius_webhooks row
};

export type WebhookCapacity = {
  webhookId: string; // DB uuid
  heliusWebhookId: string;
  currentAddressCount: number;
};

export type ResyncDiff = {
  toAdd: Array<DesiredAddress & { assignedWebhookId: string }>;
  toRemove: CurrentAddress[];
  webhooksToCreate: Array<{ addresses: DesiredAddress[] }>;
};

export type HeliusResyncStats = {
  walletsScanned: number;
  walletsErrored: number;
  addressesAdded: number;
  addressesRemoved: number;
  webhooksPatched: number;
  webhooksCreated: number;
  skipped: boolean;
};

/**
 * Pure: given the desired address set, the current address set, and the
 * non-archived webhooks' current capacities, compute the diff plus
 * assignments (which existing webhook each new address goes into,
 * spilling into new webhooks when all full).
 *
 * Match by `address` only — `address` is globally unique across the
 * `helius_webhook_addresses` table.
 *
 * Output is deterministic: `toAdd`, `toRemove`, and `webhooksToCreate`
 * are all sorted by `address` lexicographically so callers and tests
 * see stable results.
 */
export function computeResyncDiff(args: {
  desired: DesiredAddress[];
  current: CurrentAddress[];
  webhooks: WebhookCapacity[];
  maxAddressesPerWebhook: number;
}): ResyncDiff {
  const { current, desired, maxAddressesPerWebhook, webhooks } = args;

  if (maxAddressesPerWebhook <= 0) {
    throw new Error("maxAddressesPerWebhook must be > 0");
  }

  // Deduplicate desired by address (defensive — caller is expected to
  // pre-dedupe, but two wallets technically owning the same ATA must
  // not double-insert into the unique-by-address table).
  const desiredByAddress = new Map<string, DesiredAddress>();
  for (const row of desired) {
    if (!desiredByAddress.has(row.address)) {
      desiredByAddress.set(row.address, row);
    }
  }

  const currentByAddress = new Map<string, CurrentAddress>();
  for (const row of current) {
    if (!currentByAddress.has(row.address)) {
      currentByAddress.set(row.address, row);
    }
  }

  // toRemove: in current, not in desired.
  const toRemove: CurrentAddress[] = [];
  for (const [address, row] of currentByAddress) {
    if (!desiredByAddress.has(address)) {
      toRemove.push(row);
    }
  }
  toRemove.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));

  // newAddresses: in desired, not in current. Sort by address for
  // deterministic assignment.
  const newAddresses: DesiredAddress[] = [];
  for (const [address, row] of desiredByAddress) {
    if (!currentByAddress.has(address)) {
      newAddresses.push(row);
    }
  }
  newAddresses.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));

  // Compute working capacities — but webhooks also lose addresses via
  // toRemove, freeing capacity. Build remainingCapacity using current
  // count minus removes that target each webhook.
  const removesPerWebhook = new Map<string, number>();
  for (const r of toRemove) {
    removesPerWebhook.set(
      r.webhookId,
      (removesPerWebhook.get(r.webhookId) ?? 0) + 1,
    );
  }

  type Slot = {
    webhookId: string;
    remaining: number;
  };
  const slots: Slot[] = webhooks.map((w) => ({
    remaining:
      maxAddressesPerWebhook -
      w.currentAddressCount +
      (removesPerWebhook.get(w.webhookId) ?? 0),
    webhookId: w.webhookId,
  }));

  // Greedy: for each new address, pick the slot with the most remaining
  // capacity. When all are full, accumulate into shards for new
  // webhooks. Resolve ties deterministically by webhookId.
  const toAdd: ResyncDiff["toAdd"] = [];
  const overflow: DesiredAddress[] = [];

  for (const row of newAddresses) {
    let best: Slot | null = null;
    for (const slot of slots) {
      if (slot.remaining <= 0) continue;
      if (!best) {
        best = slot;
        continue;
      }
      if (slot.remaining > best.remaining) {
        best = slot;
        continue;
      }
      if (slot.remaining === best.remaining && slot.webhookId < best.webhookId) {
        best = slot;
      }
    }
    if (best && best.remaining > 0) {
      toAdd.push({ ...row, assignedWebhookId: best.webhookId });
      best.remaining -= 1;
    } else {
      overflow.push(row);
    }
  }

  // Shard overflow into webhooks-to-create chunks of
  // maxAddressesPerWebhook. Already sorted by address.
  const webhooksToCreate: ResyncDiff["webhooksToCreate"] = [];
  for (let i = 0; i < overflow.length; i += maxAddressesPerWebhook) {
    const chunk = overflow.slice(i, i + maxAddressesPerWebhook);
    webhooksToCreate.push({ addresses: chunk });
  }

  return { toAdd, toRemove, webhooksToCreate };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

type ResyncDeps = {
  aggregateAddressesForWallet: typeof aggregateAddressesForWallet;
  createHeliusWebhook: typeof defaultCreateHeliusWebhook;
  patchHeliusWebhookAddresses: typeof defaultPatchHeliusWebhookAddresses;
  getConnection: () => Connection;
  apiKey: string;
  webhookSecret: string;
  webhookUrl: string;
};

function buildDefaultDeps(): ResyncDeps {
  return {
    aggregateAddressesForWallet,
    apiKey: serverEnv.heliusApiKey,
    createHeliusWebhook: defaultCreateHeliusWebhook,
    getConnection: () =>
      new Connection(serverEnv.privateMainnetRpcUrl, {
        commitment: "confirmed",
      }),
    patchHeliusWebhookAddresses: defaultPatchHeliusWebhookAddresses,
    webhookSecret: serverEnv.heliusWebhookSecret,
    webhookUrl: serverEnv.heliusWebhookUrl,
  };
}

export async function runHeliusWebhookResync(
  depsOverride?: Partial<ResyncDeps>,
): Promise<HeliusResyncStats> {
  const deps: ResyncDeps = { ...buildDefaultDeps(), ...depsOverride };
  const db = getDatabase();

  // 1. All registered wallets.
  const walletRows = await db
    .selectDistinct({ walletPublicKey: pushTokens.walletPublicKey })
    .from(pushTokens)
    .where(isNotNull(pushTokens.walletPublicKey));
  const wallets = walletRows
    .map((row) => row.walletPublicKey)
    .filter((value): value is string => value !== null && value.length > 0);

  // 2. Aggregate addresses per wallet, logging + counting per-wallet
  //    failures so a single broken wallet doesn't poison the whole run.
  const connection = deps.getConnection();
  const desired: DesiredAddress[] = [];
  let walletsErrored = 0;
  for (const wallet of wallets) {
    try {
      const rows = await deps.aggregateAddressesForWallet(connection, wallet);
      for (const row of rows) {
        desired.push({
          address: row.address,
          kind: row.kind,
          walletPublicKey: row.walletPublicKey,
        });
      }
    } catch (err) {
      walletsErrored += 1;
      console.error(
        "[cron/helius-webhook-resync] aggregate failed for wallet",
        {
          errorMessage: err instanceof Error ? err.message : String(err),
          errorName: err instanceof Error ? err.name : "Unknown",
          walletPublicKey: wallet,
        },
      );
    }
  }

  // 3. Current address set.
  const currentRows = await db
    .select({
      address: heliusWebhookAddresses.address,
      kind: heliusWebhookAddresses.kind,
      walletPublicKey: heliusWebhookAddresses.walletPublicKey,
      webhookId: heliusWebhookAddresses.webhookId,
    })
    .from(heliusWebhookAddresses);
  const current: CurrentAddress[] = currentRows.map((row) => ({
    address: row.address,
    kind: row.kind,
    walletPublicKey: row.walletPublicKey,
    webhookId: row.webhookId,
  }));

  // 4. Non-archived webhook capacities.
  const webhookRows = await db
    .select({
      addressCount: heliusWebhooks.addressCount,
      heliusWebhookId: heliusWebhooks.heliusWebhookId,
      id: heliusWebhooks.id,
    })
    .from(heliusWebhooks)
    .where(isNull(heliusWebhooks.archivedAt));
  const webhooks: WebhookCapacity[] = webhookRows.map((row) => ({
    currentAddressCount: row.addressCount,
    heliusWebhookId: row.heliusWebhookId,
    webhookId: row.id,
  }));

  // 5. Diff.
  const diff = computeResyncDiff({
    current,
    desired,
    maxAddressesPerWebhook: MAX_ADDRESSES_PER_WEBHOOK,
    webhooks,
  });

  // 6. No-op short-circuit: zero adds, zero removes → don't burn the
  //    Helius rate-limit budget on a no-op PATCH/POST.
  if (diff.toAdd.length === 0 && diff.toRemove.length === 0) {
    return {
      addressesAdded: 0,
      addressesRemoved: 0,
      skipped: true,
      walletsErrored,
      walletsScanned: wallets.length,
      webhooksCreated: 0,
      webhooksPatched: 0,
    };
  }

  // 7. Create any new webhooks for overflow shards. Insert the
  //    helius_webhooks row eagerly so we have a UUID to assign on the
  //    address rows in the same final batch.
  const createdWebhookIdsByShard: Array<{
    addresses: DesiredAddress[];
    dbWebhookId: string;
    heliusWebhookId: string;
  }> = [];
  for (const shard of diff.webhooksToCreate) {
    const addressList = shard.addresses.map((row) => row.address);
    const { webhookId: heliusId } = await deps.createHeliusWebhook({
      accountAddresses: addressList,
      apiKey: deps.apiKey,
      authHeader: deps.webhookSecret,
      webhookUrl: deps.webhookUrl,
    });
    const inserted = await db
      .insert(heliusWebhooks)
      .values({
        addressCount: shard.addresses.length,
        heliusWebhookId: heliusId,
        webhookUrl: deps.webhookUrl,
      })
      .returning({ id: heliusWebhooks.id });
    const newRow = inserted[0];
    if (!newRow?.id) {
      throw new Error(
        `Failed to insert helius_webhooks row for ${heliusId}; investigate manually`,
      );
    }
    createdWebhookIdsByShard.push({
      addresses: shard.addresses,
      dbWebhookId: newRow.id,
      heliusWebhookId: heliusId,
    });
  }

  // 8. For each affected EXISTING webhook, compute its full new address
  //    list and PATCH Helius. "Affected" = webhook has any add OR any
  //    remove assigned to it.
  const affectedExistingWebhookIds = new Set<string>();
  for (const add of diff.toAdd) {
    affectedExistingWebhookIds.add(add.assignedWebhookId);
  }
  for (const rem of diff.toRemove) {
    affectedExistingWebhookIds.add(rem.webhookId);
  }

  // Build a quick lookup for current addresses by webhook so we can
  // assemble the new full list per affected webhook.
  const currentByWebhook = new Map<string, CurrentAddress[]>();
  for (const row of current) {
    const list = currentByWebhook.get(row.webhookId);
    if (list) list.push(row);
    else currentByWebhook.set(row.webhookId, [row]);
  }
  const removesByWebhook = new Map<string, Set<string>>();
  for (const r of diff.toRemove) {
    let set = removesByWebhook.get(r.webhookId);
    if (!set) {
      set = new Set<string>();
      removesByWebhook.set(r.webhookId, set);
    }
    set.add(r.address);
  }
  const addsByWebhook = new Map<string, DesiredAddress[]>();
  for (const a of diff.toAdd) {
    const list = addsByWebhook.get(a.assignedWebhookId);
    if (list) list.push(a);
    else addsByWebhook.set(a.assignedWebhookId, [a]);
  }

  const webhookDbIdToHelius = new Map<string, string>();
  for (const w of webhooks) {
    webhookDbIdToHelius.set(w.webhookId, w.heliusWebhookId);
  }

  // Per-webhook final address counts after the resync. Used both for
  // the PATCH and to update helius_webhooks.addressCount.
  const newAddressCountByWebhook = new Map<string, number>();
  let webhooksPatched = 0;
  for (const dbWebhookId of affectedExistingWebhookIds) {
    const heliusId = webhookDbIdToHelius.get(dbWebhookId);
    if (!heliusId) {
      throw new Error(
        `Affected webhook ${dbWebhookId} not found in current webhooks list; investigate manually`,
      );
    }
    const existing = currentByWebhook.get(dbWebhookId) ?? [];
    const removes = removesByWebhook.get(dbWebhookId) ?? new Set<string>();
    const adds = addsByWebhook.get(dbWebhookId) ?? [];

    const fullAddressList: string[] = [];
    for (const row of existing) {
      if (!removes.has(row.address)) fullAddressList.push(row.address);
    }
    for (const a of adds) {
      fullAddressList.push(a.address);
    }
    newAddressCountByWebhook.set(dbWebhookId, fullAddressList.length);

    await deps.patchHeliusWebhookAddresses({
      accountAddresses: fullAddressList,
      apiKey: deps.apiKey,
      heliusWebhookId: heliusId,
    });
    webhooksPatched += 1;
  }

  // 9. Single db.batch: insert toAdd rows (for existing webhooks AND
  //    overflow shards), delete toRemove rows, update affected
  //    helius_webhooks.addressCount. Per CLAUDE.md, this repo uses
  //    drizzle-orm/neon-http which does NOT support db.transaction();
  //    db.batch is the atomic multi-write primitive.
  type BatchStatement = Parameters<typeof db.batch>[0][number];
  const statements: BatchStatement[] = [];

  // Inserts for toAdd against existing webhooks.
  const addRowsExisting = diff.toAdd.map((row) => ({
    address: row.address,
    kind: row.kind,
    walletPublicKey: row.walletPublicKey,
    webhookId: row.assignedWebhookId,
  }));
  if (addRowsExisting.length > 0) {
    statements.push(
      db.insert(heliusWebhookAddresses).values(addRowsExisting),
    );
  }

  // Inserts for newly-created webhooks (overflow shards).
  for (const created of createdWebhookIdsByShard) {
    const rows = created.addresses.map((row) => ({
      address: row.address,
      kind: row.kind,
      walletPublicKey: row.walletPublicKey,
      webhookId: created.dbWebhookId,
    }));
    if (rows.length > 0) {
      statements.push(db.insert(heliusWebhookAddresses).values(rows));
    }
  }

  // Deletes for toRemove. Address is globally unique → safe to match by
  // address.
  if (diff.toRemove.length > 0) {
    const removeAddresses = diff.toRemove.map((r) => r.address);
    statements.push(
      db
        .delete(heliusWebhookAddresses)
        .where(inArray(heliusWebhookAddresses.address, removeAddresses)),
    );
  }

  // Address-count updates on affected existing webhooks.
  for (const [dbWebhookId, count] of newAddressCountByWebhook) {
    statements.push(
      db
        .update(heliusWebhooks)
        .set({ addressCount: count, updatedAt: new Date() })
        .where(eq(heliusWebhooks.id, dbWebhookId)),
    );
  }

  if (statements.length > 0) {
    const [first, ...rest] = statements;
    if (first) {
      await db.batch([first, ...rest]);
    }
  }

  return {
    addressesAdded: diff.toAdd.length + diff.webhooksToCreate.reduce((sum, shard) => sum + shard.addresses.length, 0),
    addressesRemoved: diff.toRemove.length,
    skipped: false,
    walletsErrored,
    walletsScanned: wallets.length,
    webhooksCreated: createdWebhookIdsByShard.length,
    webhooksPatched,
  };
}
