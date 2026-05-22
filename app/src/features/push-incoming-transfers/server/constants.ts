import "server-only";

import { PublicKey } from "@solana/web3.js";

// Wrapped SOL / native SOL mint. We use this as the canonical "mint"
// for native SOL transfers so the notification format can treat both
// SOL and SPL uniformly.
export const NATIVE_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

// Signature pages per wallet per run. New installs start with no cursor
// so we cap the first scan to avoid backfilling the user's entire
// history — only the most recent page becomes the starting cursor.
export const SIGNATURES_PAGE_LIMIT = 50;

// Cap on parsed transactions per wallet per run. Protects us from a
// noisy wallet monopolizing a single cron tick.
export const MAX_TRANSACTIONS_PER_WALLET_PER_RUN = 50;

// Concurrent wallets processed per run. Helius rate limits are
// generous but we don't want to burn the whole budget on one cron.
export const WALLET_CONCURRENCY = 5;

// Helius advertises a 100k accountAddresses cap per webhook. We keep
// 50% headroom for ATA churn and accidental duplicates. Shared between
// the bootstrap script and the resync cron so both honor the same
// sharding policy.
export const MAX_ADDRESSES_PER_WEBHOOK = 50_000;
