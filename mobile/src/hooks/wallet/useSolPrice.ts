import { useEffect, useState } from "react";

import { SOL_PRICE_USD } from "@/lib/solana/constants";
import { fetchSolUsdPrice } from "@/lib/solana/fetch-sol-price";

import { getCachedSolPrice, setCachedSolPrice } from "@/lib/solana/wallet-cache";

export function useSolPrice(): {
  solPriceUsd: number | null;
  setSolPriceUsd: React.Dispatch<React.SetStateAction<number | null>>;
  isSolPriceLoading: boolean;
} {
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(
    () => getCachedSolPrice(),
  );
  const [isSolPriceLoading, setIsSolPriceLoading] = useState(
    () => getCachedSolPrice() === null,
  );

  useEffect(() => {
    let isMounted = true;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;

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
          return;
        } catch (error) {
          retryCount++;
          console.error(
            `Failed to fetch SOL price (attempt ${retryCount}/${MAX_RETRIES})`,
            error,
          );
          if (retryCount < MAX_RETRIES && isMounted) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          }
        }
      }
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
