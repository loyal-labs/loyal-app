import { describe, expect, mock, test } from "bun:test";

import {
  getEarnEarningsCacheKey,
  startEarnEarningsPrefetch,
} from "@/components/wallet-workspace/facelift/earn-earnings-prefetch";

const PREFETCH_SCOPE = {
  revalidationKey: "1250000",
  settingsPda: "settings-pda",
  solanaEnv: "mainnet",
  timezone: "America/Los_Angeles",
  walletAddress: "wallet-address",
};

describe("Earn earnings prefetch", () => {
  test("uses the chart cache-key recipe", () => {
    expect(getEarnEarningsCacheKey(PREFETCH_SCOPE)).toBe(
      "mainnet:wallet-address:settings-pda:vault-1"
    );
  });

  test("starts in the background without returning the request", () => {
    const fetcher = mock(() => new Promise<unknown>(() => undefined));

    const result = startEarnEarningsPrefetch(
      { ...PREFETCH_SCOPE, enabled: true },
      fetcher
    );

    expect(result).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      "mainnet:wallet-address:settings-pda:vault-1:America/Los_Angeles",
      PREFETCH_SCOPE
    );
  });

  test("does not fetch before the position is ready", () => {
    const fetcher = mock(() => Promise.resolve());

    startEarnEarningsPrefetch({ ...PREFETCH_SCOPE, enabled: false }, fetcher);

    expect(fetcher).not.toHaveBeenCalled();
  });

  test("contains background failures", async () => {
    const error = new Error("unavailable");
    const onError = mock(() => undefined);

    startEarnEarningsPrefetch(
      { ...PREFETCH_SCOPE, enabled: true, onError },
      () => Promise.reject(error)
    );
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
  });
});
