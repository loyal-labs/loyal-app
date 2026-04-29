import {
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/constants";
import {
  deleteCloudValue,
  getCloudValue,
  setCloudValue,
} from "@/lib/telegram/mini-app/cloud-storage";

import type { SolanaEnv } from "../rpc/types";

const KAMINO_USDC_POSITION_STORAGE_KEY_PREFIX = "kamino_usdc_position_v1";
const EXCHANGE_RATE_SCALE = 18;

export type StoredKaminoUsdcPosition = {
  version: 1;
  mint: string;
  principalLiquidityAmountRaw: string;
  collateralSharesAmountRaw: string;
  cumulativeEarnedLiquidityAmountRaw: string;
  averageEntryExchangeRate: string | null;
  updatedAt: number;
};

function pow10(exponent: number): bigint {
  return BigInt(10) ** BigInt(exponent);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) {
    throw new Error("ceilDiv denominator must be greater than zero");
  }

  if (numerator <= BigInt(0)) {
    return BigInt(0);
  }

  return (numerator + denominator - BigInt(1)) / denominator;
}

function formatScaledBigInt(value: bigint, scale: number): string {
  const whole = value / pow10(scale);
  const fraction = value % pow10(scale);
  const fractionText = fraction
    .toString()
    .padStart(scale, "0")
    .replace(/0+$/, "");

  return fractionText.length > 0
    ? `${whole.toString()}.${fractionText}`
    : whole.toString();
}

function parseStoredPosition(
  value: string,
  mint: string
): StoredKaminoUsdcPosition | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredKaminoUsdcPosition>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (
      parsed.version !== 1 ||
      parsed.mint !== mint ||
      typeof parsed.principalLiquidityAmountRaw !== "string" ||
      typeof parsed.collateralSharesAmountRaw !== "string" ||
      (parsed.cumulativeEarnedLiquidityAmountRaw !== undefined &&
        typeof parsed.cumulativeEarnedLiquidityAmountRaw !== "string") ||
      (parsed.averageEntryExchangeRate !== null &&
        parsed.averageEntryExchangeRate !== undefined &&
        typeof parsed.averageEntryExchangeRate !== "string") ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }

    BigInt(parsed.principalLiquidityAmountRaw);
    BigInt(parsed.collateralSharesAmountRaw);
    BigInt(parsed.cumulativeEarnedLiquidityAmountRaw ?? "0");

    return {
      version: 1,
      mint: parsed.mint,
      principalLiquidityAmountRaw: parsed.principalLiquidityAmountRaw,
      collateralSharesAmountRaw: parsed.collateralSharesAmountRaw,
      cumulativeEarnedLiquidityAmountRaw:
        parsed.cumulativeEarnedLiquidityAmountRaw ?? "0",
      averageEntryExchangeRate: parsed.averageEntryExchangeRate ?? null,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function computeAverageEntryExchangeRate(
  collateralSharesAmountRaw: bigint,
  principalLiquidityAmountRaw: bigint
): string | null {
  if (
    collateralSharesAmountRaw <= BigInt(0) ||
    principalLiquidityAmountRaw <= BigInt(0)
  ) {
    return null;
  }

  const rateScaled =
    (collateralSharesAmountRaw * pow10(EXCHANGE_RATE_SCALE)) /
    principalLiquidityAmountRaw;

  return formatScaledBigInt(rateScaled, EXCHANGE_RATE_SCALE);
}

function createStoredPosition(args: {
  mint: string;
  principalLiquidityAmountRaw: bigint;
  collateralSharesAmountRaw: bigint;
  cumulativeEarnedLiquidityAmountRaw?: bigint;
}): StoredKaminoUsdcPosition {
  return {
    version: 1,
    mint: args.mint,
    principalLiquidityAmountRaw: args.principalLiquidityAmountRaw.toString(),
    collateralSharesAmountRaw: args.collateralSharesAmountRaw.toString(),
    cumulativeEarnedLiquidityAmountRaw: (
      args.cumulativeEarnedLiquidityAmountRaw ?? BigInt(0)
    ).toString(),
    averageEntryExchangeRate: computeAverageEntryExchangeRate(
      args.collateralSharesAmountRaw,
      args.principalLiquidityAmountRaw
    ),
    updatedAt: Date.now(),
  };
}

export function resolveKaminoCumulativeEarnedLiquidityAmountRaw(
  trackedPosition: StoredKaminoUsdcPosition | null
): bigint {
  if (!trackedPosition) {
    return BigInt(0);
  }

  return BigInt(trackedPosition.cumulativeEarnedLiquidityAmountRaw);
}

export function resolveTrackedKaminoUsdcMint(
  solanaEnv: SolanaEnv
): string | null {
  if (solanaEnv === "mainnet") {
    return SOLANA_USDC_MINT_MAINNET;
  }

  if (solanaEnv === "devnet") {
    return SOLANA_USDC_MINT_DEVNET;
  }

  return null;
}

export function getKaminoUsdcPositionStorageKey(
  publicKey: string,
  solanaEnv: SolanaEnv
): string | null {
  const mint = resolveTrackedKaminoUsdcMint(solanaEnv);
  if (!mint) {
    return null;
  }

  return `${KAMINO_USDC_POSITION_STORAGE_KEY_PREFIX}_${publicKey}_${solanaEnv}`;
}

export function applyKaminoShieldToTrackedPosition(args: {
  trackedPosition: StoredKaminoUsdcPosition | null;
  mint: string;
  addedPrincipalLiquidityAmountRaw: bigint;
  addedCollateralSharesAmountRaw: bigint;
}): StoredKaminoUsdcPosition | null {
  if (
    args.addedPrincipalLiquidityAmountRaw <= BigInt(0) ||
    args.addedCollateralSharesAmountRaw <= BigInt(0)
  ) {
    return args.trackedPosition;
  }

  const currentPrincipal = args.trackedPosition
    ? BigInt(args.trackedPosition.principalLiquidityAmountRaw)
    : BigInt(0);
  const currentShares = args.trackedPosition
    ? BigInt(args.trackedPosition.collateralSharesAmountRaw)
    : BigInt(0);
  const cumulativeEarnedLiquidityAmountRaw =
    resolveKaminoCumulativeEarnedLiquidityAmountRaw(args.trackedPosition);

  return createStoredPosition({
    mint: args.mint,
    principalLiquidityAmountRaw:
      currentPrincipal + args.addedPrincipalLiquidityAmountRaw,
    collateralSharesAmountRaw:
      currentShares + args.addedCollateralSharesAmountRaw,
    cumulativeEarnedLiquidityAmountRaw,
  });
}

export function applyKaminoUnshieldToTrackedPosition(args: {
  trackedPosition: StoredKaminoUsdcPosition | null;
  burnedCollateralSharesAmountRaw: bigint;
}): StoredKaminoUsdcPosition | null {
  if (
    !args.trackedPosition ||
    args.burnedCollateralSharesAmountRaw <= BigInt(0)
  ) {
    return args.trackedPosition;
  }

  const trackedPrincipal = BigInt(
    args.trackedPosition.principalLiquidityAmountRaw
  );
  const trackedShares = BigInt(args.trackedPosition.collateralSharesAmountRaw);
  const cumulativeEarnedLiquidityAmountRaw =
    resolveKaminoCumulativeEarnedLiquidityAmountRaw(args.trackedPosition);
  if (
    trackedShares <= BigInt(0) ||
    args.burnedCollateralSharesAmountRaw >= trackedShares
  ) {
    return cumulativeEarnedLiquidityAmountRaw > BigInt(0)
      ? createStoredPosition({
          mint: args.trackedPosition.mint,
          principalLiquidityAmountRaw: BigInt(0),
          collateralSharesAmountRaw: BigInt(0),
          cumulativeEarnedLiquidityAmountRaw,
        })
      : null;
  }

  const remainingShares = trackedShares - args.burnedCollateralSharesAmountRaw;
  const remainingPrincipal = ceilDiv(
    trackedPrincipal * remainingShares,
    trackedShares
  );

  return createStoredPosition({
    mint: args.trackedPosition.mint,
    principalLiquidityAmountRaw: remainingPrincipal,
    collateralSharesAmountRaw: remainingShares,
    cumulativeEarnedLiquidityAmountRaw,
  });
}

// Helpers
function bigintMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
function bigintMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function applyKaminoUnshieldAccounting(args: {
  trackedPosition: StoredKaminoUsdcPosition | null;
  actualCollateralSharesAmountRawBeforeUnshield: bigint;
  currentLiquidityAmountRawBeforeUnshield?: bigint | null;
  burnedCollateralSharesAmountRaw: bigint;
  redeemedLiquidityAmountRaw?: bigint | null;
}): {
  nextTrackedPosition: StoredKaminoUsdcPosition | null;
  realizedPrincipalLiquidityAmountRaw: bigint;
  realizedEarnedLiquidityAmountRaw: bigint;
} {
  const ZERO = BigInt(0);
  const pos = args.trackedPosition;

  if (!pos) {
    return {
      nextTrackedPosition: null,
      realizedPrincipalLiquidityAmountRaw: ZERO,
      realizedEarnedLiquidityAmountRaw: ZERO,
    };
  }

  // Normalize inputs — treat negative/missing values as zero
  const actualShares = bigintMax(
    args.actualCollateralSharesAmountRawBeforeUnshield,
    ZERO
  );
  const burnedShares = bigintMax(args.burnedCollateralSharesAmountRaw, ZERO);
  const redeemed = bigintMax(args.redeemedLiquidityAmountRaw ?? ZERO, ZERO);
  const currentLiquidity = bigintMax(
    args.currentLiquidityAmountRawBeforeUnshield ?? ZERO,
    ZERO
  );

  const cumulativeEarned = resolveKaminoCumulativeEarnedLiquidityAmountRaw(pos);
  const trackedShares = BigInt(pos.collateralSharesAmountRaw);
  const trackedPrincipal = BigInt(pos.principalLiquidityAmountRaw);

  // Early exit: nothing to burn
  if (actualShares <= ZERO || burnedShares <= ZERO) {
    const nextTrackedPosition =
      trackedShares > ZERO || cumulativeEarned > ZERO
        ? createStoredPosition({
            mint: pos.mint,
            principalLiquidityAmountRaw: trackedPrincipal,
            collateralSharesAmountRaw: trackedShares,
            cumulativeEarnedLiquidityAmountRaw: cumulativeEarned,
          })
        : null;
    return {
      nextTrackedPosition,
      realizedPrincipalLiquidityAmountRaw: ZERO,
      realizedEarnedLiquidityAmountRaw: ZERO,
    };
  }

  // --- Split shares into "tracked" (matched to our position) vs "unmatched" ---

  const effectiveTrackedShares = bigintMin(actualShares, trackedShares);
  const unmatchedShares = actualShares - effectiveTrackedShares;

  const effectiveTrackedPrincipal =
    trackedShares <= ZERO || effectiveTrackedShares <= ZERO
      ? ZERO
      : effectiveTrackedShares === trackedShares
      ? trackedPrincipal
      : ceilDiv(trackedPrincipal * effectiveTrackedShares, trackedShares);

  // Split burned shares between unmatched and tracked buckets
  const normalizedBurned = bigintMin(burnedShares, actualShares);
  const burnedUnmatched = bigintMin(normalizedBurned, unmatchedShares);
  const burnedTracked = normalizedBurned - burnedUnmatched;

  // --- Compute remaining tracked position after burn ---

  const remainingTrackedShares = bigintMax(
    effectiveTrackedShares - burnedTracked,
    ZERO
  );
  const remainingTrackedPrincipal =
    effectiveTrackedShares <= ZERO || remainingTrackedShares <= ZERO
      ? ZERO
      : ceilDiv(
          effectiveTrackedPrincipal * remainingTrackedShares,
          effectiveTrackedShares
        );

  const realizedTrackedPrincipal = bigintMax(
    effectiveTrackedPrincipal - remainingTrackedPrincipal,
    ZERO
  );

  // --- Compute principal attributable to burned unmatched shares ---

  let realizedUnmatchedPrincipal = ZERO;
  if (burnedUnmatched > ZERO) {
    if (currentLiquidity > ZERO && unmatchedShares > ZERO) {
      const trackedLiquidity =
        effectiveTrackedShares > ZERO
          ? (currentLiquidity * effectiveTrackedShares) / actualShares
          : ZERO;
      const unmatchedLiquidity = bigintMax(
        currentLiquidity - trackedLiquidity,
        ZERO
      );
      realizedUnmatchedPrincipal = ceilDiv(
        unmatchedLiquidity * burnedUnmatched,
        unmatchedShares
      );
    } else {
      // No reliable liquidity quote — treat entire redeemed amount as principal
      // to avoid overstating all-time earnings.
      realizedUnmatchedPrincipal = redeemed;
    }
  }

  // --- Final realized amounts ---

  const realizedPrincipal =
    realizedTrackedPrincipal + realizedUnmatchedPrincipal;
  const realizedEarned = bigintMax(redeemed - realizedPrincipal, ZERO);
  const nextCumulativeEarned = cumulativeEarned + realizedEarned;

  const nextTrackedPosition =
    remainingTrackedShares > ZERO || nextCumulativeEarned > ZERO
      ? createStoredPosition({
          mint: pos.mint,
          principalLiquidityAmountRaw: remainingTrackedPrincipal,
          collateralSharesAmountRaw: remainingTrackedShares,
          cumulativeEarnedLiquidityAmountRaw: nextCumulativeEarned,
        })
      : null;

  return {
    nextTrackedPosition,
    realizedPrincipalLiquidityAmountRaw: realizedPrincipal,
    realizedEarnedLiquidityAmountRaw: realizedEarned,
  };
}

export function resolveKaminoTotalEarnedLiquidityAmountRaw(args: {
  trackedPosition: StoredKaminoUsdcPosition | null;
  unrealizedEarnedLiquidityAmountRaw?: bigint | null;
}): bigint | null {
  const cumulativeEarnedLiquidityAmountRaw =
    resolveKaminoCumulativeEarnedLiquidityAmountRaw(args.trackedPosition);
  const unrealizedEarnedLiquidityAmountRaw =
    args.unrealizedEarnedLiquidityAmountRaw === undefined ||
    args.unrealizedEarnedLiquidityAmountRaw === null
      ? null
      : args.unrealizedEarnedLiquidityAmountRaw;

  if (
    cumulativeEarnedLiquidityAmountRaw <= BigInt(0) &&
    unrealizedEarnedLiquidityAmountRaw === null
  ) {
    return null;
  }

  return (
    cumulativeEarnedLiquidityAmountRaw +
    (unrealizedEarnedLiquidityAmountRaw ?? BigInt(0))
  );
}

export function resolveKaminoPrincipalLiquidityAmountRaw(args: {
  trackedPosition: StoredKaminoUsdcPosition | null;
  actualCollateralSharesAmountRaw: bigint;
  currentLiquidityAmountRaw: bigint;
}): bigint | null {
  const {
    trackedPosition,
    actualCollateralSharesAmountRaw,
    currentLiquidityAmountRaw,
  } = args;

  if (!trackedPosition) {
    return null;
  }

  const trackedPrincipal = BigInt(trackedPosition.principalLiquidityAmountRaw);
  const trackedShares = BigInt(trackedPosition.collateralSharesAmountRaw);

  if (
    trackedShares <= BigInt(0) ||
    actualCollateralSharesAmountRaw <= BigInt(0)
  ) {
    return BigInt(0);
  }

  if (actualCollateralSharesAmountRaw === trackedShares) {
    return trackedPrincipal;
  }

  if (actualCollateralSharesAmountRaw < trackedShares) {
    return ceilDiv(
      trackedPrincipal * actualCollateralSharesAmountRaw,
      trackedShares
    );
  }

  const trackedCurrentLiquidity =
    (currentLiquidityAmountRaw * trackedShares) /
    actualCollateralSharesAmountRaw;
  const unmatchedCurrentLiquidity =
    currentLiquidityAmountRaw - trackedCurrentLiquidity;

  return trackedPrincipal + unmatchedCurrentLiquidity;
}

export async function loadKaminoUsdcTrackedPosition(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
}): Promise<StoredKaminoUsdcPosition | null> {
  const mint = resolveTrackedKaminoUsdcMint(args.solanaEnv);
  const storageKey = getKaminoUsdcPositionStorageKey(
    args.publicKey,
    args.solanaEnv
  );

  if (!mint || !storageKey) {
    return null;
  }

  const stored = await getCloudValue(storageKey);
  if (typeof stored !== "string" || !stored) {
    return null;
  }

  return parseStoredPosition(stored, mint);
}

export async function recordKaminoUsdcShield(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
  addedPrincipalLiquidityAmountRaw: bigint;
  addedCollateralSharesAmountRaw: bigint;
}): Promise<boolean> {
  const mint = resolveTrackedKaminoUsdcMint(args.solanaEnv);
  const storageKey = getKaminoUsdcPositionStorageKey(
    args.publicKey,
    args.solanaEnv
  );

  if (!mint || !storageKey) {
    return false;
  }

  const current = await loadKaminoUsdcTrackedPosition({
    publicKey: args.publicKey,
    solanaEnv: args.solanaEnv,
  });
  const next = applyKaminoShieldToTrackedPosition({
    trackedPosition: current,
    mint,
    addedPrincipalLiquidityAmountRaw: args.addedPrincipalLiquidityAmountRaw,
    addedCollateralSharesAmountRaw: args.addedCollateralSharesAmountRaw,
  });

  if (!next) {
    return false;
  }

  return setCloudValue(storageKey, JSON.stringify(next));
}

export async function recordKaminoUsdcUnshield(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
  actualCollateralSharesAmountRawBeforeUnshield: bigint;
  currentLiquidityAmountRawBeforeUnshield?: bigint | null;
  burnedCollateralSharesAmountRaw: bigint;
  redeemedLiquidityAmountRaw?: bigint | null;
}): Promise<boolean> {
  const storageKey = getKaminoUsdcPositionStorageKey(
    args.publicKey,
    args.solanaEnv
  );

  if (!storageKey) {
    return false;
  }

  const current = await loadKaminoUsdcTrackedPosition({
    publicKey: args.publicKey,
    solanaEnv: args.solanaEnv,
  });
  const { nextTrackedPosition } = applyKaminoUnshieldAccounting({
    trackedPosition: current,
    actualCollateralSharesAmountRawBeforeUnshield:
      args.actualCollateralSharesAmountRawBeforeUnshield,
    currentLiquidityAmountRawBeforeUnshield:
      args.currentLiquidityAmountRawBeforeUnshield,
    burnedCollateralSharesAmountRaw: args.burnedCollateralSharesAmountRaw,
    redeemedLiquidityAmountRaw: args.redeemedLiquidityAmountRaw,
  });

  if (!nextTrackedPosition) {
    return deleteCloudValue(storageKey);
  }

  return setCloudValue(storageKey, JSON.stringify(nextTrackedPosition));
}
