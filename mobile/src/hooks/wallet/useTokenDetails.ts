import { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    setDetailsByMint({});
  }, [resetKey]);

  useEffect(() => {
    if (mintsKey.length === 0) return;

    const uniqueMints = mintsKey.split("|");
    const missing = uniqueMints.filter((mint) => detailsByMint[mint] == null);
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.allSettled(
      missing.map(async (mint) => ({
        mint,
        detail: await fetchTokenDetailWithRetry(mint),
      })),
    ).then((results) => {
      if (cancelled) return;
      setDetailsByMint((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result.status === "fulfilled") {
            next[result.value.mint] = result.value.detail;
          }
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [mintsKey, detailsByMint]);

  return detailsByMint;
}
