import {
  EARN_AUTODEPOSIT_PROGRESS_STATES,
  type EarnAutodepositProgress,
  type EarnAutodepositProgressState,
} from "./types";

const DECIMAL_SLOT_ID_PATTERN = /^\d+$/;
const AUTODEPOSIT_PROGRESS_STATES = new Set<string>(
  EARN_AUTODEPOSIT_PROGRESS_STATES
);

export async function fetchEarnAutodepositProgress(
  scheduledSlotId: string,
  signal: AbortSignal
): Promise<
  (EarnAutodepositProgress & { state: EarnAutodepositProgressState }) | null
> {
  if (!DECIMAL_SLOT_ID_PATTERN.test(scheduledSlotId)) {
    return null;
  }

  const response = await fetch(
    `/api/smart-accounts/yield-optimization/autodeposit/sweeps/execute?slotId=${encodeURIComponent(
      scheduledSlotId
    )}`,
    {
      cache: "no-store",
      credentials: "include",
      signal,
    }
  );
  if (!response.ok) {
    return null;
  }

  const value = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    !value ||
    value.scheduledSlotId !== scheduledSlotId ||
    typeof value.state !== "string" ||
    !AUTODEPOSIT_PROGRESS_STATES.has(value.state) ||
    (value.eventId !== undefined &&
      (typeof value.eventId !== "string" ||
        !DECIMAL_SLOT_ID_PATTERN.test(value.eventId))) ||
    (value.failureCode !== undefined && typeof value.failureCode !== "string")
  ) {
    return null;
  }

  return {
    eventId: value.eventId as string | undefined,
    failureCode: value.failureCode as string | undefined,
    scheduledSlotId,
    state: value.state as EarnAutodepositProgressState,
  };
}
