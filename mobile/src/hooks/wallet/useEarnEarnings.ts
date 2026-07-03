import { useEffect, useState } from "react";

import {
  fetchEarnEarnings,
  type EarnEarningsResponse,
} from "@/lib/solana/earn/earn-api";

// Reads the wallet's Earn earnings (30-day daily bars + lifetime/since-deposit
// totals + current APY) from the backend read-model for the Earnings chart.
// Read-only by wallet address, like useEarnPosition — opening the Earn tab never
// prompts for a Seed Vault signature. `fetchedAtMs` anchors the live odometer:
// the response reflects earnings as of the server "now", so the chart accrues
// forward from when this resolved (a cached snapshot still ticks correctly).
//
// The data lives in a module-level cache so the chart opens pre-populated (the
// Earn screen's refresh coordinator preloads it at app open and keeps it fresh
// in the background) instead of skeleton-first. A mounted chart deliberately
// keeps its snapshot through quiet background refreshes — it only reloads via
// `notify: true`, i.e. when the earn balance explicitly changed — and picks up
// the latest cache on remount.

type CachedEarnings = {
  earnings: EarnEarningsResponse;
  fetchedAtMs: number;
};

// ponytail: single-wallet cache; key by address if multi-wallet ever lands.
let cacheAddress: string | null = null;
let cached: CachedEarnings | null = null;
let inFlight: { address: string; promise: Promise<void> } | null = null;
// Notified only on explicit pushes (balance changed); silent refreshes just
// rewrite `cached` for the next mount.
const pushListeners = new Set<() => void>();

// Skip silent refreshes while the cache is younger than this — the Earn
// screen's coordinator ticks every 15s but the recorded bars move slowly.
const BACKGROUND_MAX_AGE_MS = 60_000;

function fetchIntoCache(walletAddress: string): Promise<void> {
  if (inFlight?.address === walletAddress) {
    return inFlight.promise;
  }
  const entry: { address: string; promise: Promise<void> } = {
    address: walletAddress,
    promise: Promise.resolve(),
  };
  entry.promise = (async () => {
    try {
      const res = await fetchEarnEarnings(walletAddress);
      cacheAddress = walletAddress;
      cached = { earnings: res, fetchedAtMs: Date.now() };
    } catch (error) {
      console.error("Failed to fetch Earn earnings", error);
    } finally {
      if (inFlight === entry) {
        inFlight = null;
      }
    }
  })();
  inFlight = entry;
  return entry.promise;
}

// Refreshes the cache. Silent by default (mounted charts keep their snapshot);
// `notify: true` also pushes the fresh data into mounted charts — use it only
// when the earn balance explicitly changed.
export async function refreshEarnEarningsCache(
  walletAddress: string,
  { notify = false }: { notify?: boolean } = {},
): Promise<void> {
  const fresh =
    cacheAddress === walletAddress &&
    cached !== null &&
    Date.now() - cached.fetchedAtMs < BACKGROUND_MAX_AGE_MS;
  if (!notify && fresh) {
    return;
  }
  await fetchIntoCache(walletAddress);
  if (notify) {
    for (const listener of pushListeners) {
      listener();
    }
  }
}

export function useEarnEarnings(walletAddress: string | null) {
  const [snapshot, setSnapshot] = useState<{
    earnings: EarnEarningsResponse | null;
    fetchedAtMs: number | null;
    hasLoaded: boolean;
  }>(() =>
    walletAddress && cacheAddress === walletAddress && cached
      ? { ...cached, hasLoaded: true }
      : { earnings: null, fetchedAtMs: null, hasLoaded: false },
  );

  useEffect(() => {
    if (!walletAddress) {
      setSnapshot({ earnings: null, fetchedAtMs: null, hasLoaded: false });
      return;
    }
    let alive = true;
    const syncFromCache = () => {
      if (!alive || cacheAddress !== walletAddress || !cached) {
        return;
      }
      const { earnings, fetchedAtMs } = cached;
      setSnapshot((prev) =>
        prev.earnings === earnings && prev.fetchedAtMs === fetchedAtMs
          ? prev
          : { earnings, fetchedAtMs, hasLoaded: true },
      );
    };
    if (cacheAddress === walletAddress && cached) {
      // Preloaded (or background-updated) data: show it immediately.
      syncFromCache();
    } else {
      // Nothing cached yet — fetch now. On failure, settle `hasLoaded` so the
      // chart shows its empty state instead of a forever-pulsing skeleton; the
      // cache stays empty so the next mount retries.
      void fetchIntoCache(walletAddress).then(() => {
        if (!alive) {
          return;
        }
        syncFromCache();
        setSnapshot((prev) =>
          prev.hasLoaded ? prev : { ...prev, hasLoaded: true },
        );
      });
    }
    pushListeners.add(syncFromCache);
    return () => {
      alive = false;
      pushListeners.delete(syncFromCache);
    };
  }, [walletAddress]);

  return snapshot;
}
