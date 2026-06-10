"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
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

const LOYAL_TOKEN_ADDRESS = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const FETCH_TIMEOUT = 10_000;
const REFRESH_INTERVAL = 60_000;

const TICKER_CACHE_KEY = "loyal.loyalTicker.v1";
const TICKER_CACHE_VERSION = 1;
// LOYAL is a mainnet token; the ticker shows the same data on every cluster.
const TICKER_CACHE_SCOPE = "global";
const TICKER_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

type TokenData = {
  symbol: string;
  icon: string;
  usdPrice: number;
};

function isTokenData(data: unknown): data is TokenData {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as TokenData;
  return (
    typeof candidate.symbol === "string" &&
    candidate.symbol.length > 0 &&
    typeof candidate.icon === "string" &&
    candidate.icon.length > 0 &&
    typeof candidate.usdPrice === "number" &&
    Number.isFinite(candidate.usdPrice)
  );
}

function readCachedTokenData() {
  return readClientCacheEntry<TokenData>({
    key: TICKER_CACHE_KEY,
    version: TICKER_CACHE_VERSION,
    solanaEnv: TICKER_CACHE_SCOPE,
    validate: isTokenData,
  });
}

function writeCachedTokenData(data: TokenData) {
  writeClientCache({
    key: TICKER_CACHE_KEY,
    version: TICKER_CACHE_VERSION,
    solanaEnv: TICKER_CACHE_SCOPE,
    data,
    ttlMs: TICKER_PERSIST_TTL_MS,
  });
}

type FetchResult = {
  success: boolean;
  data?: TokenData;
  shouldRetry: boolean;
};

async function performFetch(controller: AbortController): Promise<FetchResult> {
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${LOYAL_TOKEN_ADDRESS}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, shouldRetry: true };
    }

    const data = await response.json();

    if (data && data.length > 0) {
      const token = data[0];
      return {
        success: true,
        shouldRetry: false,
        data: {
          symbol: token.symbol,
          icon: token.icon,
          usdPrice: token.usdPrice,
        },
      };
    }

    return { success: false, shouldRetry: true };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, shouldRetry: false };
    }

    return { success: false, shouldRetry: true };
  }
}

async function fetchWithRetry(
  abortControllerRef: React.MutableRefObject<AbortController | null>,
  mounted: () => boolean
): Promise<TokenData | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (!mounted()) {
      return null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const result = await performFetch(controller);

    if (!mounted()) {
      return null;
    }

    if (result.success && result.data) {
      return result.data;
    }

    if (!result.shouldRetry) {
      return null;
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }
  }

  return null;
}

export function LoyalTokenTicker() {
  const publicEnv = usePublicEnv();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchTokenData = async () => {
      const data = await fetchWithRetry(abortControllerRef, () => mounted);

      if (data) {
        writeCachedTokenData(data);
        setTokenData(data);
        setLoading(false);
      } else if (mounted) {
        setLoading(false);
      }
    };

    // Paint the last known ticker instantly; skip the immediate fetch when
    // the cache is younger than the refresh interval (the interval below
    // keeps it current either way).
    const cached = readCachedTokenData();
    if (cached) {
      setTokenData(cached.data);
      setLoading(false);
    }
    if (!cached || Date.now() - cached.savedAt >= REFRESH_INTERVAL) {
      fetchTokenData();
    }

    const interval = setInterval(fetchTokenData, REFRESH_INTERVAL);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  if (loading || !tokenData) {
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
          href: "https://jup.ag/tokens/LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta",
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
