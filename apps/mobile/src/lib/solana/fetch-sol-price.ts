// CoinGecko free API — no auth required.
// Jupiter Price API v2 is deprecated and now returns 401 without an API key.
const COINGECKO_API =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

export async function fetchSolUsdPrice(): Promise<number> {
  const resp = await fetch(COINGECKO_API);
  if (!resp.ok) throw new Error(`Price fetch failed: ${resp.status}`);
  const data = await resp.json();
  const price = Number(data?.solana?.usd);
  if (!price || Number.isNaN(price)) throw new Error("Invalid SOL price");
  return price;
}
