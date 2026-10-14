import "server-only";

import { serverEnv } from "@/lib/core/config/server";

import {
  type JourneyEvent,
  summarizeJourneys,
  journeyStepMetrics,
} from "./journey-summary";

export const JOURNEY_LOG_SOURCE_ID = "6a58601284f8f1d4ff4d12a5";
export const CLICKSTACK_UI = "https://observability.5.161.121.229.sslip.io";
const MAX_ROWS = 2000;
const fields: Record<string, string> = {
  trafficKind: "loyal.traffic.kind",
  eventId: "loyal.event.id",
  journeyId: "loyal.journey.id",
  attemptId: "loyal.flow.id",
  attemptNumber: "loyal.attempt.number",
  flow: "loyal.flow.name",
  variant: "loyal.flow.variant",
  stage: "loyal.flow.stage",
  outcome: "loyal.flow.outcome",
  retryCount: "loyal.retry.count",
  elapsedMs: "loyal.elapsed_ms",
  errorCode: "loyal.error.code",
  errorCategory: "loyal.error.category",
  chainState: "loyal.chain.state",
  persistenceState: "loyal.persistence.state",
  release: "loyal.client.build_id",
  userId: "loyal.user.id",
  rumSessionId: "loyal.rum.session_id",
};

export async function getJourneyData(
  cohort: "external" | "internal" | "synthetic" = "external"
) {
  const now = Date.now();
  const empty = {
    journeys: [],
    steps: [],
    fetchedAt: now,
    legacyEvents: 0,
    coverage: "unavailable" as const,
  };
  if (!serverEnv.clickStackApiKey || !serverEnv.clickStackApiUrl) return empty;
  try {
    const response = await fetch(
      `${serverEnv.clickStackApiUrl.replace(/\/$/, "")}/search`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${serverEnv.clickStackApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceId: JOURNEY_LOG_SOURCE_ID,
          startTime: new Date(now - 7 * 86_400_000).toISOString(),
          endTime: new Date(now).toISOString(),
          select: [
            "toUnixTimestamp64Milli(Timestamp) AS time",
            ...Object.entries(fields).map(
              ([alias, key]) => `LogAttributes['${key}'] AS ${alias}`
            ),
          ].join(","),
          where: `ServiceName = 'loyal-frontend' AND LogAttributes['loyal.event.kind'] = 'flow_lifecycle' AND LogAttributes['loyal.flow.source'] = 'browser' AND ${
            cohort === "synthetic"
              ? "LogAttributes['loyal.traffic.kind'] = 'synthetic'"
              : `ResourceAttributes['deployment.environment.name'] IN ('production','prod') AND LogAttributes['loyal.traffic.kind'] IN ('external','internal')`
          }`,
          whereLanguage: "sql",
          orderBy: "Timestamp DESC",
          maxResults: MAX_ROWS,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!response.ok) return empty;
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) return empty;
    const body = JSON.parse(text) as { data?: Record<string, unknown>[] };
    if (!Array.isArray(body.data)) return empty;
    const events: JourneyEvent[] = [];
    for (const row of body.data) {
      const string = (key: string) =>
        typeof row[key] === "string" ? (row[key] as string) : "";
      const time = Number(row.time);
      if (!Number.isFinite(time)) continue;
      events.push({
        time,
        trafficKind: string("trafficKind"),
        eventId: string("eventId"),
        journeyId: string("journeyId"),
        attemptId: string("attemptId"),
        attemptNumber: Number(row.attemptNumber),
        flow: string("flow"),
        variant: string("variant"),
        stage: string("stage"),
        outcome: string("outcome"),
        retryCount: Number(row.retryCount) || 0,
        elapsedMs: Number(row.elapsedMs) || 0,
        errorCode: string("errorCode"),
        errorCategory: string("errorCategory"),
        chainState: string("chainState"),
        persistenceState: string("persistenceState"),
        release: string("release"),
        userId: string("userId"),
        rumSessionId: string("rumSessionId"),
      });
    }
    const journeys = summarizeJourneys(events, now).filter(
      (journey) => journey.trafficKind === cohort
    );
    return {
      journeys,
      steps: journeyStepMetrics(events, journeys),
      fetchedAt: now,
      legacyEvents: events.filter((event) => !event.journeyId).length,
      coverage:
        body.data.length >= MAX_ROWS
          ? ("truncated" as const)
          : ("available" as const),
    };
  } catch {
    return empty;
  }
}

export function journeyEvidenceUrl(attemptId: string): string {
  const params = new URLSearchParams({
    source: JOURNEY_LOG_SOURCE_ID,
    where: `LogAttributes['loyal.flow.id'] = '${attemptId.replace(
      /[^a-f0-9-]/g,
      ""
    )}'`,
    whereLanguage: "sql",
    isLive: "false",
    from: String(Date.now() - 7 * 86_400_000),
    to: String(Date.now()),
  });
  return `${CLICKSTACK_UI}/search?${params}`;
}
