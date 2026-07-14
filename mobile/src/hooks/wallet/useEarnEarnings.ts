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

// The backend refuses to compute earnings it can't verify against the recorded
// deposit history (503), which is a different thing from "you have earned
// nothing" (200, zero bars). Keep them apart: zeros are a truthful answer only
// in the second case, so `status` lets the chart say so instead of claiming a
// position earned $0.00.
export type EarnEarningsStatus = "loading" | "ready" | "unavailable";

type CachedEarnings = {
  earnings: EarnEarningsResponse | null;
  fetchedAtMs: number;
  status: Exclude<EarnEarningsStatus, "loading">;
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
      cached = { earnings: res, fetchedAtMs: Date.now(), status: "ready" };
    } catch (error) {
      console.error("Failed to fetch Earn earnings", error);
      // A failed refresh never clobbers a good snapshot — a blip shouldn't wipe
      // a drawn chart. Only surface "unavailable" when we have nothing to show.
      if (cacheAddress !== walletAddress || cached?.status !== "ready") {
        cacheAddress = walletAddress;
        cached = {
          earnings: null,
          fetchedAtMs: Date.now(),
          status: "unavailable",
        };
      }
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

type EarnEarningsSnapshot = {
  earnings: EarnEarningsResponse | null;
  fetchedAtMs: number | null;
  status: EarnEarningsStatus;
};

const LOADING: EarnEarningsSnapshot = {
  earnings: null,
  fetchedAtMs: null,
  status: "loading",
};

export function useEarnEarnings(walletAddress: string | null) {
  const [snapshot, setSnapshot] = useState<EarnEarningsSnapshot>(() =>
    walletAddress && cacheAddress === walletAddress && cached
      ? { ...cached }
      : LOADING,
  );

  useEffect(() => {
    if (!walletAddress) {
      setSnapshot(LOADING);
      return;
    }
    let alive = true;
    const syncFromCache = () => {
      if (!alive || cacheAddress !== walletAddress || !cached) {
        return;
      }
      const { earnings, fetchedAtMs, status } = cached;
      setSnapshot((prev) =>
        prev.earnings === earnings &&
        prev.fetchedAtMs === fetchedAtMs &&
        prev.status === status
          ? prev
          : { earnings, fetchedAtMs, status },
      );
    };
    if (cacheAddress === walletAddress && cached) {
      // Preloaded (or background-updated) data: show it immediately.
      syncFromCache();
    } else {
      // Nothing cached yet — fetch now. `fetchIntoCache` always settles the
      // cache (ready or unavailable), so the chart leaves the skeleton either
      // way instead of pulsing forever.
      void fetchIntoCache(walletAddress).then(syncFromCache);
    }
    pushListeners.add(syncFromCache);
    return () => {
      alive = false;
      pushListeners.delete(syncFromCache);
    };
  }, [walletAddress]);

  return snapshot;
}
