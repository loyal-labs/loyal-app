import type { EarnAutodepositScheduledSweep } from "./earn-api";

// Hide dust sweeps the same way the web pane does (0.01 USDC = 10_000 raw).
// Below this the surplus isn't worth surfacing as its own scheduled row.
export const EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW = BigInt(10_000);

const USDC_RAW_SCALE = BigInt(1_000_000);

function parseUnsignedRaw(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

// Which scheduled sweeps to surface in the Activity feed. Mirrors the web
// `getVisibleEarnAutodepositScheduledSweeps` exactly:
//   1. Keep sweeps whose remaining amount clears the display threshold.
//   2. If a live wallet balance + floor are known, cap visibility by the actual
//      surplus above the floor. A scheduled slot whose surplus has already been
//      swept into Earn (balance back at the floor) has nothing left to back it,
//      so the web hides it — without this, a stale/unreconciled slot lingers as
//      a phantom "Execute now" row on mobile while the web shows nothing.
//   3. Without a balance (e.g. before holdings load), fall back to (1) alone.
// We deliberately do NOT gate on `sweep.status`: the backend's pending-sweep
// query already returns only live scheduled slots, and since the slot-aggregation
// rework that status is the slot status (scheduled/requested/selected/failed/
// released), never "open" — it drives the row's button state, not visibility.
export function getVisibleEarnScheduledSweeps(
  sweeps: readonly EarnAutodepositScheduledSweep[] | undefined,
  walletBalanceRaw?: bigint | null,
  walletBalanceFloorRaw?: bigint | null,
): EarnAutodepositScheduledSweep[] {
  if (!sweeps) {
    return [];
  }
  const sweepsAboveDisplayThreshold = sweeps.filter((sweep) => {
    const remaining = parseUnsignedRaw(sweep.remainingAmountRaw);
    return (
      remaining !== null && remaining >= EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW
    );
  });

  if (walletBalanceRaw == null || walletBalanceFloorRaw == null) {
    return sweepsAboveDisplayThreshold;
  }

  let remainingSurplusRaw = walletBalanceRaw - walletBalanceFloorRaw;
  if (remainingSurplusRaw < EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW) {
    return [];
  }

  const visibleSweeps: EarnAutodepositScheduledSweep[] = [];
  for (const sweep of sweepsAboveDisplayThreshold) {
    const remaining = parseUnsignedRaw(sweep.remainingAmountRaw);
    if (remaining === null) {
      continue;
    }
    const displayAmountRaw =
      remaining < remainingSurplusRaw ? remaining : remainingSurplusRaw;
    remainingSurplusRaw -= displayAmountRaw;
    if (displayAmountRaw < EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW) {
      break;
    }
    visibleSweeps.push(
      displayAmountRaw === remaining
        ? sweep
        : { ...sweep, remainingAmountRaw: displayAmountRaw.toString() },
    );
    if (remainingSurplusRaw < EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW) {
      break;
    }
  }

  return visibleSweeps;
}

// "334.48 USDC" — mirrors the web `formatScheduledSweepAmount`.
export function formatScheduledSweepAmount(rawAmount: string): string {
  const raw = parseUnsignedRaw(rawAmount);
  if (raw === null) {
    return "0.00 USDC";
  }
  const whole = raw / USDC_RAW_SCALE;
  const cents = (raw % USDC_RAW_SCALE) / BigInt(10_000);
  return `${Number(whole).toLocaleString("en-US")}.${cents
    .toString()
    .padStart(2, "0")} USDC`;
}

// "Tomorrow at 18:06" — the Figma's relative-day + 24h time for the scheduled
// Autodeposit subtitle. Past tomorrow it falls back to a short date ("Jun 15").
export function formatScheduledSweepTime(eligibleAfter: string): string {
  const date = new Date(eligibleAfter);
  if (Number.isNaN(date.getTime())) {
    return "Scheduled";
  }
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${relativeDayLabel(date)} at ${hh}:${mm}`;
}

// The sweep is in the worker's execution pipeline — accelerated via "Execute
// now" or already picked up. Mirrors the web `isPersistedScheduledSweepExecuting`
// (slot status), which is authoritative now that the backend returns the slot
// status. Time alone can't be used: executing advances `eligibleAfter` into the
// past permanently, so a time check would stick on "Executing…" forever and
// couldn't tell a live execution from a `failed`/`released` one the user should
// be able to retry (those keep enabled, exactly like the web).
export function isScheduledSweepAwaitingExecution(
  sweep: EarnAutodepositScheduledSweep,
): boolean {
  return sweep.status === "requested" || sweep.status === "selected";
}

function relativeDayLabel(date: Date): string {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((startOfDay(date) - startOfDay(new Date())) / dayMs);
  if (diffDays <= 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Tomorrow";
  }
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
