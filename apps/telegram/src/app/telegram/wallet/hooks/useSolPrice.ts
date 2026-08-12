import type React from "react";
import { useEffect, useState } from "react";

import { SOL_PRICE_USD } from "@/lib/constants";
import { fetchSolUsdPrice } from "@/lib/solana/fetch-sol-price";

import { getCachedSolPrice, setCachedSolPrice } from "../wallet-cache";
import { MOCK_SOL_PRICE_USD, USE_MOCK_DATA } from "../wallet-mock-data";

export function useSolPrice(): {
  solPriceUsd: number | null;
  setSolPriceUsd: React.Dispatch<React.SetStateAction<number | null>>;
  isSolPriceLoading: boolean;
} {
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(() =>
    USE_MOCK_DATA ? MOCK_SOL_PRICE_USD : getCachedSolPrice()
  );
  const [isSolPriceLoading, setIsSolPriceLoading] = useState(() =>
    USE_MOCK_DATA ? false : getCachedSolPrice() === null
  );

  useEffect(() => {
    if (USE_MOCK_DATA) return;
    let isMounted = true;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;

    // Check cache first - if we have a cached price, use it immediately
    const cached = getCachedSolPrice();
    if (cached !== null) {
      setSolPriceUsd(cached);
      setIsSolPriceLoading(false);
    }

    const loadPrice = async () => {
      while (retryCount < MAX_RETRIES && isMounted) {
        try {
          const price = await fetchSolUsdPrice();
          if (!isMounted) return;
          setCachedSolPrice(price);
          setSolPriceUsd(price);
          setIsSolPriceLoading(false);
          return; // Success, exit
        } catch (error) {
          retryCount++;
          console.error(
            `Failed to fetch SOL price (attempt ${retryCount}/${MAX_RETRIES})`,
            error
          );
          if (retryCount < MAX_RETRIES && isMounted) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          }
        }
      }
      // All retries failed, use fallback price
      if (isMounted) {
        console.warn("Using fallback SOL price after all retries failed");
        setCachedSolPrice(SOL_PRICE_USD);
        setSolPriceUsd(SOL_PRICE_USD);
        setIsSolPriceLoading(false);
      }
    };

    void loadPrice();

    return () => {
      isMounted = false;
    };
  }, []);

  return { solPriceUsd, setSolPriceUsd, isSolPriceLoading };
}
