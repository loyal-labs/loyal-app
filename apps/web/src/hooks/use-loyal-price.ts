"use client";

import { useEffect, useState } from "react";

import {
  fetchTokenMarketPriceUsd,
  readCachedTokenMarketPriceUsd,
} from "@/lib/market/token-market.client";

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";

export function useLoyalPriceUsd(): number | null {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Paint the last known price instantly, then revalidate (the fetch is a
    // no-op when the cached price is fresh).
    const cached = readCachedTokenMarketPriceUsd(LOYL_MINT);
    if (cached !== null) {
      setPrice(cached);
    }

    void fetchTokenMarketPriceUsd(LOYL_MINT).then((next) => {
      if (!cancelled && next !== null) setPrice(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return price;
}
