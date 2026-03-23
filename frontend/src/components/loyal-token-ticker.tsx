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
import { openTrackedLink } from "@/lib/core/analytics";

const LOYAL_TOKEN_ADDRESS = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const FETCH_TIMEOUT = 10_000;
const REFRESH_INTERVAL = 60_000;

type TokenData = {
  symbol: string;
  icon: string;
  usdPrice: number;
};

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
        setTokenData(data);
        setLoading(false);
      } else if (mounted) {
        setLoading(false);
      }
    };

    fetchTokenData();

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
