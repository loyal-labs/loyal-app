import { describe, expect, test } from "bun:test";

import {
  hasEarnCleanupCandidate,
  resolveEarnDetailHeaderActionMode,
  resolveEarnPortfolioOpenTarget,
} from "./earn-cleanup-ui-state";

describe("earn cleanup UI state", () => {
  test("treats zero-balance active policy as cleanup-capable", () => {
    expect(
      hasEarnCleanupCandidate({
        hasEarnPolicy: true,
        hasEarnPosition: false,
      })
    ).toBe(true);
    expect(
      resolveEarnDetailHeaderActionMode({
        hasCleanupCandidate: true,
        hasCurrentPosition: false,
      })
    ).toBe("cleanup");
    expect(
      resolveEarnPortfolioOpenTarget({
        hasEarnPolicy: true,
        hasEarnPosition: false,
        isEarnPositionInitialLoading: false,
      })
    ).toBe("earn");
  });

  test("keeps true empty Earn state deposit-only", () => {
    expect(
      hasEarnCleanupCandidate({
        hasEarnPolicy: false,
        hasEarnPosition: false,
      })
    ).toBe(false);
    expect(
      resolveEarnDetailHeaderActionMode({
        hasCleanupCandidate: false,
        hasCurrentPosition: false,
      })
    ).toBe("deposit-only");
    expect(
      resolveEarnPortfolioOpenTarget({
        hasEarnPolicy: false,
        hasEarnPosition: false,
        isEarnPositionInitialLoading: false,
      })
    ).toBe("earnDeposit");
  });

  test("keeps active positions in normal withdraw/deposit mode", () => {
    expect(
      resolveEarnDetailHeaderActionMode({
        hasCleanupCandidate: false,
        hasCurrentPosition: true,
      })
    ).toBe("position");
    expect(
      resolveEarnPortfolioOpenTarget({
        hasEarnPolicy: false,
        hasEarnPosition: true,
        isEarnPositionInitialLoading: false,
      })
    ).toBe("earn");
  });
});
