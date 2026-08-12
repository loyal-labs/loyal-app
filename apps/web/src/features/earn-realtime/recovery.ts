import { computeEarnRealtimeReconnectDelayMs } from "./stream";

type ScheduleRecovery = (callback: () => void, delayMs: number) => () => void;

const defaultScheduleRecovery: ScheduleRecovery = (callback, delayMs) => {
  const timer = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timer);
};

export function waitForEarnRealtimeRecovery({
  attempt,
  documentTarget = typeof document === "undefined"
    ? null
    : (document as EventTarget),
  isOnline = () =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  isVisible = () =>
    typeof document === "undefined" || document.visibilityState === "visible",
  schedule = defaultScheduleRecovery,
  signal,
  windowTarget = typeof window === "undefined" ? null : (window as EventTarget),
}: {
  attempt: number;
  documentTarget?: EventTarget | null;
  isOnline?: () => boolean;
  isVisible?: () => boolean;
  schedule?: ScheduleRecovery;
  signal: AbortSignal;
  windowTarget?: EventTarget | null;
}): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let settled = false;
    let cancelTimer: () => void = () => undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      cancelTimer();
      signal.removeEventListener("abort", finish);
      windowTarget?.removeEventListener("online", handleOnline);
      documentTarget?.removeEventListener("visibilitychange", handleVisible);
      resolve();
    };
    const handleOnline = () => finish();
    const handleVisible = () => {
      if (isVisible() && isOnline()) finish();
    };

    signal.addEventListener("abort", finish, { once: true });
    windowTarget?.addEventListener("online", handleOnline);
    documentTarget?.addEventListener("visibilitychange", handleVisible);
    const scheduledCancel = schedule(
      finish,
      computeEarnRealtimeReconnectDelayMs(attempt)
    );
    cancelTimer = scheduledCancel;
    if (settled) scheduledCancel();
  });
}
