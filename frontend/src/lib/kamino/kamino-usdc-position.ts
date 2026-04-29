import type { SolanaEnv } from "@loyal-labs/solana-rpc";

const KAMINO_USDC_POSITION_STORAGE_KEY_PREFIX = "loyal:kamino_usdc_position_v1";

const SOLANA_USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export type StoredKaminoUsdcPosition = {
  version: 1;
  mint: string;
  principalLiquidityAmountRaw: string;
  collateralSharesAmountRaw: string;
  averageEntryExchangeRate: string | null;
  updatedAt: number;
};

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) {
    throw new Error("ceilDiv denominator must be greater than zero");
  }

  if (numerator <= BigInt(0)) {
    return BigInt(0);
  }

  return (numerator + denominator - BigInt(1)) / denominator;
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

  return `${KAMINO_USDC_POSITION_STORAGE_KEY_PREFIX}:${publicKey}:${solanaEnv}`;
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

export function loadKaminoUsdcTrackedPosition(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
}): StoredKaminoUsdcPosition | null {
  if (typeof window === "undefined") {
    return null;
  }

  const mint = resolveTrackedKaminoUsdcMint(args.solanaEnv);
  const storageKey = getKaminoUsdcPositionStorageKey(
    args.publicKey,
    args.solanaEnv
  );

  if (!mint || !storageKey) {
    return null;
  }

  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }

  if (!stored) {
    return null;
  }

  return parseStoredPosition(stored, mint);
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
    averageEntryExchangeRate: null,
    updatedAt: Date.now(),
  };
}

function applyKaminoShieldToTrackedPosition(args: {
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
    collateralSharesAmountRaw:
      currentShares + args.addedCollateralSharesAmountRaw,
  });
}

function applyKaminoUnshieldToTrackedPosition(args: {
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

function writeStoredPosition(
  storageKey: string,
  value: StoredKaminoUsdcPosition | null
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (value === null) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    }
    return true;
  } catch {
    return false;
  }
}

export function recordKaminoUsdcShield(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
  addedPrincipalLiquidityAmountRaw: bigint;
  addedCollateralSharesAmountRaw: bigint;
}): boolean {
  const mint = resolveTrackedKaminoUsdcMint(args.solanaEnv);
  const storageKey = getKaminoUsdcPositionStorageKey(
    args.publicKey,
    args.solanaEnv
  );

  if (!mint || !storageKey) {
    return false;
  }

  const current = loadKaminoUsdcTrackedPosition({
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

  return writeStoredPosition(storageKey, next);
}

export function recordKaminoUsdcUnshield(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
  burnedCollateralSharesAmountRaw: bigint;
}): boolean {
  const storageKey = getKaminoUsdcPositionStorageKey(
    args.publicKey,
    args.solanaEnv
  );

  if (!storageKey) {
    return false;
  }

  const current = loadKaminoUsdcTrackedPosition({
    publicKey: args.publicKey,
    solanaEnv: args.solanaEnv,
  });
  const next = applyKaminoUnshieldToTrackedPosition({
    trackedPosition: current,
    burnedCollateralSharesAmountRaw: args.burnedCollateralSharesAmountRaw,
  });

  // next === null means the position was fully unshielded → clear storage.
  return writeStoredPosition(storageKey, next);
}
