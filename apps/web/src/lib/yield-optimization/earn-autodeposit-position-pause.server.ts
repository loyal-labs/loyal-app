import {
  EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION,
  markAutodepositTargetPausedMissingPosition,
  resolveEarnAutodepositStatus,
  resumeAutodepositTargetFromMissingPosition,
  suppressEarnAutodepositScheduledSweepsForMissingPosition,
  type CurrentEarnAutodepositState,
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
    const target = await resumeAutodepositTargetFromMissingPosition(
      targetInput
    );
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
    state: { ...args.state, status: resolveEarnAutodepositStatus(target), target },
  };
}
