export type EarnDetailHeaderActionMode =
  | "cleanup"
  | "deposit-only"
  | "position";

export type EarnPortfolioOpenTarget = "earn" | "earnDeposit";

export function hasEarnCleanupCandidate({
  hasEarnPolicy,
  hasEarnPosition,
}: {
  hasEarnPolicy: boolean;
  hasEarnPosition: boolean;
}): boolean {
  return hasEarnPolicy && !hasEarnPosition;
}

export function resolveEarnDetailHeaderActionMode({
  hasCleanupCandidate,
  hasCurrentPosition,
}: {
  hasCleanupCandidate: boolean;
  hasCurrentPosition: boolean;
}): EarnDetailHeaderActionMode {
  if (hasCurrentPosition) {
    return "position";
  }
  return hasCleanupCandidate ? "cleanup" : "deposit-only";
}

export function resolveEarnPortfolioOpenTarget({
  hasEarnPolicy,
  hasEarnPosition,
  isEarnPositionInitialLoading,
}: {
  hasEarnPolicy: boolean;
  hasEarnPosition: boolean;
  isEarnPositionInitialLoading: boolean;
}): EarnPortfolioOpenTarget {
  return hasEarnPosition || hasEarnPolicy || isEarnPositionInitialLoading
    ? "earn"
    : "earnDeposit";
}
