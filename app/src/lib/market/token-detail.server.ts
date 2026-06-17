import "server-only";

import {
  type CoinGeckoChartPoint,
  type CoinGeckoTokenData,
  type CoinGeckoTokenInfo,
  fetchCoinGeckoCoinChart,
  fetchCoinGeckoPoolOhlcv,
  fetchCoinGeckoTokenData,
  fetchCoinGeckoTokenInfo,
} from "@/lib/market/coingecko.server";

const TOKEN_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

export type MobileTokenDetailChartPoint = CoinGeckoChartPoint;

export type MobileTokenDetailLinks = {
  website: string | null;
  twitter: string | null;
  explorer: string | null;
  discord: string | null;
  telegram: string | null;
};

export type MobileTokenDetailMarket = {
  fdvUsd: number | null;
  holderCount: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  priceChange24hPercent: number | null;
  priceUsd: number | null;
  updatedAt: string | null;
  volume24hUsd: number | null;
};

export type MobileTokenDetailInfo = {
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

export type MobileTokenDetailResponse = {
  mint: string;
  token: {
    decimals: number | null;
    logoUrl: string | null;
    name: string | null;
    symbol: string | null;
  };
  links: MobileTokenDetailLinks;
  market: MobileTokenDetailMarket;
  info: MobileTokenDetailInfo;
  chart: MobileTokenDetailChartPoint[];
};

type TokenDetailCacheEntry = {
  expiresAt: number;
  value: MobileTokenDetailResponse;
};

const tokenDetailCache = new Map<string, TokenDetailCacheEntry>();
const tokenDetailInflight = new Map<
  string,
  Promise<MobileTokenDetailResponse>
>();

async function getSettledValue<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function getCachedTokenDetail(mint: string): MobileTokenDetailResponse | null {
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

function canCacheTokenDetail(detail: MobileTokenDetailResponse): boolean {
  return (
    (typeof detail.market.priceChange24hPercent === "number" &&
      Number.isFinite(detail.market.priceChange24hPercent)) ||
    detail.chart.length >= 2
  );
}

function setCachedTokenDetail(
  detail: MobileTokenDetailResponse
): MobileTokenDetailResponse {
  if (!canCacheTokenDetail(detail)) {
    return detail;
  }

  tokenDetailCache.set(detail.mint, {
    expiresAt: Date.now() + TOKEN_DETAIL_CACHE_TTL_MS,
    value: detail,
  });

  return detail;
}

function derivePriceChange24hPercent(
  chart: MobileTokenDetailChartPoint[]
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

async function loadChartFor(token: CoinGeckoTokenData): Promise<{
  chart: MobileTokenDetailChartPoint[];
  volumeOverride: number | null;
}> {
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

function buildResponse(
  mint: string,
  token: CoinGeckoTokenData | null,
  info: CoinGeckoTokenInfo | null,
  chart: MobileTokenDetailChartPoint[],
  volumeOverride: number | null
): MobileTokenDetailResponse {
  const websiteFromInfo = info?.websites?.[0] ?? null;

  return {
    mint,
    token: {
      decimals: token?.decimals ?? null,
      logoUrl: token?.imageUrl ?? null,
      name: token?.name ?? null,
      symbol: token?.symbol ?? null,
    },
    links: {
      website: websiteFromInfo,
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

export async function fetchTokenDetailByMint(
  mint: string
): Promise<MobileTokenDetailResponse> {
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
      : { chart: [] as MobileTokenDetailChartPoint[], volumeOverride: null };

    return setCachedTokenDetail(
      buildResponse(mint, token, info, chart, volumeOverride)
    );
  })().finally(() => {
    tokenDetailInflight.delete(mint);
  });

  tokenDetailInflight.set(mint, request);
  return request;
}
