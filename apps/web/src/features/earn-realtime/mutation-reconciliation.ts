import { EARN_REALTIME_EVENT_TYPES } from "./types";
import type { EarnRealtimeInvalidation } from "./types";

export type EarnExpectedMutationOperation =
  | "autodeposit_close"
  | "autodeposit_floor"
  | "autodeposit_setup"
  | "autodeposit_toggle"
  | "cleanup"
  | "deposit"
  | "policy_setup"
  | "withdraw_full"
  | "withdraw_partial";

export type ExpectedEarnMutation = {
  key: string;
  operation: EarnExpectedMutationOperation;
  reconcileRelated?: () => Promise<void>;
  resources: readonly string[];
  signature?: string;
  targetId?: string;
};

export type PlannedEarnRealtimeEvent = {
  event: EarnRealtimeInvalidation;
  resources: readonly string[];
};

type Schedule = (callback: () => void, delayMs: number) => () => void;

type ExpectedEntry = ExpectedEarnMutation & {
  cancelExpiry: () => void;
  cancelFallback: () => void;
  covered: Set<string>;
  order: number;
  pending: Set<string>;
  relatedCovered: boolean;
  relatedPending: boolean;
};

type RecentAcceptedEvent = PlannedEarnRealtimeEvent & {
  acceptedAt: number;
  claimedBy?: string;
};

const defaultSchedule: Schedule = (callback, delayMs) => {
  const timer = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timer);
};

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isCovered(entry: ExpectedEntry): boolean {
  return (
    entry.resources.every((resource) => entry.covered.has(resource)) &&
    (!entry.reconcileRelated || entry.relatedCovered)
  );
}

function matchesExpectedMutation(
  expected: ExpectedEarnMutation,
  event: EarnRealtimeInvalidation
): boolean {
  if (expected.targetId && event.targetId !== expected.targetId) {
    return false;
  }

  if (
    expected.operation === "cleanup" &&
    (event.eventType === EARN_REALTIME_EVENT_TYPES.allowance ||
      event.eventType === EARN_REALTIME_EVENT_TYPES.onboarding)
  ) {
    return true;
  }

  if (
    expected.operation === "autodeposit_close" ||
    expected.operation === "autodeposit_floor" ||
    expected.operation === "autodeposit_setup" ||
    expected.operation === "autodeposit_toggle"
  ) {
    return event.eventType === EARN_REALTIME_EVENT_TYPES.allowance;
  }
  if (expected.operation === "policy_setup") {
    return event.eventType === EARN_REALTIME_EVENT_TYPES.onboarding;
  }
  if (event.eventType === EARN_REALTIME_EVENT_TYPES.position) {
    return (
      expected.operation === "deposit" ||
      expected.operation === "withdraw_partial" ||
      expected.operation === "withdraw_full" ||
      expected.operation === "cleanup"
    );
  }
  if (event.eventType !== EARN_REALTIME_EVENT_TYPES.transaction) {
    return false;
  }

  const reason = event.reason ?? "";
  if (expected.operation === "deposit") {
    return reason.startsWith("holding_event_deposit_");
  }
  if (expected.operation === "withdraw_partial") {
    return reason === "holding_event_withdrawal_partial";
  }
  if (
    expected.operation === "withdraw_full" ||
    expected.operation === "cleanup"
  ) {
    return reason === "holding_event_withdrawal_full";
  }
  return false;
}

function matchesHistoricalExpectedMutation(
  expected: ExpectedEarnMutation,
  event: EarnRealtimeInvalidation
): boolean {
  if (expected.signature !== undefined && !expected.targetId) {
    // A signature-only mutation may use event type/reason as a causal match
    // only when it was already registered before the event was planned. The
    // current producer does not echo signatures, so a pre-registration event
    // cannot prove that it belongs to this later local mutation.
    return false;
  }
  return matchesExpectedMutation(expected, event);
}

/**
 * Correlates a successful local mutation with its durable invalidation. The
 * event owns the canonical read when it arrives; otherwise exactly one bounded
 * fallback owns it. A fallback that began before a late event never suppresses
 * that event: the coordinator must run/await a post-event trailing read before
 * the event can be acknowledged.
 */
export class EarnMutationReconciliationRegistry {
  private readonly entries = new Map<string, ExpectedEntry>();
  private nextOrder = 0;
  private recent: RecentAcceptedEvent[] = [];

  constructor(
    private readonly options: {
      fallbackDelayMs?: number;
      now?: () => number;
      onFallbackError?: (
        error: unknown,
        expected: ExpectedEarnMutation
      ) => void;
      retentionMs?: number;
      schedule?: Schedule;
    } = {}
  ) {}

  register(
    expected: ExpectedEarnMutation,
    fallback: (resources: readonly string[]) => Promise<void>
  ): () => void {
    this.remove(expected.key);
    this.pruneRecent();

    const entry: ExpectedEntry = {
      ...expected,
      resources: unique(expected.resources),
      cancelExpiry: () => undefined,
      cancelFallback: () => undefined,
      covered: new Set(),
      order: (this.nextOrder += 1),
      pending: new Set(),
      relatedCovered: false,
      relatedPending: false,
    };
    for (const recent of this.recent) {
      if (recent.claimedBy) continue;
      if (!matchesHistoricalExpectedMutation(entry, recent.event)) continue;
      let claimed = false;
      for (const resource of recent.resources) {
        if (
          entry.resources.includes(resource) &&
          !entry.covered.has(resource)
        ) {
          entry.covered.add(resource);
          claimed = true;
        }
      }
      if (claimed) recent.claimedBy = entry.key;
    }
    if (isCovered(entry)) {
      return () => undefined;
    }

    const schedule = this.options.schedule ?? defaultSchedule;
    const retentionMs = this.options.retentionMs ?? 15_000;
    this.entries.set(entry.key, entry);
    entry.cancelExpiry = schedule(() => this.remove(entry.key), retentionMs);
    entry.cancelFallback = schedule(() => {
      const current = this.entries.get(entry.key);
      if (current !== entry) return;
      const missing = entry.resources.filter(
        (resource) =>
          !entry.covered.has(resource) && !entry.pending.has(resource)
      );
      const shouldReconcileRelated = Boolean(
        entry.reconcileRelated && !entry.relatedCovered && !entry.relatedPending
      );
      if (missing.length === 0 && !shouldReconcileRelated) return;
      if (shouldReconcileRelated) entry.relatedPending = true;
      void Promise.all([
        missing.length > 0 ? fallback(missing) : Promise.resolve(),
        shouldReconcileRelated ? entry.reconcileRelated?.() : Promise.resolve(),
      ])
        .then(() => {
          if (this.entries.get(entry.key) !== entry) return;
          // This was the one missed-event fallback. Remove correlation state so
          // any event arriving later owns a fresh causal read instead of being
          // suppressed by a request that may have started before that event.
          this.remove(entry.key);
        })
        .catch((error) => {
          if (this.entries.get(entry.key) !== entry) return;
          entry.relatedPending = false;
          this.options.onFallbackError?.(error, expected);
        });
    }, this.options.fallbackDelayMs ?? 2_500);

    return () => this.remove(entry.key);
  }

  plan(events: readonly PlannedEarnRealtimeEvent[]): {
    accept: (accepted: boolean) => void;
    reconcileRelated: () => Promise<void>;
    resources: string[];
  } {
    this.pruneRecent();
    const resources = new Set<string>();
    const claimed = new Map<ExpectedEntry, Set<string>>();
    const relatedClaims = new Set<ExpectedEntry>();
    const plannedClaims = new Map<PlannedEarnRealtimeEvent, ExpectedEntry>();
    const registrationOrderAtPlan = this.nextOrder;

    for (const planned of events) {
      // Every durable event keeps ownership of its canonical resource read.
      // Correlation only cancels the mutation's missed-event fallback; it must
      // never suppress a cursor-owning event without a producer version/signature.
      for (const resource of planned.resources) resources.add(resource);
      const matches = Array.from(this.entries.values()).filter((entry) =>
        matchesExpectedMutation(entry, planned.event)
      );
      if (matches.length === 0) {
        continue;
      }

      const entry =
        matches.find((candidate) =>
          planned.resources.some(
            (resource) =>
              candidate.resources.includes(resource) &&
              !candidate.covered.has(resource) &&
              !candidate.pending.has(resource)
          )
        ) ?? matches[0];
      plannedClaims.set(planned, entry);
      const entryClaimed = claimed.get(entry) ?? new Set<string>();
      claimed.set(entry, entryClaimed);
      if (entry.reconcileRelated && !entry.relatedCovered) {
        entry.relatedPending = true;
        relatedClaims.add(entry);
      }
      for (const resource of planned.resources) {
        if (
          entry.resources.includes(resource) &&
          !entry.covered.has(resource) &&
          !entry.pending.has(resource)
        ) {
          entry.pending.add(resource);
          entryClaimed.add(resource);
        }
      }
    }

    let settled = false;
    let relatedReconciled = relatedClaims.size === 0;
    let relatedRun: Promise<void> | null = null;
    return {
      resources: Array.from(resources),
      reconcileRelated: async () => {
        relatedRun ??= Promise.all(
          Array.from(relatedClaims, (entry) => entry.reconcileRelated?.())
        ).then(() => undefined);
        await relatedRun;
        relatedReconciled = true;
      },
      accept: (accepted) => {
        if (settled) return;
        settled = true;
        const now = this.now();
        const acceptedRecent: RecentAcceptedEvent[] = [];
        if (accepted) {
          for (const planned of events) {
            const recent = {
              ...planned,
              acceptedAt: now,
              claimedBy: plannedClaims.get(planned)?.key,
            };
            acceptedRecent.push(recent);
            this.recent.push(recent);
          }
        }
        for (const [entry, entryClaimed] of claimed) {
          if (this.entries.get(entry.key) !== entry) continue;
          if (relatedClaims.has(entry)) {
            entry.relatedPending = false;
            if (accepted && relatedReconciled) entry.relatedCovered = true;
          }
          for (const resource of entryClaimed) {
            entry.pending.delete(resource);
            if (accepted) entry.covered.add(resource);
          }
          if (accepted && isCovered(entry)) this.remove(entry.key);
        }
        if (accepted) {
          // A mutation can finish registering while its already-received SSE
          // event is awaiting the canonical coordinator read. Reconcile that
          // late registration with the accepted read so its timer cannot issue
          // a duplicate fallback.
          for (let index = 0; index < events.length; index += 1) {
            const planned = events[index];
            const recent = acceptedRecent[index];
            if (!planned || !recent || recent.claimedBy) continue;
            const entry = Array.from(this.entries.values()).find(
              (candidate) =>
                candidate.order > registrationOrderAtPlan &&
                matchesHistoricalExpectedMutation(candidate, planned.event) &&
                planned.resources.some(
                  (resource) =>
                    candidate.resources.includes(resource) &&
                    !candidate.covered.has(resource)
                )
            );
            if (!entry) continue;
            recent.claimedBy = entry.key;
            for (const resource of planned.resources) {
              if (entry.resources.includes(resource)) {
                entry.covered.add(resource);
              }
            }
            if (isCovered(entry)) this.remove(entry.key);
          }
        }
        this.pruneRecent();
      },
    };
  }

  reset(): void {
    for (const key of Array.from(this.entries.keys())) this.remove(key);
    this.recent = [];
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private pruneRecent(): void {
    const cutoff = this.now() - (this.options.retentionMs ?? 15_000);
    this.recent = this.recent
      .filter((item) => item.acceptedAt >= cutoff)
      .slice(-64);
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.cancelFallback();
    entry.cancelExpiry();
    this.entries.delete(key);
  }
}
