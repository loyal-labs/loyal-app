import type { recordedKaminoValuation } from "./kamino-valuation";
export type ConvertedAmount = { raw: string; mint: string; decimals: number; observedSlot: number; lastUpdateSlot: string; freshness: "fresh" | "stale"; rounding: "down" | "up" };
/** Chain observations, never a catalog of supported routes or a NAV estimate. */
export type KaminoExposureView = Readonly<{
  observedSlot: number;
  observedAt: string;
  owner: string;
  coverage: "owner-scan";
  positions: readonly Readonly<{
    address: string;
    market: string;
    tag: string;
    lastUpdateSlot: string;
    ageSlots: string;
    freshness: "fresh" | "stale";
    funded: boolean;
    recordedValuation?: ReturnType<typeof recordedKaminoValuation>;
    deposits: readonly { reserve: string; collateralRaw: string; tokenAmount?: ConvertedAmount; conversionUnavailable?: string }[];
    borrows: readonly { reserve: string; borrowedAmountSf: string; tokenAmount?: ConvertedAmount; conversionUnavailable?: string }[];
  }>[];
  unrecognized: readonly { address: string; reason: string }[];
}>;
