import "server-only";

const COINGECKO_BASE_URL = "https://pro-api.coingecko.com/api/v3";
const SOLANA_NETWORK = "solana";
const MAX_MINTS_PER_CALL = 100;

type TokenPricesResponse = {
  data?: {
    attributes?: {
      token_prices?: Record<string, string | number | null | undefined>;
    };
  };
};

function getCoinGeckoApiKey(): string | null {
  return process.env.COINGECKO_API_KEY ?? null;
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchTokenPricesBatch(
  mints: string[]
): Promise<Map<string, number>> {
  const apiKey = getCoinGeckoApiKey();
  if (!apiKey || mints.length === 0) {
    return new Map();
  }

  const response = await fetch(
    `${COINGECKO_BASE_URL}/onchain/simple/networks/${SOLANA_NETWORK}/token_price/${mints.join(
      ","
    )}`,
    {
      headers: {
        "Content-Type": "application/json",
        "x-cg-pro-api-key": apiKey,
      },
      method: "GET",
    }
  );

  if (!response.ok) {
    throw new Error(
      `CoinGecko token prices request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as TokenPricesResponse;
  const tokenPrices = payload.data?.attributes?.token_prices ?? {};
  const pricesByMint = new Map<string, number>();

  for (const mint of mints) {
    const price = parseNumber(tokenPrices[mint]);
    if (price !== null) {
      pricesByMint.set(mint, price);
    }
  }

  return pricesByMint;
}

export async function fetchTokenPricesByMints(
  mints: string[]
): Promise<Map<string, number>> {
  const normalizedMints = Array.from(
    new Set(mints.map((mint) => mint.trim()).filter(Boolean))
  );

  if (normalizedMints.length === 0 || !getCoinGeckoApiKey()) {
    return new Map();
  }

  const batches: string[][] = [];
  for (
    let index = 0;
    index < normalizedMints.length;
    index += MAX_MINTS_PER_CALL
  ) {
    batches.push(normalizedMints.slice(index, index + MAX_MINTS_PER_CALL));
  }

  const pricesByMint = new Map<string, number>();
  for (const batchPrices of await Promise.all(
    batches.map((batch) => fetchTokenPricesBatch(batch))
  )) {
    for (const [mint, price] of batchPrices) {
      pricesByMint.set(mint, price);
    }
  }

  return pricesByMint;
}
