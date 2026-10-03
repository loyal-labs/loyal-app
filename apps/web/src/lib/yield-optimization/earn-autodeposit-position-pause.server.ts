import {
  type CurrentEarnAutodepositState,
  EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION,
  markAutodepositTargetPausedMissingPosition,
  resolveEarnAutodepositStatus,
  resumeAutodepositTargetFromMissingPosition,
  suppressEarnAutodepositScheduledSweepsForMissingPosition,
} from "./earn-autodeposit-repository.server";
import { hasActiveEarnRoutePolicyPair } from "./earn-position-gate.server";

// An Autodeposit sweep can only route into an ACTIVE Earn position (see
// earn-position-gate.server). When a full withdrawal closes the position
// while the Autodeposit stays on, the worker perma-fails every slot ("no
// active Earn route policy") and the app renders an eternal "Execute now" —
// this reconcile pauses the target instead, and auto-resumes it the moment a
// new deposit recreates the policy pair. Both Earn state reads run it, so a
// wrong pause (or a missed resume) heals on the next read in either
// direction.
export async function reconcileEarnAutodepositPositionPause(args: {
  cluster: string;
  settingsPda: string;
  state: CurrentEarnAutodepositState;
  vaultIndex: 1;
  walletAddress: string;
}): Promise<{ resumed: boolean; state: CurrentEarnAutodepositState }> {
  const targetInput = {
    policyAccount: args.state.target.policyAccount,
    settings: args.settingsPda,
    vaultIndex: args.vaultIndex,
    walletAddress: args.walletAddress,
  };

  if (
    args.state.target.lifecycleStatus ===
    EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION
  ) {
    if (
      !(await hasActiveEarnRoutePolicyPair({
        cluster: args.cluster,
        settingsPda: args.settingsPda,
        walletAddress: args.walletAddress,
      }))
    ) {
      return { resumed: false, state: args.state };
    }
    const target =
      await resumeAutodepositTargetFromMissingPosition(targetInput);
    const status = resolveEarnAutodepositStatus(target);
    return {
      resumed: status === "active",
      state: { ...args.state, status, target },
    };
  }

  // Only a fully-active target can strand sweeps; pending/paused/closed rows
  // aren't scheduling anything.
  if (args.state.status !== "active") {
    return { resumed: false, state: args.state };
  }
  if (
    await hasActiveEarnRoutePolicyPair({
      cluster: args.cluster,
      settingsPda: args.settingsPda,
      walletAddress: args.walletAddress,
    })
  ) {
    return { resumed: false, state: args.state };
  }

  const target = await markAutodepositTargetPausedMissingPosition(targetInput);
  if (target.lifecycleStatus === EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION) {
    await suppressEarnAutodepositScheduledSweepsForMissingPosition({ target });
  }
  return {
    resumed: false,
    state: {
      ...args.state,
      status: resolveEarnAutodepositStatus(target),
      target,
    },
  };
}

export type EarnAutodepositPositionPauseReason =
  | "legacy_pause_unrepaired"
  | "missing_position";

// Workers-v2 read mode: report the same effective pause the reconcile would
// persist, without writing. Desired enablement and chain status stay exactly
// as persisted — an unavailable position blocks eligibility as a derived
// reason, never as a rewritten target row, so nothing needs an app read to
// resume once the route policy pair exists again. Rows still carrying the
// legacy persisted pause are reported as unrepaired: nothing in read mode
// clears them, so the flag may only be enabled after they are drained.
export async function deriveEarnAutodepositPositionPause(args: {
  cluster: string;
  settingsPda: string;
  state: CurrentEarnAutodepositState;
  vaultIndex: 1;
  walletAddress: string;
}): Promise<{
  pauseReason: EarnAutodepositPositionPauseReason | null;
  state: CurrentEarnAutodepositState;
}> {
  if (
    args.state.target.lifecycleStatus ===
    EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION
  ) {
    return {
      pauseReason: (await hasActiveEarnRoutePolicyPair(args))
        ? "legacy_pause_unrepaired"
        : "missing_position",
      state: args.state,
    };
  }
  if (args.state.status !== "active") {
    return { pauseReason: null, state: args.state };
  }
  if (
    await hasActiveEarnRoutePolicyPair({
      cluster: args.cluster,
      settingsPda: args.settingsPda,
      walletAddress: args.walletAddress,
    })
  ) {
    return { pauseReason: null, state: args.state };
  }
  return {
    pauseReason: "missing_position",
    state: { ...args.state, status: "paused" },
  };
}

// Web and mobile choose the same transition. Read mode derives eligibility;
// legacy mode retains its existing repair behavior until the worker owns it.
export async function readEarnAutodepositPositionPause(
  args: Parameters<typeof deriveEarnAutodepositPositionPause>[0],
  readOnly: boolean
): Promise<{
  pauseReason: EarnAutodepositPositionPauseReason | null;
  resumed: boolean;
  state: CurrentEarnAutodepositState;
}> {
  if (readOnly) {
    return {
      ...(await deriveEarnAutodepositPositionPause(args)),
      resumed: false,
    };
  }
  return {
    ...(await reconcileEarnAutodepositPositionPause(args)),
    pauseReason: null,
  };
}
