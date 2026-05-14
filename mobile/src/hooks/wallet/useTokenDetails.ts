import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchTokenDetailMarket,
  type MobileTokenDetailResponse,
} from "@/services/api";

export type TokenDetailsByMint = Record<
  string,
  MobileTokenDetailResponse | undefined
>;

// CoinGecko sometimes returns a first response before priceChange24h has been
// computed. Retry a couple of times so the UI avoids flickering "—" for 24h.
async function fetchTokenDetailWithRetry(
  mint: string,
  maxAttempts = 3,
  retryDelayMs = 250,
): Promise<MobileTokenDetailResponse> {
  let lastDetail: MobileTokenDetailResponse | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const detail = await fetchTokenDetailMarket(mint);
      lastDetail = detail;
      const change = detail.market.priceChange24hPercent;
      if (typeof change === "number" && Number.isFinite(change)) {
        return detail;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (lastDetail) return lastDetail;
  throw lastError ?? new Error("Failed to fetch token detail");
}

// Shared cache of /api/mobile/tokens/:mint responses keyed by mint. Both
// TokensList (needs market + logo/symbol) and ActivityFeed (needs logo/symbol)
// read from this to avoid duplicate fetches. The hook is tolerant of errors:
// failed mints stay absent from the map, and downstream code falls back to
// Helius-supplied holding data or the KNOWN_TOKEN_* last-resort maps.
export function useTokenDetails(
  mints: string[],
  resetKey: number = 0,
): TokenDetailsByMint {
  const mintsKey = useMemo(
    () => Array.from(new Set(mints)).sort().join("|"),
    [mints],
  );

  const [detailsByMint, setDetailsByMint] = useState<TokenDetailsByMint>({});

  // Track mints we've already tried (success or failure) so a persistent
  // fetch failure doesn't re-fire on every render. Without this, each
  // setState below produced a new detailsByMint reference, which — if
  // detailsByMint were in the deps — would re-run the effect forever. We
  // key the record by `resetKey|mint` so explicit refresh bumps clear it.
  const attemptedRef = useRef<Set<string>>(new Set());

  // Keep reset synchronous with the fetch effect below so that bumping
  // `resetKey` (manual pull-to-refresh, network switch) always triggers a
  // re-fetch. If we split reset into its own effect, the fetch effect's
  // `mintsKey` dep wouldn't have changed, and the UI would get stuck
  // showing skeletons against an empty state until `mintsKey` next shifts.
  const lastResetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (lastResetKeyRef.current !== resetKey) {
      lastResetKeyRef.current = resetKey;
      attemptedRef.current = new Set();
      // Do NOT clear detailsByMint here. Wiping the cache on pull-to-
      // refresh made every icon fall through to KNOWN_TOKEN_ICONS
      // (which points at a different CoinGecko size variant), producing
      // a visible SOL-icon flicker while the refetch was in flight.
      // Stale data is fine to show until fresh results merge in below.
    }

    if (mintsKey.length === 0) return;

    const uniqueMints = mintsKey.split("|");
    const missing = uniqueMints.filter(
      (mint) => !attemptedRef.current.has(mint),
    );
    if (missing.length === 0) return;

    for (const mint of missing) attemptedRef.current.add(mint);

    let cancelled = false;
    void Promise.allSettled(
      missing.map(async (mint) => {
        try {
          const detail = await fetchTokenDetailWithRetry(mint);
          return { mint, detail, ok: true as const };
        } catch (error) {
          console.error("[token-detail] fetch failed", {
            mint,
            error: error instanceof Error ? error.message : String(error),
          });
          return { mint, ok: false as const };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const successes = results.flatMap((r) =>
        r.status === "fulfilled" && r.value.ok
          ? [[r.value.mint, r.value.detail] as const]
          : [],
      );
      if (successes.length === 0) return;
      setDetailsByMint((current) => {
        const next = { ...current };
        for (const [mint, detail] of successes) next[mint] = detail;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [mintsKey, resetKey]);

  return detailsByMint;
}
