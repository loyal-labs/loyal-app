import { fetchEarnEarningsRangeSet } from "@/hooks/use-earn-earnings";

type EarnEarningsPrefetchScope = {
  revalidationKey: string;
  settingsPda: string;
  solanaEnv: string;
  timezone: string;
  walletAddress: string;
};

type EarnEarningsPrefetchFetcher = (
  cacheKey: string,
  scope: EarnEarningsPrefetchScope
) => Promise<unknown>;

export function getEarnEarningsCacheKey({
  settingsPda,
  solanaEnv,
  walletAddress,
}: Pick<
  EarnEarningsPrefetchScope,
  "settingsPda" | "solanaEnv" | "walletAddress"
>): string {
  return [solanaEnv, walletAddress, settingsPda, "vault-1"].join(":");
}

export function startEarnEarningsPrefetch(
  {
    enabled,
    onError = (error: unknown) => {
      console.warn("[earnings] failed to preload Earn earnings", error);
    },
    revalidationKey,
    settingsPda,
    solanaEnv,
    timezone,
    walletAddress,
  }: EarnEarningsPrefetchScope & {
    enabled: boolean;
    onError?: (error: unknown) => void;
  },
  fetcher: EarnEarningsPrefetchFetcher = fetchEarnEarningsRangeSet
): void {
  if (!enabled) {
    return;
  }

  const cacheKey = `${getEarnEarningsCacheKey({
    settingsPda,
    solanaEnv,
    walletAddress,
  })}:${timezone}`;

  void fetcher(cacheKey, {
    revalidationKey,
    settingsPda,
    solanaEnv,
    timezone,
    walletAddress,
  }).catch(onError);
}
