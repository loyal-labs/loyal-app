import { sendPreparedBatchWithWallet } from "@loyal-labs/smart-account-vaults";

type EarnAutodepositSetupBatchArgs = Omit<
  Parameters<typeof sendPreparedBatchWithWallet>[0],
  "confirm" | "sendMode"
>;

// Policy creation and recurring delegation are dependent transactions. Sign
// them together for one wallet prompt, then confirm the policy before sending
// the delegation so a partial setup remains resumable.
export function sendEarnAutodepositSetupBatch(
  args: EarnAutodepositSetupBatchArgs
) {
  return sendPreparedBatchWithWallet({
    ...args,
    confirm: true,
    sendMode: "confirm-each",
  });
}

export type EarnAutodepositTogglePresentation = {
  disabled: boolean;
  isOn: boolean;
  isPending: boolean;
  label: "Finish setup" | "Pausing…" | "Paused" | "Resuming…" | null;
  opensSetup: boolean;
};

export function resolveEarnAutodepositTogglePresentation(
  state: "closing" | "created" | "creating" | "paused" | "pausing" | "resuming"
): EarnAutodepositTogglePresentation {
  if (state === "creating") {
    return {
      disabled: false,
      isOn: false,
      isPending: false,
      label: "Finish setup",
      opensSetup: true,
    };
  }
  if (state === "pausing" || state === "resuming") {
    return {
      disabled: true,
      isOn: state === "resuming",
      isPending: true,
      label: state === "pausing" ? "Pausing…" : "Resuming…",
      opensSetup: false,
    };
  }
  return {
    disabled: false,
    isOn: state === "created" || state === "closing",
    isPending: false,
    label: state === "paused" ? "Paused" : null,
    opensSetup: false,
  };
}
