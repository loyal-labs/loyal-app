export type JourneyEvent = {
  trafficKind?: string;
  time: number;
  eventId: string;
  journeyId: string;
  attemptId: string;
  attemptNumber: number;
  flow: string;
  variant: string;
  stage: string;
  outcome: string;
  retryCount: number;
  elapsedMs: number;
  errorCode: string;
  errorCategory?: string;
  chainState: string;
  persistenceState: string;
  release: string;
  userId: string;
  rumSessionId: string;
};

export const JOURNEY_WINDOW_MS = 10 * 60_000;

export type Journey = {
  trafficKind: "external" | "internal" | "synthetic";
  id: string;
  flow: string;
  variant: string;
  release: string;
  userId: string;
  firstAttemptSuccess: boolean;
  eventualSuccess: boolean;
  recoveredLate: boolean;
  failed: boolean;
  stalled: boolean;
  cancelled: boolean;
  unresolved: boolean;
  matured: boolean;
  durationMs: number | null;
  last: JourneyEvent;
  failure?: JourneyEvent;
  stall?: JourneyEvent;
};

// Only browser entry/terminal events enter here; server step completion is not
// user-journey completion. Legacy rows without a journey ID have no retry denominator.
export function summarizeJourneys(
  events: JourneyEvent[],
  now: number
): Journey[] {
  const seen = new Set<string>();
  const groups = new Map<string, JourneyEvent[]>();
  for (const event of events) {
    if (!event.journeyId || !event.eventId || seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    const key = `${event.flow}:${event.journeyId}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const result: Journey[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.time - b.time);
    const start = group.find(
      (event) => event.outcome === "started" && event.attemptNumber === 1
    );
    if (!start) continue;
    const successes = group.filter(
      (event) =>
        event.outcome === "completed" &&
        event.persistenceState !== "failed" &&
        (event.flow !== "wallet.swap" ||
          (event.stage === "balance_visible" &&
            event.chainState === "confirmed")) &&
        (!["earn.deposit", "earn.withdrawal"].includes(event.flow) ||
          (event.stage === "position_visible" &&
            event.chainState === "confirmed" &&
            event.persistenceState === "recorded"))
    );
    const success = successes.find(
      (event) => event.time - start.time <= JOURNEY_WINDOW_MS
    );
    const firstAttemptFailed = group.some(
      (event) =>
        event.attemptNumber === 1 &&
        (event.outcome === "failed" ||
          event.outcome === "cancelled" ||
          event.outcome === "retrying" ||
          event.outcome === "timed_out" ||
          event.retryCount > 0)
    );
    const last = group[group.length - 1];
    result.push({
      trafficKind: group.some((event) => event.trafficKind === "synthetic")
        ? "synthetic"
        : group.some((event) => event.trafficKind === "internal")
        ? "internal"
        : "external",
      id: start.journeyId,
      flow: start.flow,
      variant: start.variant,
      release: start.release,
      userId: group.find((event) => event.userId)?.userId ?? "",
      firstAttemptSuccess: Boolean(
        success?.attemptNumber === 1 && !firstAttemptFailed
      ),
      eventualSuccess: Boolean(success),
      recoveredLate: !success && successes.length > 0,
      failed: group.some((event) => event.outcome === "failed"),
      stalled: group.some((event) => event.outcome === "timed_out"),
      cancelled: !success && last.outcome === "cancelled",
      unresolved:
        !success &&
        !["failed", "cancelled"].includes(last.outcome) &&
        successes.length === 0,
      matured: now - start.time >= JOURNEY_WINDOW_MS,
      durationMs: success ? success.time - start.time : null,
      last,
      failure: group.find((event) => event.outcome === "failed"),
      stall: group.find((event) => event.outcome === "timed_out"),
    });
  }
  return result;
}

export function journeyFlowMetrics(journeys: Journey[]) {
  return [...new Set(journeys.map((journey) => journey.flow))].map((flow) => {
    const cohort = journeys.filter((journey) => journey.flow === flow);
    const mature = cohort.filter((journey) => journey.matured);
    const durations = mature
      .flatMap((journey) =>
        journey.durationMs === null ? [] : [journey.durationMs]
      )
      .sort((a, b) => a - b);
    return {
      flow,
      volume: cohort.length,
      denominator: mature.length,
      firstAttemptSuccess: mature.filter(
        (journey) => journey.firstAttemptSuccess
      ).length,
      eventualSuccess: mature.filter((journey) => journey.eventualSuccess)
        .length,
      failures: mature.filter((journey) => journey.failed).length,
      stalls: mature.filter((journey) => journey.stalled).length,
      unresolved: mature.filter((journey) => journey.unresolved).length,
      cancelled: mature.filter((journey) => journey.cancelled).length,
      affectedUsers: new Set(
        mature
          .filter(
            (journey) => (journey.failed || journey.stalled) && journey.userId
          )
          .map((journey) => journey.userId)
      ).size,
      p95Ms: durations.length
        ? durations[Math.ceil(durations.length * 0.95) - 1]
        : null,
    };
  });
}

export function journeyStepMetrics(
  events: JourneyEvent[],
  journeys: Journey[]
) {
  const eligible = new Set(
    journeys.filter((journey) => journey.matured).map((journey) => journey.id)
  );
  const groups = new Map<string, JourneyEvent[]>();
  const seen = new Set<string>();
  for (const event of events) {
    if (
      !eligible.has(event.journeyId) ||
      !event.eventId ||
      seen.has(event.eventId)
    )
      continue;
    seen.add(event.eventId);
    const key = JSON.stringify([event.flow, event.stage]);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const count = (predicate: (event: JourneyEvent) => boolean) =>
        new Set(group.filter(predicate).map((event) => event.journeyId)).size;
      return {
        flow: group[0].flow,
        stage: group[0].stage,
        reached: count(() => true),
        technicalFailures: count(
          (event) =>
            event.outcome === "failed" && event.errorCategory === "technical"
        ),
        validationFailures: count(
          (event) =>
            event.outcome === "failed" && event.errorCategory === "validation"
        ),
        unknownFailures: count(
          (event) =>
            event.outcome === "failed" &&
            !["technical", "validation", "timeout"].includes(
              event.errorCategory ?? ""
            )
        ),
        cancellations: count((event) => event.outcome === "cancelled"),
        retries: count(
          (event) =>
            event.outcome === "retrying" ||
            event.retryCount > 0 ||
            event.attemptNumber > 1
        ),
        timeouts: count(
          (event) =>
            event.outcome === "timed_out" ||
            (event.outcome === "failed" && event.errorCategory === "timeout")
        ),
        completed: count((event) => event.outcome === "completed"),
      };
    })
    .sort(
      (a, b) =>
        a.flow.localeCompare(b.flow) ||
        b.reached - a.reached ||
        a.stage.localeCompare(b.stage)
    );
}
