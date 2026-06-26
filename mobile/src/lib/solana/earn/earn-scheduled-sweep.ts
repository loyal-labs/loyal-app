import type { EarnAutodepositScheduledSweep } from "./earn-api";

// Hide dust sweeps the same way the web pane does (0.01 USDC = 10_000 raw).
// Below this the surplus isn't worth surfacing as its own scheduled row.
export const EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW = BigInt(10_000);

const USDC_RAW_SCALE = BigInt(1_000_000);

function parseUnsignedRaw(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

// An "open" sweep with a still-meaningful remaining amount is pending. Mirrors
// the web `getVisibleEarnAutodepositScheduledSweeps` minimum-amount fallback
// (the surplus-capping branch needs a live wallet balance the Activity feed
// doesn't carry, so we use the same display-threshold filter the web falls back
// to when balances are unavailable).
export function getVisibleEarnScheduledSweeps(
  sweeps: readonly EarnAutodepositScheduledSweep[] | undefined,
): EarnAutodepositScheduledSweep[] {
  if (!sweeps) {
    return [];
  }
  return sweeps.filter((sweep) => {
    if (sweep.status !== "open") {
      return false;
    }
    const remaining = parseUnsignedRaw(sweep.remainingAmountRaw);
    return (
      remaining !== null && remaining >= EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW
    );
  });
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

// The sweep has reached its execution window (or was accelerated via "Execute
// now") and is waiting on the sweep worker to run it.
export function isScheduledSweepAwaitingExecution(
  sweep: EarnAutodepositScheduledSweep,
): boolean {
  const eligibleAt = new Date(sweep.eligibleAfter).getTime();
  return !Number.isNaN(eligibleAt) && eligibleAt <= Date.now();
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
