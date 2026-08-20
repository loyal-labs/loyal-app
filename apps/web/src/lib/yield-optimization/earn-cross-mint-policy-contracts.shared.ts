export const DEFAULT_AUTOSWAP_MAX_SLIPPAGE_BPS = 50;
export const DEFAULT_AUTOSWAP_DAILY_CAP_RAW = BigInt(100_000_000);
export const MIN_AUTOSWAP_DAILY_CAP_RAW = BigInt(1_000_000);
export const MAX_AUTOSWAP_DAILY_CAP_RAW = BigInt(1_000_000_000);

export type EarnCrossMintToggleRequest = {
  enabled: boolean;
  expectedGeneration: string;
};

export type EarnCrossMintToggleResponse = {
  enabled: boolean;
  generation: string;
  status: "on" | "paused";
};
