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
      (parsed.averageEntryExchangeRate !== null &&
        parsed.averageEntryExchangeRate !== undefined &&
        typeof parsed.averageEntryExchangeRate !== "string") ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }

    BigInt(parsed.principalLiquidityAmountRaw);
    BigInt(parsed.collateralSharesAmountRaw);

    return {
      version: 1,
      mint: parsed.mint,
      principalLiquidityAmountRaw: parsed.principalLiquidityAmountRaw,
      collateralSharesAmountRaw: parsed.collateralSharesAmountRaw,
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
}): StoredKaminoUsdcPosition {
  return {
    version: 1,
    mint: args.mint,
    principalLiquidityAmountRaw: args.principalLiquidityAmountRaw.toString(),
    collateralSharesAmountRaw: args.collateralSharesAmountRaw.toString(),
    averageEntryExchangeRate: computeAverageEntryExchangeRate(
      args.collateralSharesAmountRaw,
      args.principalLiquidityAmountRaw
    ),
    updatedAt: Date.now(),
  };
}

export function resolveTrackedKaminoUsdcMint(solanaEnv: SolanaEnv): string | null {
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

  return createStoredPosition({
    mint: args.mint,
    principalLiquidityAmountRaw:
      currentPrincipal + args.addedPrincipalLiquidityAmountRaw,
    collateralSharesAmountRaw: currentShares + args.addedCollateralSharesAmountRaw,
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

  const trackedPrincipal = BigInt(args.trackedPosition.principalLiquidityAmountRaw);
  const trackedShares = BigInt(args.trackedPosition.collateralSharesAmountRaw);
  if (
    trackedShares <= BigInt(0) ||
    args.burnedCollateralSharesAmountRaw >= trackedShares
  ) {
    return null;
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
  });
}

export function resolveKaminoPrincipalLiquidityAmountRaw(args: {
  trackedPosition: StoredKaminoUsdcPosition | null;
  actualCollateralSharesAmountRaw: bigint;
  currentLiquidityAmountRaw: bigint;
}): bigint | null {
  const { trackedPosition, actualCollateralSharesAmountRaw, currentLiquidityAmountRaw } =
    args;

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
    (currentLiquidityAmountRaw * trackedShares) / actualCollateralSharesAmountRaw;
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
  burnedCollateralSharesAmountRaw: bigint;
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
  const next = applyKaminoUnshieldToTrackedPosition({
    trackedPosition: current,
    burnedCollateralSharesAmountRaw: args.burnedCollateralSharesAmountRaw,
  });

  if (!next) {
    return deleteCloudValue(storageKey);
  }

  return setCloudValue(storageKey, JSON.stringify(next));
}
