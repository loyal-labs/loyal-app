const JUPITER_PRICE_API = "https://api.jup.ag/price/v2";
const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function fetchSolUsdPrice(): Promise<number> {
  const resp = await fetch(`${JUPITER_PRICE_API}?ids=${SOL_MINT}`);
  if (!resp.ok) throw new Error(`Price fetch failed: ${resp.status}`);
  const data = await resp.json();
  const price = Number(data?.data?.[SOL_MINT]?.price);
  if (!price || Number.isNaN(price)) throw new Error("Invalid SOL price");
  return price;
}
