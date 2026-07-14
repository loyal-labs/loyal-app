export const EARN_REALTIME_SCHEMA_VERSION = 1 as const;

export const EARN_REALTIME_EVENT_TYPES = {
  allowance: "earn.autodeposit.configuration.changed",
  autodeposit: "earn.autodeposit.execution.changed",
  onboarding: "earn.onboarding.changed",
  position: "earn.position.changed",
  rebalance: "earn.rebalance.confirmed",
  transaction: "earn.transaction.recorded",
} as const;

export const EARN_AUTODEPOSIT_PROGRESS_STATES = [
  "scheduled",
  "requested",
  "selected",
  "pull_confirmed",
  "completed",
  "failed",
  "canceled",
  "released",
] as const;

export type EarnAutodepositProgressState =
  (typeof EARN_AUTODEPOSIT_PROGRESS_STATES)[number];

export type EarnRealtimeInvalidation = {
  schemaVersion: typeof EARN_REALTIME_SCHEMA_VERSION;
  eventId: string;
  eventType: string;
  occurredAt: string;
  scope: string;
  state?: EarnAutodepositProgressState;
  reason?: string;
  targetId?: string;
  scheduledSlotId?: string;
  executionId?: string;
  failureCode?: string;
};

export type EarnRealtimeResyncRequired = {
  schemaVersion: typeof EARN_REALTIME_SCHEMA_VERSION;
  eventType: "resync_required";
  reason: string;
};

export type EarnRealtimeMessage =
  | EarnRealtimeInvalidation
  | EarnRealtimeResyncRequired;

export type EarnRealtimeConnectionState =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting";

export type EarnAutodepositProgress = {
  eventId?: string;
  failureCode?: string;
  scheduledSlotId: string;
  state: EarnAutodepositProgressState | "requesting";
};

const DECIMAL_EVENT_ID_PATTERN = /^\d+$/;
const AUTODEPOSIT_STATES = new Set<string>(EARN_AUTODEPOSIT_PROGRESS_STATES);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseEarnRealtimeMessage(
  value: unknown
): EarnRealtimeMessage | null {
  if (
    !isObject(value) ||
    value.schemaVersion !== EARN_REALTIME_SCHEMA_VERSION ||
    typeof value.eventType !== "string"
  ) {
    return null;
  }

  if (value.eventType === "resync_required") {
    return typeof value.reason === "string"
      ? {
          eventType: "resync_required",
          reason: value.reason,
          schemaVersion: EARN_REALTIME_SCHEMA_VERSION,
        }
      : null;
  }

  if (
    typeof value.eventId !== "string" ||
    !DECIMAL_EVENT_ID_PATTERN.test(value.eventId) ||
    typeof value.occurredAt !== "string" ||
    typeof value.scope !== "string"
  ) {
    return null;
  }

  const state = value.state;
  if (
    state !== undefined &&
    (typeof state !== "string" || !AUTODEPOSIT_STATES.has(state))
  ) {
    return null;
  }

  const optionalString = (key: string): string | undefined =>
    typeof value[key] === "string" ? value[key] : undefined;

  return {
    eventId: value.eventId,
    eventType: value.eventType,
    executionId: optionalString("executionId"),
    failureCode: optionalString("failureCode"),
    occurredAt: value.occurredAt,
    reason: optionalString("reason"),
    scheduledSlotId: optionalString("scheduledSlotId"),
    schemaVersion: EARN_REALTIME_SCHEMA_VERSION,
    scope: value.scope,
    state: state as EarnAutodepositProgressState | undefined,
    targetId: optionalString("targetId"),
  };
}

export function isEarnRealtimeResyncRequired(
  message: EarnRealtimeMessage
): message is EarnRealtimeResyncRequired {
  return message.eventType === "resync_required";
}

export function isEarnAutodepositTerminalState(
  state: EarnAutodepositProgress["state"]
): boolean {
  return ["completed", "failed", "released", "canceled"].includes(state);
}

const AUTODEPOSIT_STATE_RANK: Record<EarnAutodepositProgress["state"], number> =
  {
    scheduled: 0,
    requesting: 1,
    requested: 2,
    selected: 3,
    pull_confirmed: 4,
    completed: 5,
    failed: 5,
    released: 5,
    canceled: 5,
  };

export function mergeEarnAutodepositProgress(
  current: EarnAutodepositProgress | undefined,
  next: EarnAutodepositProgress
): EarnAutodepositProgress {
  if (!current || current.scheduledSlotId !== next.scheduledSlotId) {
    return next;
  }
  if (current.eventId && next.eventId) {
    return BigInt(next.eventId) > BigInt(current.eventId) ? next : current;
  }
  if (current.eventId && !next.eventId) {
    return current;
  }
  return AUTODEPOSIT_STATE_RANK[next.state] >=
    AUTODEPOSIT_STATE_RANK[current.state]
    ? next
    : current;
}
