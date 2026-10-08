import type { EarnMaxWithdrawalHealth } from "../types";

export const WITHDRAWAL_HEALTH_MAX_AGE_MS = 120_000;

export function parseWithdrawalHealth(
  value: unknown,
  scope: { cluster: string; program: string; routeKey: string; vault: string },
  now = Date.now()
): EarnMaxWithdrawalHealth {
  const unavailable: EarnMaxWithdrawalHealth = {
    lastKnownAttention: false,
    observedAt: null,
    status: "unavailable",
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unavailable;
  }
  const state = value as Record<string, unknown>;
  if (
    state.version !== 1 ||
    state.cluster !== scope.cluster ||
    state.program !== scope.program ||
    state.routeKey !== scope.routeKey ||
    state.vault !== scope.vault ||
    !["none", "waiting", "operator_attention", "unavailable"].includes(
      String(state.status)
    )
  ) {
    return unavailable;
  }
  const lastKnownAttention =
    state.status === "operator_attention" || state.lastKnownAttention === true;
  const timestamp =
    typeof state.observedAt === "string" ? Date.parse(state.observedAt) : NaN;
  const blockedSince =
    typeof state.blockedSince === "string" ? Date.parse(state.blockedSince) : NaN;
  if (
    !Number.isFinite(timestamp) ||
    timestamp > now ||
    now - timestamp > WITHDRAWAL_HEALTH_MAX_AGE_MS ||
    !Number.isSafeInteger(state.observedSlot) ||
    Number(state.observedSlot) <= 0 ||
    (state.status === "operator_attention" &&
      (!Number.isFinite(blockedSince) || blockedSince > timestamp))
  ) {
    return { ...unavailable, lastKnownAttention };
  }
  return {
    lastKnownAttention,
    observedAt: new Date(timestamp).toISOString(),
    // A current user receipt and a worker's older empty queue disagree.
    status:
      state.status === "waiting" || state.status === "operator_attention"
        ? state.status
        : "unavailable",
  };
}
