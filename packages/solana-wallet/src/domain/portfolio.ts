import { NATIVE_SOL_MINT } from "../constants";
import type {
  AssetSnapshot,
  PortfolioHolding,
  PortfolioPosition,
  PortfolioSnapshot,
  PortfolioTotals,
  SecureBalanceMap,
} from "../types";

function floorToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
}

function resolveValueUsd(args: {
  balance: number;
  priceUsd: number | null;
  providedValueUsd: number | null;
}): number | null {
  if (args.balance === 0) {
    return 0;
  }

  if (
    typeof args.providedValueUsd === "number" &&
    Number.isFinite(args.providedValueUsd)
  ) {
    return args.providedValueUsd;
  }

  if (typeof args.priceUsd === "number" && Number.isFinite(args.priceUsd)) {
    return args.balance * args.priceUsd;
  }

  return null;
}

function resolveEffectivePriceUsd(args: {
  balance: number;
  providedValueUsd: number | null;
  priceUsd: number | null;
}): number | null {
  if (typeof args.priceUsd === "number" && Number.isFinite(args.priceUsd)) {
    return args.priceUsd;
  }

  if (
    args.balance > 0 &&
    typeof args.providedValueUsd === "number" &&
    Number.isFinite(args.providedValueUsd)
  ) {
    return args.providedValueUsd / args.balance;
  }

  return null;
}

function comparePositions(left: PortfolioPosition, right: PortfolioPosition): number {
  const valueDelta = (right.totalValueUsd ?? -1) - (left.totalValueUsd ?? -1);
  if (valueDelta !== 0) {
    return valueDelta;
  }

  const symbolCompare = left.asset.symbol.localeCompare(right.asset.symbol);
  if (symbolCompare !== 0) {
    return symbolCompare;
  }

  return left.asset.mint.localeCompare(right.asset.mint);
}

export function computePortfolioTotals(
  positions: PortfolioPosition[],
  fallbackSolPriceUsd: number | null
): PortfolioTotals {
  let totalUsd = 0;
  let pricedCount = 0;
  let unpricedCount = 0;

  for (const position of positions) {
    if (
      typeof position.totalValueUsd === "number" &&
      Number.isFinite(position.totalValueUsd)
    ) {
      totalUsd += position.totalValueUsd;
      pricedCount += 1;
      continue;
    }

    if (position.totalBalance > 0) {
      unpricedCount += 1;
    }
  }

  const nativePosition = positions.find(
    (position) => position.asset.mint === NATIVE_SOL_MINT
  );

  const effectiveSolPriceUsd =
    typeof nativePosition?.priceUsd === "number" &&
    Number.isFinite(nativePosition.priceUsd)
      ? nativePosition.priceUsd
      : typeof fallbackSolPriceUsd === "number" &&
          Number.isFinite(fallbackSolPriceUsd)
        ? fallbackSolPriceUsd
        : null;

  totalUsd = floorToDecimals(totalUsd, 2);

  return {
    totalUsd,
    totalSol:
      effectiveSolPriceUsd && effectiveSolPriceUsd > 0
        ? floorToDecimals(totalUsd / effectiveSolPriceUsd, 4)
        : null,
    pricedCount,
    unpricedCount,
    effectiveSolPriceUsd,
  };
}

export function buildPortfolioSnapshot(args: {
  assetSnapshot: AssetSnapshot;
  secureBalances?: SecureBalanceMap;
  fallbackSolPriceUsd?: number | null;
}): PortfolioSnapshot {
  const secureBalances = args.secureBalances ?? new Map<string, bigint>();
  const positions: PortfolioPosition[] = args.assetSnapshot.assets.map(
    (assetBalance) => {
      const secureRaw = secureBalances.get(assetBalance.asset.mint) ?? BigInt(0);
      const securedBalance =
        Number(secureRaw) / Math.pow(10, assetBalance.asset.decimals);
      const publicValueUsd = resolveValueUsd({
        balance: assetBalance.balance,
        priceUsd: assetBalance.priceUsd,
        providedValueUsd: assetBalance.valueUsd,
      });
      const effectivePriceUsd = resolveEffectivePriceUsd({
        balance: assetBalance.balance,
        providedValueUsd: publicValueUsd,
        priceUsd: assetBalance.priceUsd,
      });
      const securedValueUsd = resolveValueUsd({
        balance: securedBalance,
        priceUsd: effectivePriceUsd,
        providedValueUsd: null,
      });

      return {
        asset: assetBalance.asset,
        publicBalance: assetBalance.balance,
        securedBalance,
        totalBalance: assetBalance.balance + securedBalance,
        priceUsd: effectivePriceUsd,
        publicValueUsd,
        securedValueUsd,
        totalValueUsd:
          publicValueUsd === null || securedValueUsd === null
            ? publicValueUsd === null && securedValueUsd === null
              ? null
              : publicValueUsd === null
                ? securedValueUsd
                : publicValueUsd
            : publicValueUsd + securedValueUsd,
      };
    }
  );

  positions.sort(comparePositions);

  return {
    owner: args.assetSnapshot.owner,
    nativeBalanceLamports: args.assetSnapshot.nativeBalanceLamports,
    positions,
    totals: computePortfolioTotals(
      positions,
      args.fallbackSolPriceUsd ?? null
    ),
    fetchedAt: args.assetSnapshot.fetchedAt,
  };
}

export function flattenPortfolioPositions(
  positions: PortfolioPosition[],
  options: {
    splitSecuredBalances?: boolean;
    includeZeroBalances?: boolean;
  } = {}
): PortfolioHolding[] {
  const splitSecuredBalances = options.splitSecuredBalances ?? false;
  const includeZeroBalances = options.includeZeroBalances ?? false;
  const holdings: PortfolioHolding[] = [];

  for (const position of positions) {
    if (splitSecuredBalances) {
      if (position.publicBalance > 0 || includeZeroBalances) {
        holdings.push({
          mint: position.asset.mint,
          symbol: position.asset.symbol,
          name: position.asset.name,
          balance: position.publicBalance,
          decimals: position.asset.decimals,
          priceUsd: position.priceUsd,
          valueUsd: position.publicValueUsd,
          imageUrl: position.asset.imageUrl,
          isNative: position.asset.isNative,
          kind: "public",
        });
      }

      if (position.securedBalance > 0 || includeZeroBalances) {
        holdings.push({
          mint: position.asset.mint,
          symbol: position.asset.symbol,
          name: position.asset.name,
          balance: position.securedBalance,
          decimals: position.asset.decimals,
          priceUsd: position.priceUsd,
          valueUsd: position.securedValueUsd,
          imageUrl: position.asset.imageUrl,
          isNative: position.asset.isNative,
          kind: "secured",
          isSecured: true,
        });
      }

      continue;
    }

    if (position.totalBalance > 0 || includeZeroBalances) {
      holdings.push({
        mint: position.asset.mint,
        symbol: position.asset.symbol,
        name: position.asset.name,
        balance: position.totalBalance,
        decimals: position.asset.decimals,
        priceUsd: position.priceUsd,
        valueUsd: position.totalValueUsd,
        imageUrl: position.asset.imageUrl,
        isNative: position.asset.isNative,
        kind: "total",
        isSecured: position.publicBalance === 0 && position.securedBalance > 0,
      });
    }
  }

  return holdings;
}
