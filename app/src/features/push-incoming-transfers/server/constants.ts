import "server-only";

import { PublicKey } from "@solana/web3.js";

// Wrapped SOL / native SOL mint. We use this as the canonical "mint"
// for native SOL transfers so the notification format can treat both
// SOL and SPL uniformly.
export const NATIVE_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

// Helius advertises a 100k accountAddresses cap per webhook. We keep
// 50% headroom for ATA churn and accidental duplicates. Shared between
// the bootstrap script and the resync cron so both honor the same
// sharding policy.
export const MAX_ADDRESSES_PER_WEBHOOK = 50_000;
