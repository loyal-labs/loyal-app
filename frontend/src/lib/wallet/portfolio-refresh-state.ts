export type PortfolioFreshness =
  | "loading"
  | "current"
  | "stale"
  | "unavailable";

export type PortfolioRefreshState<TSnapshot> = {
  error: string | null;
  snapshot: TSnapshot | null;
};

export type PortfolioBalanceDisplay = {
  balanceFraction: string;
  balanceWhole: string;
};

export function createPortfolioRefreshState<TSnapshot>(
  snapshot: TSnapshot | null = null
): PortfolioRefreshState<TSnapshot> {
  return { error: null, snapshot };
}

export function markPortfolioRefreshSucceeded<TSnapshot>(
  snapshot: TSnapshot
): PortfolioRefreshState<TSnapshot> {
  return { error: null, snapshot };
}

export function markPortfolioRefreshFailed<TSnapshot>(
  current: PortfolioRefreshState<TSnapshot>,
  error: unknown
): PortfolioRefreshState<TSnapshot> {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Wallet balances could not be refreshed";

  return {
    error: message,
    snapshot: current.snapshot,
  };
}

export function getPortfolioFreshness<TSnapshot>(
  state: PortfolioRefreshState<TSnapshot>,
  isLoading: boolean
): PortfolioFreshness {
  if (state.error) {
    return state.snapshot ? "stale" : "unavailable";
  }

  if (isLoading && !state.snapshot) {
    return "loading";
  }

  return "current";
}

export function getPortfolioBalanceDisplay(
  freshness: PortfolioFreshness,
  confirmed: PortfolioBalanceDisplay
): PortfolioBalanceDisplay {
  return freshness === "unavailable"
    ? { balanceFraction: "", balanceWhole: "$—" }
    : confirmed;
}
