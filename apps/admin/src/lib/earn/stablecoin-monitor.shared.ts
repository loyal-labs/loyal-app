import { Stablecoin, STABLECOIN_MINTS } from "@loyal-labs/actions";

export const STABLECOIN_DECIMALS = 6;

export const EARN_STABLECOIN_DESCRIPTORS = Object.freeze(
  Object.values(Stablecoin).map((symbol) => ({
    decimals: STABLECOIN_DECIMALS,
    mint: STABLECOIN_MINTS[symbol].toBase58(),
    symbol,
  }))
);

export type EarnStablecoinSymbol = Stablecoin;
export type StablecoinHealthWarningCode = "no_eligible_reserve";

export type StablecoinHealthWarning = {
  code: StablecoinHealthWarningCode;
  level: "info" | "warning" | "critical";
  message: string;
};

export type StablecoinHealthWarningInput = {
  eligibleReserveCount: number;
  eligibilityReason: string;
  symbol: EarnStablecoinSymbol;
};

const DESCRIPTOR_BY_MINT = new Map(
  EARN_STABLECOIN_DESCRIPTORS.map((descriptor) => [descriptor.mint, descriptor])
);
const DESCRIPTOR_BY_SYMBOL = new Map(
  EARN_STABLECOIN_DESCRIPTORS.map((descriptor) => [
    descriptor.symbol,
    descriptor,
  ])
);

export function getEarnStablecoinByMint(mint: string) {
  return DESCRIPTOR_BY_MINT.get(mint) ?? null;
}

export function getEarnStablecoinBySymbol(symbol: string) {
  return DESCRIPTOR_BY_SYMBOL.get(symbol as EarnStablecoinSymbol) ?? null;
}

export function getEarnStablecoinSymbol(mint: string | null | undefined) {
  if (!mint) {
    return null;
  }

  return getEarnStablecoinByMint(mint)?.symbol ?? null;
}

export function deriveStablecoinHealthWarnings(
  input: StablecoinHealthWarningInput
): StablecoinHealthWarning[] {
  return input.eligibleReserveCount === 0
    ? [
        {
          code: "no_eligible_reserve",
          level: "critical",
          message: `${input.symbol} has no eligible Safe reserve: ${input.eligibilityReason}.`,
        },
      ]
    : [];
}
