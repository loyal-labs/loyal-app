import { fetchJson } from "../core/http";
import { JUPITER_TOKENS_V2_BASE_URL } from "./constants";

type JupiterTokenSearchResult = {
  id: string;
  usdPrice?: number;
};

export async function fetchTokenPricesByMints(
  mints: string[]
): Promise<Map<string, number>> {
  if (mints.length === 0) return new Map();

  const results = await Promise.all(
    mints.map(async (mint) => {
      const url = `${JUPITER_TOKENS_V2_BASE_URL}/search?query=${mint}`;
      const tokens = await fetchJson<JupiterTokenSearchResult[]>(url, {
        method: "GET",
      });
      const match = tokens.find((t) => t.id === mint);
      return { mint, price: match?.usdPrice ?? null };
    })
  );

  const prices = new Map<string, number>();
  for (const { mint, price } of results) {
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      prices.set(mint, price);
    }
  }
  return prices;
}
