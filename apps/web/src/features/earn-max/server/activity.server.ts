import "server-only";

import type { EarnMaxActivityItem } from "../types";

export type EarnMaxOperationActivityRow = {
  action: string;
  expectedEffects: unknown;
  id: string;
  signature: string | null;
  status: string;
  strategyKey: string | null;
  timestamp: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requestId(expectedEffects: unknown): string | null {
  const value = record(record(expectedEffects)?.intent)?.requestId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveTokenDelta(expectedEffects: unknown): string {
  const deltas = record(expectedEffects)?.tokenDeltas;
  if (!Array.isArray(deltas)) return "0";
  let largest = BigInt(0);
  for (const value of deltas) {
    const rawDelta = record(value)?.rawDelta;
    if (
      !(
        typeof rawDelta === "bigint" ||
        typeof rawDelta === "number" ||
        (typeof rawDelta === "string" && /^-?\d+$/.test(rawDelta))
      )
    ) {
      continue;
    }
    const parsed = BigInt(rawDelta);
    if (parsed > largest) largest = parsed;
  }
  return largest.toString();
}

function withdrawalStatus(routeState: unknown): string | null {
  const value = record(record(routeState)?.withdrawal)?.status;
  return typeof value === "string" ? value : null;
}

function routeGoal(routeState: unknown): string | null {
  const value = record(routeState)?.goal;
  return typeof value === "string" ? value : null;
}

function completeHistoricalEvent(event: EarnMaxActivityItem): void {
  if (event.status === "needs_attention" || event.status === "completed")
    return;
  if (event.kind === "deposit") {
    event.status = "completed";
  } else if (event.status === "cancelling") {
    event.status = "cancelled";
  }
}

function completeLatestEvent(
  event: EarnMaxActivityItem,
  routeState: unknown
): void {
  if (
    event.status === "needs_attention" ||
    routeGoal(routeState) === "manual_recovery"
  ) {
    event.status = "needs_attention";
    return;
  }
  if (event.kind === "deposit") {
    event.status =
      routeGoal(routeState) === "idle" ? "completed" : "processing";
    return;
  }
  if (event.status === "completed") return;
  if (event.status === "cancelling") {
    event.status =
      routeGoal(routeState) === "idle" ? "cancelled" : "cancelling";
    return;
  }
  const status = withdrawalStatus(routeState);
  if (status === "claimable") {
    event.status = "ready";
  } else if (status === "unwinding") {
    event.status = "unwinding";
  } else if (status === "requested") {
    event.status = "requested";
  } else {
    event.status = "processing";
  }
}

/**
 * Projects serialized route operations into the user actions they implement.
 * A chain-observed custody credit opens a deposit. A withdrawal request opens
 * a withdrawal; its unwind, claim, cancellation, and partial redeploy remain
 * steps of that same event.
 */
export function projectEarnMaxActivity(
  input: EarnMaxOperationActivityRow[],
  routeState: unknown
): EarnMaxActivityItem[] {
  const operations = [...input].sort((left, right) => {
    const timestamp = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return timestamp !== 0 ? timestamp : left.id.localeCompare(right.id);
  });
  const events: EarnMaxActivityItem[] = [];
  let active: EarnMaxActivityItem | null = null;

  for (const operation of operations) {
    if (operation.action === "deposit_claim_asset") {
      if (active) completeHistoricalEvent(active);
      active = {
        amountRaw: positiveTokenDelta(operation.expectedEffects),
        id: `deposit:${operation.signature ?? operation.id}`,
        kind: "deposit",
        signature: operation.signature,
        status:
          operation.status === "manual_recovery"
            ? "needs_attention"
            : "processing",
        strategyKey: operation.strategyKey,
        timestamp: operation.timestamp,
      };
      events.push(active);
      continue;
    }

    if (operation.action === "request_withdrawal") {
      if (active) completeHistoricalEvent(active);
      const id = requestId(operation.expectedEffects);
      active = {
        amountRaw: String(
          record(record(operation.expectedEffects)?.intent)?.amountRaw ?? "0"
        ),
        id: `withdrawal:${id ?? operation.id}`,
        kind: "withdrawal",
        signature: operation.signature,
        status:
          operation.status === "manual_recovery"
            ? "needs_attention"
            : "requested",
        strategyKey: operation.strategyKey,
        timestamp: operation.timestamp,
      };
      events.push(active);
      continue;
    }

    if (operation.action === "cancel_withdrawal") {
      if (active?.kind === "withdrawal") {
        active.signature = operation.signature ?? active.signature;
        active.status =
          operation.status === "manual_recovery"
            ? "needs_attention"
            : "cancelling";
      }
      continue;
    }

    if (!active) continue;
    active.strategyKey ??= operation.strategyKey;
    if (operation.status === "manual_recovery") {
      active.status = "needs_attention";
    } else if (operation.action === "claim" && active.kind === "withdrawal") {
      const amountRaw = positiveTokenDelta(operation.expectedEffects);
      if (amountRaw !== "0") active.amountRaw = amountRaw;
      active.signature = operation.signature ?? active.signature;
      active.status = "completed";
    } else if (
      active.kind === "withdrawal" &&
      active.status !== "completed" &&
      active.status !== "cancelling" &&
      operation.action !== "deposit_collateral" &&
      operation.action !== "borrow_debt" &&
      operation.action !== "swap_debt_to_collateral"
    ) {
      active.status = "unwinding";
    }
  }

  if (active) completeLatestEvent(active, routeState);
  return events.sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)
  );
}
