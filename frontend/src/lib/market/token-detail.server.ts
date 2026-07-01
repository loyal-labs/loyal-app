import "server-only";

const COINGECKO_BASE_URL = "https://pro-api.coingecko.com/api/v3";
const SOLANA_NETWORK = "solana";
const SOLANA_POOL_PREFIX = "solana_";
const TOKEN_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

export type TokenDetailChartPoint = {
  timestamp: number;
  priceUsd: number;
};

export type TokenDetailResponse = {
  mint: string;
  token: {
    decimals: number | null;
    logoUrl: string | null;
    name: string | null;
    symbol: string | null;
  };
  links: {
    website: string | null;
    twitter: string | null;
    explorer: string | null;
    discord: string | null;
    telegram: string | null;
  };
  market: {
    fdvUsd: number | null;
    holderCount: number | null;
    liquidityUsd: number | null;
    marketCapUsd: number | null;
    priceChange24hPercent: number | null;
    priceUsd: number | null;
    updatedAt: string | null;
    volume24hUsd: number | null;
  };
  info: {
    description: string | null;
    gtScore: number | null;
    gtVerified: boolean;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    holderDistribution: {
      top10: string;
      rest: string;
    } | null;
  };
  chart: TokenDetailChartPoint[];
};

export type TokenMarketResponse = {
  mint: string;
  token: {
    decimals: number | null;
    logoUrl: string | null;
    name: string | null;
    symbol: string | null;
  };
  market: {
    priceUsd: number | null;
  };
};

type CoinGeckoTokenData = {
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  decimals: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volumeUsd24h: number | null;
  totalReserveUsd: number | null;
  coingeckoCoinId: string | null;
  topPoolIds: string[];
};

type CoinGeckoTokenInfo = {
  websites: string[];
  twitterHandle: string | null;
  discordUrl: string | null;
  telegramHandle: string | null;
  description: string | null;
  gtScore: number | null;
  gtVerified: boolean;
  holderCount: number | null;
  holderDistribution: {
    top10: string;
    rest: string;
  } | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
};

type TokenDetailCacheEntry = {
  expiresAt: number;
  value: TokenDetailResponse;
};

type TokenMarketCacheEntry = {
  expiresAt: number;
  value: TokenMarketResponse;
};

const tokenDetailCache = new Map<string, TokenDetailCacheEntry>();
const tokenDetailInflight = new Map<string, Promise<TokenDetailResponse>>();
const tokenMarketCache = new Map<string, TokenMarketCacheEntry>();
const tokenMarketInflight = new Map<string, Promise<TokenMarketResponse>>();

function getCoinGeckoHeaders(): HeadersInit {
  const apiKey =
    process.env.NEXT_COINGECKO_API_KEY ?? process.env.COINGECKO_API_KEY;

  if (!apiKey) {
    throw new Error("NEXT_COINGECKO_API_KEY is not set");
  }

  return {
    "Content-Type": "application/json",
    "x-cg-pro-api-key": apiKey,
  };
}

function assertCoinGeckoApiKeyConfigured() {
  const apiKey =
    process.env.NEXT_COINGECKO_API_KEY ?? process.env.COINGECKO_API_KEY;

  if (!apiKey) {
    throw new Error("NEXT_COINGECKO_API_KEY is not set");
  }
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function stripSolanaPrefix(poolId: string): string {
  return poolId.startsWith(SOLANA_POOL_PREFIX)
    ? poolId.slice(SOLANA_POOL_PREFIX.length)
    : poolId;
}

async function fetchCoinGeckoJson<T>(path: string): Promise<T> {
  const response = await fetch(`${COINGECKO_BASE_URL}${path}`, {
    headers: getCoinGeckoHeaders(),
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(
      `CoinGecko request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<T>;
}

async function fetchCoinGeckoTokenData(
  mint: string
): Promise<CoinGeckoTokenData> {
  const response = await fetchCoinGeckoJson<{
    data?: {
      attributes?: {
        name?: string;
        symbol?: string;
        decimals?: number;
        image_url?: string | null;
        price_usd?: string | number | null;
        market_cap_usd?: string | number | null;
        fdv_usd?: string | number | null;
        volume_usd?: { h24?: string | number | null } | null;
        total_reserve_in_usd?: string | number | null;
        coingecko_coin_id?: string | null;
      };
      relationships?: {
        top_pools?: { data?: { id: string }[] };
      };
    };
  }>(`/onchain/networks/${SOLANA_NETWORK}/tokens/${mint}`);

  const attrs = response.data?.attributes ?? {};
  const topPools = response.data?.relationships?.top_pools?.data ?? [];

  return {
    name: attrs.name ?? null,
    symbol: attrs.symbol ?? null,
    imageUrl: attrs.image_url ?? null,
    decimals: typeof attrs.decimals === "number" ? attrs.decimals : null,
    priceUsd: parseNumber(attrs.price_usd),
    marketCapUsd: parseNumber(attrs.market_cap_usd),
    fdvUsd: parseNumber(attrs.fdv_usd),
    volumeUsd24h: parseNumber(attrs.volume_usd?.h24),
    totalReserveUsd: parseNumber(attrs.total_reserve_in_usd),
    coingeckoCoinId: attrs.coingecko_coin_id ?? null,
    topPoolIds: topPools.map((pool) => stripSolanaPrefix(pool.id)),
  };
}

async function fetchCoinGeckoTokenInfo(
  mint: string
): Promise<CoinGeckoTokenInfo> {
  const response = await fetchCoinGeckoJson<{
    data?: {
      attributes?: {
        websites?: string[];
        twitter_handle?: string | null;
        discord_url?: string | null;
        telegram_handle?: string | null;
        description?: string | null;
        gt_score?: number | string | null;
        gt_verified?: boolean | null;
        holders?: {
          count?: number | null;
          distribution_percentage?: {
            top_10?: string | null;
            rest?: string | null;
          } | null;
        } | null;
        mint_authority?: string | null;
        freeze_authority?: string | null;
      };
    };
  }>(`/onchain/networks/${SOLANA_NETWORK}/tokens/${mint}/info`);

  const attrs = response.data?.attributes ?? {};
  const distribution = attrs.holders?.distribution_percentage;

  return {
    websites: attrs.websites ?? [],
    twitterHandle: attrs.twitter_handle ?? null,
    discordUrl: attrs.discord_url ?? null,
    telegramHandle: attrs.telegram_handle ?? null,
    description: attrs.description?.trim() ? attrs.description.trim() : null,
    gtScore: parseNumber(attrs.gt_score),
    gtVerified: attrs.gt_verified === true,
    holderCount:
      typeof attrs.holders?.count === "number" ? attrs.holders.count : null,
    holderDistribution:
      distribution?.top_10 != null && distribution?.rest != null
        ? { top10: distribution.top_10, rest: distribution.rest }
        : null,
    mintAuthority: attrs.mint_authority ?? null,
    freezeAuthority: attrs.freeze_authority ?? null,
  };
}

async function fetchCoinGeckoCoinChart(coingeckoCoinId: string): Promise<{
  points: TokenDetailChartPoint[];
  volumeUsd24h: number | null;
}> {
  const response = await fetchCoinGeckoJson<{
    prices?: [number, number][];
    total_volumes?: [number, number][];
  }>(`/coins/${coingeckoCoinId}/market_chart?vs_currency=usd&days=1`);

  const points = (response.prices ?? []).map(([timestamp, priceUsd]) => ({
    timestamp,
    priceUsd,
  }));
  const volumes = response.total_volumes;

  return {
    points,
    volumeUsd24h:
      volumes && volumes.length > 0 ? volumes[volumes.length - 1][1] : null,
  };
}

async function fetchCoinGeckoPoolOhlcv(
  poolId: string
): Promise<TokenDetailChartPoint[]> {
  const response = await fetchCoinGeckoJson<{
    data?: { attributes?: { ohlcv_list?: number[][] } };
  }>(`/onchain/networks/${SOLANA_NETWORK}/pools/${poolId}/ohlcv/hour`);

  return (response.data?.attributes?.ohlcv_list ?? [])
    .filter(
      (candle): candle is number[] =>
        Array.isArray(candle) && candle.length >= 5
    )
    .map((candle) => ({ timestamp: candle[0], priceUsd: candle[4] }));
}

async function getSettledValue<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function getCachedTokenDetail(mint: string): TokenDetailResponse | null {
  const cached = tokenDetailCache.get(mint);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    tokenDetailCache.delete(mint);
    return null;
  }

  return cached.value;
}

function getCachedTokenMarket(mint: string): TokenMarketResponse | null {
  const cached = tokenMarketCache.get(mint);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    tokenMarketCache.delete(mint);
    return null;
  }

  return cached.value;
}

function setCachedTokenMarket(value: TokenMarketResponse): TokenMarketResponse {
  tokenMarketCache.set(value.mint, {
    expiresAt: Date.now() + TOKEN_DETAIL_CACHE_TTL_MS,
    value,
  });

  return value;
}

function derivePriceChange24hPercent(
  chart: TokenDetailChartPoint[]
): number | null {
  if (chart.length < 2) {
    return null;
  }

  const first = chart[0].priceUsd;
  const last = chart[chart.length - 1].priceUsd;

  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return null;
  }

  return ((last - first) / first) * 100;
}

async function loadChartFor(
  token: CoinGeckoTokenData
): Promise<{ chart: TokenDetailChartPoint[]; volumeOverride: number | null }> {
  if (token.coingeckoCoinId) {
    const result = await getSettledValue(
      fetchCoinGeckoCoinChart(token.coingeckoCoinId)
    );

    if (result && result.points.length > 0) {
      return { chart: result.points, volumeOverride: result.volumeUsd24h };
    }
  }

  if (token.topPoolIds.length > 0) {
    const points = await getSettledValue(
      fetchCoinGeckoPoolOhlcv(token.topPoolIds[0])
    );

    if (points && points.length > 0) {
      return { chart: points, volumeOverride: null };
    }
  }

  return { chart: [], volumeOverride: null };
}

function buildTokenDetailResponse({
  chart,
  info,
  mint,
  token,
  volumeOverride,
}: {
  chart: TokenDetailChartPoint[];
  info: CoinGeckoTokenInfo | null;
  mint: string;
  token: CoinGeckoTokenData | null;
  volumeOverride: number | null;
}): TokenDetailResponse {
  return {
    mint,
    token: {
      decimals: token?.decimals ?? null,
      logoUrl: token?.imageUrl ?? null,
      name: token?.name ?? null,
      symbol: token?.symbol ?? null,
    },
    links: {
      website: info?.websites?.[0] ?? null,
      twitter: info?.twitterHandle
        ? `https://x.com/${info.twitterHandle}`
        : null,
      explorer: `https://solscan.io/token/${mint}`,
      discord: info?.discordUrl ?? null,
      telegram: info?.telegramHandle
        ? `https://t.me/${info.telegramHandle}`
        : null,
    },
    market: {
      fdvUsd: token?.fdvUsd ?? null,
      holderCount: info?.holderCount ?? null,
      liquidityUsd: token?.totalReserveUsd ?? null,
      marketCapUsd: token?.marketCapUsd ?? null,
      priceChange24hPercent: derivePriceChange24hPercent(chart),
      priceUsd: token?.priceUsd ?? null,
      updatedAt: null,
      volume24hUsd: volumeOverride ?? token?.volumeUsd24h ?? null,
    },
    info: {
      description: info?.description ?? null,
      gtScore: info?.gtScore ?? null,
      gtVerified: info?.gtVerified ?? false,
      mintAuthority: info?.mintAuthority ?? null,
      freezeAuthority: info?.freezeAuthority ?? null,
      holderDistribution: info?.holderDistribution ?? null,
    },
    chart,
  };
}

function setCachedTokenDetail(
  detail: TokenDetailResponse
): TokenDetailResponse {
  if (
    detail.chart.length < 2 &&
    typeof detail.market.priceChange24hPercent !== "number"
  ) {
    return detail;
  }

  tokenDetailCache.set(detail.mint, {
    expiresAt: Date.now() + TOKEN_DETAIL_CACHE_TTL_MS,
    value: detail,
  });

  return detail;
}

export async function fetchTokenDetailByMint(
  mint: string
): Promise<TokenDetailResponse> {
  assertCoinGeckoApiKeyConfigured();

  const cached = getCachedTokenDetail(mint);
  if (cached) {
    return cached;
  }

  const inflight = tokenDetailInflight.get(mint);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const [token, info] = await Promise.all([
      getSettledValue(fetchCoinGeckoTokenData(mint)),
      getSettledValue(fetchCoinGeckoTokenInfo(mint)),
    ]);

    const { chart, volumeOverride } = token
      ? await loadChartFor(token)
      : { chart: [] as TokenDetailChartPoint[], volumeOverride: null };

    return setCachedTokenDetail(
      buildTokenDetailResponse({ chart, info, mint, token, volumeOverride })
    );
  })().finally(() => {
    tokenDetailInflight.delete(mint);
  });

  tokenDetailInflight.set(mint, request);
  return request;
}

export async function fetchTokenMarketByMint(
  mint: string
): Promise<TokenMarketResponse> {
  assertCoinGeckoApiKeyConfigured();

  const cached = getCachedTokenMarket(mint);
  if (cached) {
    return cached;
  }

  const inflight = tokenMarketInflight.get(mint);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const token = await getSettledValue(fetchCoinGeckoTokenData(mint));

    return setCachedTokenMarket({
      mint,
      token: {
        decimals: token?.decimals ?? null,
        logoUrl: token?.imageUrl ?? null,
        name: token?.name ?? null,
        symbol: token?.symbol ?? null,
      },
      market: {
        priceUsd: token?.priceUsd ?? null,
      },
    });
  })().finally(() => {
    tokenMarketInflight.delete(mint);
  });

  tokenMarketInflight.set(mint, request);
  return request;
}
