import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const PAUSED = "paused_missing_position";

function makeTarget(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    lifecycleStatus: "active",
    policyAccount: "policy-account",
    ...overrides,
  };
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    policy: null,
    status: "active",
    target: makeTarget(),
    ...overrides,
  };
}

const hasActiveEarnRoutePolicyPair = mock(async () => true);
const markAutodepositTargetPausedMissingPosition = mock(async () =>
  makeTarget({ active: false, lifecycleStatus: PAUSED })
);
const resumeAutodepositTargetFromMissingPosition = mock(async () =>
  makeTarget()
);
const suppressEarnAutodepositScheduledSweepsForMissingPosition = mock(
  async () => ({ canceledSlotCount: 0, suppressedLotCount: 0 })
);

mock.module("@/lib/yield-optimization/earn-position-gate.server", () => ({
  hasActiveEarnRoutePolicyPair,
}));

// The real resolver's logic is duplicated here because mock.module replaces
// the whole repository module; keep in sync with resolveEarnAutodepositStatus.
mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION: PAUSED,
    markAutodepositTargetPausedMissingPosition,
    resolveEarnAutodepositStatus: (target: {
      active: boolean;
      lifecycleStatus: string;
    }) => {
      if (target.lifecycleStatus === "active") {
        return target.active ? "active" : "paused";
      }
      return target.lifecycleStatus === PAUSED ? "paused" : "pending";
    },
    resumeAutodepositTargetFromMissingPosition,
    suppressEarnAutodepositScheduledSweepsForMissingPosition,
  })
);

const {
  deriveEarnAutodepositPositionPause,
  reconcileEarnAutodepositPositionPause,
} = await import(
  "@/lib/yield-optimization/earn-autodeposit-position-pause.server"
);

const baseArgs = {
  cluster: "mainnet-beta",
  settingsPda: "settings",
  vaultIndex: 1 as const,
  walletAddress: "wallet",
};

describe("reconcileEarnAutodepositPositionPause", () => {
  beforeEach(() => {
    hasActiveEarnRoutePolicyPair.mockClear();
    hasActiveEarnRoutePolicyPair.mockResolvedValue(true);
    markAutodepositTargetPausedMissingPosition.mockClear();
    markAutodepositTargetPausedMissingPosition.mockResolvedValue(
      makeTarget({ active: false, lifecycleStatus: PAUSED })
    );
    resumeAutodepositTargetFromMissingPosition.mockClear();
    resumeAutodepositTargetFromMissingPosition.mockResolvedValue(makeTarget());
    suppressEarnAutodepositScheduledSweepsForMissingPosition.mockClear();
  });

  test("pauses an active target when the policy pair is gone", async () => {
    hasActiveEarnRoutePolicyPair.mockResolvedValue(false);

    const result = await reconcileEarnAutodepositPositionPause({
      ...baseArgs,
      state: makeState() as never,
    });

    expect(markAutodepositTargetPausedMissingPosition).toHaveBeenCalledTimes(1);
    expect(
      suppressEarnAutodepositScheduledSweepsForMissingPosition
    ).toHaveBeenCalledTimes(1);
    expect(result.resumed).toBe(false);
    expect(result.state.status).toBe("paused");
    expect(result.state.target.lifecycleStatus).toBe(PAUSED);
  });

  test("leaves an active target alone while the policy pair exists", async () => {
    const state = makeState();

    const result = await reconcileEarnAutodepositPositionPause({
      ...baseArgs,
      state: state as never,
    });

    expect(markAutodepositTargetPausedMissingPosition).not.toHaveBeenCalled();
    expect(result.state).toEqual(state as never);
  });

  test("resumes a paused target once the policy pair is back", async () => {
    const result = await reconcileEarnAutodepositPositionPause({
      ...baseArgs,
      state: makeState({
        status: "paused",
        target: makeTarget({ active: false, lifecycleStatus: PAUSED }),
      }) as never,
    });

    expect(resumeAutodepositTargetFromMissingPosition).toHaveBeenCalledTimes(1);
    expect(result.resumed).toBe(true);
    expect(result.state.status).toBe("active");
  });

  test("keeps a paused target paused while the pair is missing", async () => {
    hasActiveEarnRoutePolicyPair.mockResolvedValue(false);

    const result = await reconcileEarnAutodepositPositionPause({
      ...baseArgs,
      state: makeState({
        status: "paused",
        target: makeTarget({ active: false, lifecycleStatus: PAUSED }),
      }) as never,
    });

    expect(resumeAutodepositTargetFromMissingPosition).not.toHaveBeenCalled();
    expect(result.resumed).toBe(false);
    expect(result.state.status).toBe("paused");
  });

  test("skips pending and user-toggled-off targets entirely", async () => {
    for (const state of [
      makeState({
        status: "pending",
        target: makeTarget({ lifecycleStatus: "pending_delegation" }),
      }),
      makeState({ status: "paused", target: makeTarget({ active: false }) }),
    ]) {
      const result = await reconcileEarnAutodepositPositionPause({
        ...baseArgs,
        state: state as never,
      });
      expect(result.state).toEqual(state as never);
    }
    expect(hasActiveEarnRoutePolicyPair).not.toHaveBeenCalled();
    expect(markAutodepositTargetPausedMissingPosition).not.toHaveBeenCalled();
  });

  test("does not cancel sweeps when the pause write lost a race", async () => {
    hasActiveEarnRoutePolicyPair.mockResolvedValue(false);
    markAutodepositTargetPausedMissingPosition.mockResolvedValue(
      makeTarget({ active: false, lifecycleStatus: "closed" })
    );

    const result = await reconcileEarnAutodepositPositionPause({
      ...baseArgs,
      state: makeState() as never,
    });

    expect(
      suppressEarnAutodepositScheduledSweepsForMissingPosition
    ).not.toHaveBeenCalled();
    expect(result.state.status).toBe("pending");
  });
});

// Workers-v2 read mode: the same effective pause, derived — no write may
// occur, and the persisted target row (desired enablement + chain status)
// must come back untouched.
describe("deriveEarnAutodepositPositionPause", () => {
  beforeEach(() => {
    hasActiveEarnRoutePolicyPair.mockClear();
    hasActiveEarnRoutePolicyPair.mockResolvedValue(true);
    markAutodepositTargetPausedMissingPosition.mockClear();
    resumeAutodepositTargetFromMissingPosition.mockClear();
    suppressEarnAutodepositScheduledSweepsForMissingPosition.mockClear();
  });

  test("derives a paused state for an active target whose policy pair is gone, without writing", async () => {
    hasActiveEarnRoutePolicyPair.mockResolvedValue(false);
    const state = makeState();

    const result = await deriveEarnAutodepositPositionPause({
      ...baseArgs,
      state: state as never,
    });

    expect(result.pauseReason).toBe("missing_position");
    expect(result.state.status).toBe("paused");
    // Desired enablement and chain status stay exactly as persisted.
    expect(result.state.target.active).toBe(true);
    expect(result.state.target.lifecycleStatus).toBe("active");
    // The derivation must not hand back a mutated input either.
    expect(state.status).toBe("active");
    expect(markAutodepositTargetPausedMissingPosition).not.toHaveBeenCalled();
    expect(
      suppressEarnAutodepositScheduledSweepsForMissingPosition
    ).not.toHaveBeenCalled();
    expect(resumeAutodepositTargetFromMissingPosition).not.toHaveBeenCalled();
  });

  test("reports no pause while the policy pair exists", async () => {
    const state = makeState();

    const result = await deriveEarnAutodepositPositionPause({
      ...baseArgs,
      state: state as never,
    });

    expect(result.pauseReason).toBeNull();
    expect(result.state).toEqual(state as never);
    expect(markAutodepositTargetPausedMissingPosition).not.toHaveBeenCalled();
    expect(resumeAutodepositTargetFromMissingPosition).not.toHaveBeenCalled();
  });

  test("reports a still-persisted pause as missing while the pair is gone, without resuming", async () => {
    hasActiveEarnRoutePolicyPair.mockResolvedValue(false);
    const state = makeState({
      status: "paused",
      target: makeTarget({ active: false, lifecycleStatus: PAUSED }),
    });

    const result = await deriveEarnAutodepositPositionPause({
      ...baseArgs,
      state: state as never,
    });

    expect(result.pauseReason).toBe("missing_position");
    expect(result.state).toEqual(state as never);
    expect(resumeAutodepositTargetFromMissingPosition).not.toHaveBeenCalled();
  });

  test("reports a drained-pair persisted pause as unrepaired rather than silently resuming it", async () => {
    // The v2 read path cannot clear the legacy pause (that is a write); the
    // flag must surface it so enabling reads before the legacy rows are
    // drained is visible instead of resuming unowned targets.
    const state = makeState({
      status: "paused",
      target: makeTarget({ active: false, lifecycleStatus: PAUSED }),
    });

    const result = await deriveEarnAutodepositPositionPause({
      ...baseArgs,
      state: state as never,
    });

    expect(result.pauseReason).toBe("legacy_pause_unrepaired");
    expect(result.state).toEqual(state as never);
    expect(result.state.status).toBe("paused");
    expect(resumeAutodepositTargetFromMissingPosition).not.toHaveBeenCalled();
  });

  test("skips pending and user-toggled-off targets entirely", async () => {
    for (const state of [
      makeState({
        status: "pending",
        target: makeTarget({ lifecycleStatus: "pending_delegation" }),
      }),
      makeState({ status: "paused", target: makeTarget({ active: false }) }),
    ]) {
      const result = await deriveEarnAutodepositPositionPause({
        ...baseArgs,
        state: state as never,
      });
      expect(result.pauseReason).toBeNull();
      expect(result.state).toEqual(state as never);
    }
    expect(hasActiveEarnRoutePolicyPair).not.toHaveBeenCalled();
    expect(markAutodepositTargetPausedMissingPosition).not.toHaveBeenCalled();
  });
});
