"use client";

import { useEffect, useState } from "react";

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";

let cachedPriceUsd: number | null = null;
let inflight: Promise<number | null> | null = null;

async function fetchLoyalPrice(): Promise<number | null> {
  try {
    const res = await fetch(`/api/tokens/${LOYL_MINT}/market`);
    const data = (await res.json()) as {
      market?: { priceUsd?: number | null };
    };
    const price = data.market?.priceUsd;
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      cachedPriceUsd = price;
      return price;
    }
    return null;
  } catch {
    return null;
  }
}

export function useLoyalPriceUsd(): number | null {
  const [price, setPrice] = useState<number | null>(cachedPriceUsd);

  useEffect(() => {
    if (cachedPriceUsd !== null) {
      setPrice(cachedPriceUsd);
      return;
    }
    if (!inflight) {
      inflight = fetchLoyalPrice().finally(() => {
        inflight = null;
      });
    }
    let cancelled = false;
    inflight.then((next) => {
      if (!cancelled && next !== null) setPrice(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return price;
}
