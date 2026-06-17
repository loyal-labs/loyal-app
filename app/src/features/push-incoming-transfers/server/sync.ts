import "server-only";

import {
  privateTransferTokenCatalog,
  pushTokens,
  walletPushSyncState,
} from "@loyal-labs/db-core/schema";
import { PublicKey } from "@solana/web3.js";
import { eq, inArray, isNotNull } from "drizzle-orm";

// SPL Token and Token-2022 program IDs. Incoming SPL transfers reference
// the ATA, not the wallet pubkey itself, so we enumerate ATAs owned by
// the wallet under both programs and scan signatures on each. Without
// this, `getSignaturesForAddress(wallet)` misses every incoming SPL
// transfer — only SOL transfers and outgoing SPLs (where wallet is a
// signer) are visible.
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

import {
  buildTokenCatalogUpserts,
  upsertTokenCatalog,
} from "@/features/private-transfer-analytics/server/token-catalog";
import { getDatabase } from "@/lib/core/database";
import { sendPushToWallet } from "@/lib/push-notifications/send-to-wallet";

import type {
  IncomingTransferEvent,
  IncomingTransferPushStats,
} from "../types";
import { getIncomingTransferConnection } from "./connection";
import {
  MAX_TRANSACTIONS_PER_WALLET_PER_RUN,
  SIGNATURES_PAGE_LIMIT,
  WALLET_CONCURRENCY,
} from "./constants";
import { formatIncomingTransferPush } from "./format";
import { parseIncomingTransfersForWallet } from "./transfer-parser";

type MintMetadata = { symbol: string; decimals: number };

async function listRegisteredWallets(): Promise<string[]> {
  const db = getDatabase();
  const rows = await db
    .selectDistinct({ walletPublicKey: pushTokens.walletPublicKey })
    .from(pushTokens)
    .where(isNotNull(pushTokens.walletPublicKey));
  return rows
    .map((row) => row.walletPublicKey)
    .filter((key): key is string => typeof key === "string" && key.length > 0);
}

async function getOrCreateSyncState(
  walletPublicKey: string
): Promise<typeof walletPushSyncState.$inferSelect> {
  const db = getDatabase();
  const existing = await db
    .select()
    .from(walletPushSyncState)
    .where(eq(walletPushSyncState.walletPublicKey, walletPublicKey));
  if (existing[0]) return existing[0];

  await db
    .insert(walletPushSyncState)
    .values({ walletPublicKey })
    .onConflictDoNothing();
  const created = await db
    .select()
    .from(walletPushSyncState)
    .where(eq(walletPushSyncState.walletPublicKey, walletPublicKey));
  if (!created[0]) {
    throw new Error(
      `Failed to initialize wallet_push_sync_state for ${walletPublicKey}`
    );
  }
  return created[0];
}

async function updateSyncState(
  walletPublicKey: string,
  values: Partial<typeof walletPushSyncState.$inferInsert>
): Promise<void> {
  const db = getDatabase();
  await db
    .update(walletPushSyncState)
    .set({ ...values, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(walletPushSyncState.walletPublicKey, walletPublicKey));
}

// Process-level cache for ATA membership. ATAs change rarely relative
// to cron cadence; refetching them every tick burns 2 RPC calls per
// wallet for nothing and was a major source of Helius 429s. Survives
// across cron invocations on the same warm Vercel lambda.
const ATA_CACHE_TTL_MS = 30 * 60 * 1000;
const ataCache = new Map<string, { addresses: string[]; cachedAt: number }>();

async function listOwnedAtaAddresses(walletPk: PublicKey): Promise<string[]> {
  const key = walletPk.toBase58();
  const cached = ataCache.get(key);
  const now = Date.now();
  if (cached && now - cached.cachedAt < ATA_CACHE_TTL_MS) {
    return cached.addresses;
  }
  const connection = getIncomingTransferConnection();
  const [classic, token2022] = await Promise.all([
    connection.getTokenAccountsByOwner(walletPk, {
      programId: TOKEN_PROGRAM_ID,
    }),
    connection.getTokenAccountsByOwner(walletPk, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ]);
  const addresses = new Set<string>();
  for (const entry of classic.value) addresses.add(entry.pubkey.toBase58());
  for (const entry of token2022.value) addresses.add(entry.pubkey.toBase58());
  const result = Array.from(addresses);
  ataCache.set(key, { addresses: result, cachedAt: now });
  return result;
}

type SignatureEntry = {
  signature: string;
  blockTime: number | null | undefined;
  slot: number;
};

async function fetchNewEventsForWallet(
  walletPublicKey: string,
  lastSignature: string | null
): Promise<{
  events: IncomingTransferEvent[];
  latestSignature: string | null;
}> {
  const connection = getIncomingTransferConnection();
  const pk = new PublicKey(walletPublicKey);

  // Scan wallet (catches SOL transfers + outgoing SPL where wallet is
  // signer) + every ATA the wallet owns (catches incoming SPL, where
  // only the ATA is in accountKeys). Union is deduped by signature.
  const ataAddresses = await listOwnedAtaAddresses(pk);
  const scanTargets = [pk, ...ataAddresses.map((a) => new PublicKey(a))];

  const signaturePages = await Promise.all(
    scanTargets.map((target) =>
      connection.getSignaturesForAddress(target, {
        limit: SIGNATURES_PAGE_LIMIT,
        until: lastSignature ?? undefined,
      })
    )
  );

  const bySignature = new Map<string, SignatureEntry>();
  for (const page of signaturePages) {
    for (const entry of page) {
      if (!bySignature.has(entry.signature)) {
        bySignature.set(entry.signature, {
          blockTime: entry.blockTime,
          signature: entry.signature,
          slot: entry.slot,
        });
      }
    }
  }

  if (bySignature.size === 0) {
    return { events: [], latestSignature: lastSignature };
  }

  // Sort newest-first by slot (blockTime is sometimes null for just-
  // finalized blocks; slot is monotonic and always present).
  const uniqueSignatures = Array.from(bySignature.values()).sort(
    (a, b) => b.slot - a.slot
  );
  const latestSignature = uniqueSignatures[0]?.signature ?? lastSignature;

  // First-time wallets (no cursor): don't backfill — just record the
  // current head and wait for the next run. Avoids blasting the user
  // with historical transfer notifications the first time they install.
  if (!lastSignature) {
    return { events: [], latestSignature };
  }

  const signatureList = uniqueSignatures
    .slice(0, MAX_TRANSACTIONS_PER_WALLET_PER_RUN)
    .map((entry) => entry.signature);
  const parsed = await connection.getParsedTransactions(signatureList, {
    maxSupportedTransactionVersion: 0,
  });

  const events: IncomingTransferEvent[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const tx = parsed[i];
    if (!tx) continue;
    const signature = signatureList[i];
    if (!signature) continue;
    events.push(
      ...parseIncomingTransfersForWallet(tx, signature, walletPublicKey)
    );
  }

  return { events, latestSignature };
}

async function resolveMintMetadata(
  mints: Iterable<string>
): Promise<Map<string, MintMetadata>> {
  const uniqueMints = Array.from(new Set(Array.from(mints).filter(Boolean)));
  if (uniqueMints.length === 0) return new Map();

  const db = getDatabase();
  const existing = await db
    .select({
      tokenMint: privateTransferTokenCatalog.tokenMint,
      decimals: privateTransferTokenCatalog.decimals,
      symbol: privateTransferTokenCatalog.symbol,
    })
    .from(privateTransferTokenCatalog)
    .where(inArray(privateTransferTokenCatalog.tokenMint, uniqueMints));

  const resolved = new Map<string, MintMetadata>();
  for (const row of existing) {
    resolved.set(row.tokenMint, {
      decimals: row.decimals ?? 0,
      symbol: row.symbol ?? row.tokenMint,
    });
  }

  const missing = uniqueMints.filter((mint) => !resolved.has(mint));
  if (missing.length > 0) {
    const entries = await buildTokenCatalogUpserts(missing);
    await upsertTokenCatalog(entries);
    for (const entry of entries) {
      resolved.set(entry.tokenMint, {
        decimals: entry.decimals ?? 0,
        symbol: entry.symbol,
      });
    }
  }

  return resolved;
}

async function processWallet(
  walletPublicKey: string,
  stats: IncomingTransferPushStats
): Promise<IncomingTransferEvent[]> {
  try {
    const state = await getOrCreateSyncState(walletPublicKey);
    const { events, latestSignature } = await fetchNewEventsForWallet(
      walletPublicKey,
      state.lastSignature
    );

    await updateSyncState(walletPublicKey, {
      lastSignature: latestSignature,
      lastError: null,
    });

    stats.walletsScanned += 1;
    return events;
  } catch (error) {
    stats.walletsErrored += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[push-incoming-transfers] wallet ${walletPublicKey} errored`,
      message
    );
    await updateSyncState(walletPublicKey, { lastError: message }).catch(
      () => undefined
    );
    return [];
  }
}

export async function runPushIncomingTransfersCron(): Promise<IncomingTransferPushStats> {
  const stats: IncomingTransferPushStats = {
    walletsScanned: 0,
    signaturesFetched: 0,
    eventsDetected: 0,
    notificationsSent: 0,
    walletsErrored: 0,
  };

  const wallets = await listRegisteredWallets();
  if (wallets.length === 0) return stats;

  // Bounded concurrency across wallets — Solana RPC is generous but not
  // unlimited, and we want fair progress across all registered users.
  const allEvents: IncomingTransferEvent[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < wallets.length) {
      const idx = cursor;
      cursor += 1;
      const wallet = wallets[idx];
      if (!wallet) continue;
      const events = await processWallet(wallet, stats);
      allEvents.push(...events);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WALLET_CONCURRENCY, wallets.length) }, () =>
      worker()
    )
  );

  stats.eventsDetected = allEvents.length;
  if (allEvents.length === 0) return stats;

  const metadataByMint = await resolveMintMetadata(
    allEvents.map((event) => event.mint)
  );

  for (const event of allEvents) {
    const payload = formatIncomingTransferPush(
      event,
      metadataByMint.get(event.mint) ?? null
    );
    const result = await sendPushToWallet(event.recipient, payload);
    stats.notificationsSent += result.sentTo;
  }

  return stats;
}
