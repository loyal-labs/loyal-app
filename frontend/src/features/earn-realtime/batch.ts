import {
  resolveEarnRealtimeProtocolIssue,
  type EarnRealtimeInvalidation,
  type EarnRealtimeProtocolIssue,
} from "./types";

type ScheduleBatch = (callback: () => void, delayMs: number) => () => void;

const defaultScheduleBatch: ScheduleBatch = (callback, delayMs) => {
  const timer = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timer);
};

export async function acceptEarnRealtimeInvalidationBatch({
  events,
  onInvalidationBatch,
  onProtocolIssue,
  onResyncError,
  onResyncRequired,
}: {
  events: readonly EarnRealtimeInvalidation[];
  onInvalidationBatch: (
    events: readonly EarnRealtimeInvalidation[]
  ) => Promise<void> | void;
  onProtocolIssue?: (issue: EarnRealtimeProtocolIssue) => void;
  onResyncError?: (error: unknown) => void;
  onResyncRequired: () => Promise<void> | void;
}): Promise<void> {
  const supported: EarnRealtimeInvalidation[] = [];
  const issues = new Map<string, EarnRealtimeProtocolIssue>();
  for (const event of events) {
    const issue = resolveEarnRealtimeProtocolIssue(event);
    if (issue) issues.set(`${issue.kind}:${issue.eventType}`, issue);
    else supported.push(event);
  }

  const refreshes: Promise<void>[] = [];
  if (supported.length > 0) {
    refreshes.push(
      Promise.resolve().then(() => onInvalidationBatch(supported))
    );
  }
  if (issues.size > 0) {
    for (const issue of issues.values()) onProtocolIssue?.(issue);
    refreshes.push(
      Promise.resolve()
        .then(() => onResyncRequired())
        .catch((error) => {
          onResyncError?.(error);
          throw error;
        })
    );
  }
  await Promise.all(refreshes);
}

export class EarnRealtimeInvalidationBatcher {
  private cancelTimer: (() => void) | null = null;
  private disposed = false;
  private epoch = 0;
  private flushing = false;
  private readonly inFlightIds = new Set<string>();
  private pending = new Map<string, EarnRealtimeInvalidation>();
  private retryAttempt = 0;

  constructor(
    private readonly options: {
      acknowledge: (eventId: string) => void;
      delayMs: number;
      onBatch: (
        events: readonly EarnRealtimeInvalidation[]
      ) => Promise<void> | void;
      onError?: (error: unknown) => void;
      schedule?: ScheduleBatch;
    }
  ) {}

  enqueue(event: EarnRealtimeInvalidation): void {
    if (
      this.disposed ||
      this.pending.has(event.eventId) ||
      this.inFlightIds.has(event.eventId)
    ) {
      return;
    }
    this.pending.set(event.eventId, event);
    this.schedule();
  }

  async flushNow(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (this.flushing || this.pending.size === 0) return;

    const batch = [...this.pending.values()];
    const batchEpoch = this.epoch;
    this.pending.clear();
    this.flushing = true;
    for (const event of batch) this.inFlightIds.add(event.eventId);
    let accepted = false;

    try {
      await this.options.onBatch(batch);
      accepted = true;
      const highestEventId = batch.reduce(
        (highest, event) =>
          BigInt(event.eventId) > BigInt(highest) ? event.eventId : highest,
        batch[0]?.eventId ?? "0"
      );
      if (batchEpoch === this.epoch) {
        this.options.acknowledge(highestEventId);
      }
      this.retryAttempt = 0;
    } catch (error) {
      if (batchEpoch === this.epoch) {
        const retry = new Map<string, EarnRealtimeInvalidation>();
        for (const event of batch) retry.set(event.eventId, event);
        for (const [eventId, event] of this.pending) retry.set(eventId, event);
        this.pending = retry;
        this.retryAttempt = Math.min(this.retryAttempt + 1, 8);
        this.options.onError?.(error);
      }
    } finally {
      for (const event of batch) this.inFlightIds.delete(event.eventId);
      this.flushing = false;
    }

    if (!this.disposed && this.pending.size > 0) {
      this.schedule(
        accepted
          ? this.options.delayMs
          : Math.min(30_000, this.options.delayMs * 2 ** this.retryAttempt)
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    this.epoch += 1;
    this.cancelTimer?.();
    this.cancelTimer = null;
    // Pending and in-flight work stay unacknowledged so a scope change cannot
    // advance the old identity's cursor after its UI commits were disabled.
  }

  reset(): void {
    this.epoch += 1;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.pending.clear();
    this.inFlightIds.clear();
    this.retryAttempt = 0;
  }

  private schedule(delayMs = this.options.delayMs): void {
    if (this.cancelTimer || this.flushing || this.disposed) return;
    const schedule = this.options.schedule ?? defaultScheduleBatch;
    this.cancelTimer = schedule(() => {
      this.cancelTimer = null;
      void this.flushNow();
    }, delayMs);
  }
}
