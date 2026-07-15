"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  Ticker,
  TickerIcon,
  TickerPrice,
  TickerSymbol,
} from "@/components/kibo-ui/ticker";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  readClientCacheEntry,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import { openTrackedLink } from "@/lib/core/analytics";
import {
  isLoyalTokenTickerData,
  LOYAL_TOKEN_MINT,
  type LoyalTokenTickerData,
} from "@/lib/market/loyal-token-ticker.shared";

const TICKER_ROUTE = "/api/tokens/loyal-ticker";
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;
const FETCH_TIMEOUT_MS = 5000;
const REVALIDATE_AFTER_MS = 5 * 60 * 1000;

const TICKER_CACHE_KEY = "loyal.loyalTicker.v1";
const TICKER_CACHE_VERSION = 1;
// LOYAL is a mainnet token; the ticker shows the same data on every cluster.
const TICKER_CACHE_SCOPE = "global";
const TICKER_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

function readCachedTokenData() {
  return readClientCacheEntry<LoyalTokenTickerData>({
    key: TICKER_CACHE_KEY,
    version: TICKER_CACHE_VERSION,
    solanaEnv: TICKER_CACHE_SCOPE,
    validate: isLoyalTokenTickerData,
  });
}

function writeCachedTokenData(data: LoyalTokenTickerData) {
  writeClientCache({
    key: TICKER_CACHE_KEY,
    version: TICKER_CACHE_VERSION,
    solanaEnv: TICKER_CACHE_SCOPE,
    data,
    ttlMs: TICKER_PERSIST_TTL_MS,
  });
}

type FetchResult = {
  data: LoyalTokenTickerData | null;
  shouldRetry: boolean;
};

async function performFetch(signal: AbortSignal): Promise<FetchResult> {
  const requestController = new AbortController();
  const abortRequest = () => requestController.abort();
  signal.addEventListener("abort", abortRequest, { once: true });
  const timeoutId = setTimeout(
    () => requestController.abort(),
    FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(TICKER_ROUTE, {
      cache: "default",
      signal: requestController.signal,
    });

    if (!response.ok) {
      return {
        data: null,
        shouldRetry: response.status === 429 || response.status >= 500,
      };
    }

    const data: unknown = await response.json();
    if (isLoyalTokenTickerData(data)) {
      return { data, shouldRetry: false };
    }

    return { data: null, shouldRetry: true };
  } catch {
    return {
      data: null,
      shouldRetry: !signal.aborted,
    };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortRequest);
  }
}

function waitForRetry(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", handleAbort);
      resolve(ready);
    };
    const handleAbort = () => finish(false);
    const timeoutId = setTimeout(() => finish(true), RETRY_DELAY_MS);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function fetchWithRetry(
  signal: AbortSignal
): Promise<LoyalTokenTickerData | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) {
      return null;
    }

    const result = await performFetch(signal);
    if (result.data) {
      return result.data;
    }

    if (!result.shouldRetry || attempt === MAX_ATTEMPTS - 1) {
      return null;
    }

    if (!(await waitForRetry(signal))) {
      return null;
    }
  }

  return null;
}

export function LoyalTokenTicker() {
  const publicEnv = usePublicEnv();
  const [tokenData, setTokenData] = useState<LoyalTokenTickerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const cached = readCachedTokenData();
    let inFlight: Promise<void> | null = null;
    let lastAttemptAt = cached?.savedAt ?? 0;

    if (cached) {
      setTokenData(cached.data);
      setLoading(false);
    }

    const refresh = () => {
      const now = Date.now();
      if (
        controller.signal.aborted ||
        inFlight ||
        now - lastAttemptAt < REVALIDATE_AFTER_MS
      ) {
        return;
      }
      lastAttemptAt = now;

      const request = fetchWithRetry(controller.signal)
        .then((data) => {
          if (controller.signal.aborted) {
            return;
          }
          if (data) {
            writeCachedTokenData(data);
            setTokenData(data);
          }
          setLoading(false);
        })
        .finally(() => {
          if (inFlight === request) {
            inFlight = null;
          }
        });
      inFlight = request;
    };

    if (!cached || Date.now() - cached.savedAt >= REVALIDATE_AFTER_MS) {
      refresh();
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      controller.abort();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  if (!tokenData && !loading) {
    return null;
  }

  if (!tokenData) {
    return (
      <div className="flex items-center gap-1">
        {/* Icon skeleton */}
        <div
          className="animate-pulse rounded-full bg-white/10"
          style={{ width: "14px", height: "14px" }}
        />
        {/* Text skeletons */}
        <div
          className="h-2.5 animate-pulse rounded bg-white/10 md:h-3"
          style={{ width: "40px" }}
        />
        <div
          className="h-2.5 animate-pulse rounded bg-white/10 md:h-3"
          style={{ width: "30px" }}
        />
      </div>
    );
  }

  return (
    <Ticker
      className="loyal-ticker cursor-pointer gap-1 text-xs transition-opacity hover:opacity-80 md:text-xs"
      onClick={() =>
        openTrackedLink(publicEnv, {
          href: `https://jup.ag/tokens/${LOYAL_TOKEN_MINT}`,
          linkText: tokenData.symbol,
          source: "loyal_token_ticker",
        })
      }
    >
      <TickerIcon asChild>
        <Image
          alt={tokenData.symbol}
          className="loyal-ticker-icon"
          height={16}
          src={tokenData.icon}
          width={16}
        />
      </TickerIcon>
      <TickerSymbol
        className="font-medium text-[10px] text-white md:text-xs"
        symbol={tokenData.symbol}
      />
      <TickerPrice
        className="text-[10px] text-white/80 md:text-xs"
        price={tokenData.usdPrice}
      />
    </Ticker>
  );
}
