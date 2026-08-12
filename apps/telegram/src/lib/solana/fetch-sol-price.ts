import { fetchSolUsdPrice as fetchSolUsdPriceFromMagicblock } from "../magicblock/fetch-price-feed";

export const fetchSolUsdPrice = async (): Promise<number> => {
  const price = await fetchSolUsdPriceFromMagicblock();
  if (typeof price !== "number" || Number.isNaN(price)) {
    throw new Error("Unexpected SOL price response");
  }
  return price;
};

// Temporary backwards-compatibility export; prefer fetchSolUsdPrice going forward.
export const fetchSolPriceUsd = fetchSolUsdPrice;
