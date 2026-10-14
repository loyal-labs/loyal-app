import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdminSession } from "@/lib/require-admin-session";

import { getJourneyData, journeyEvidenceUrl } from "./journey-data";
import { journeyFlowMetrics } from "./journey-summary";

export const dynamic = "force-dynamic";

export default async function JourneysPage({
  searchParams,
}: {
  searchParams: Promise<{ cohort?: string }>;
}) {
  await requireAdminSession();
  const query = await searchParams;
  const cohort =
    query.cohort === "internal" || query.cohort === "synthetic"
      ? query.cohort
      : "external";
  const data = await getJourneyData(cohort);
  const metrics = journeyFlowMetrics(data.journeys);
  return (
    <PageContainer className="max-w-7xl">
      <SectionHeader
        title="User journeys"
        breadcrumbs={[{ label: "User journeys" }]}
        subtitle="Authentication and Earn outcomes over the last seven days. Retries remain visible."
      />
      <nav aria-label="Traffic cohort" className="flex flex-wrap gap-4 text-sm">
        {(["external", "internal", "synthetic"] as const).map((value) => (
          <Link
            key={value}
            href={`/journeys?cohort=${value}`}
            aria-current={cohort === value ? "page" : undefined}
            className={
              cohort === value
                ? "font-semibold underline underline-offset-4"
                : "text-muted-foreground"
            }
          >
            {value === "external"
              ? "Production users"
              : value === "internal"
              ? "Internal"
              : "Synthetic"}
          </Link>
        ))}
      </nav>
      {data.coverage !== "available" ? (
        <p role="status" className="my-6 rounded-lg border p-4">
          {data.coverage === "truncated"
            ? "Telemetry exceeds the bounded query. Rates are withheld; narrow the query before drawing conclusions."
            : "Journey telemetry is unavailable. This does not mean there are no failures. Check ClickStack configuration and ingestion."}
        </p>
      ) : (
        <>
          {!metrics.length && (
            <p role="status" className="my-6 rounded-lg border p-4">
              No versioned journeys in this cohort. Confirm the web
              instrumentation is deployed and sending events.
            </p>
          )}
          <Table className="mt-6 tabular-nums">
            <TableHeader>
              <TableRow>
                {[
                  "Flow",
                  "Started",
                  "Mature cohort",
                  "First attempt",
                  "Eventual success",
                  "Had a failure",
                  "Had a timeout",
                  "Cancelled",
                  "Unresolved",
                  "Affected users",
                  "p95",
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((metric) => (
                <TableRow key={metric.flow}>
                  <TableCell className="font-medium">{metric.flow}</TableCell>
                  <TableCell>{metric.volume}</TableCell>
                  <TableCell>{metric.denominator}</TableCell>
                  <TableCell>
                    {metric.firstAttemptSuccess} / {metric.denominator}
                  </TableCell>
                  <TableCell>
                    {metric.eventualSuccess} / {metric.denominator}
                  </TableCell>
                  <TableCell>{metric.failures}</TableCell>
                  <TableCell>{metric.stalls}</TableCell>
                  <TableCell>{metric.cancelled}</TableCell>
                  <TableCell>{metric.unresolved}</TableCell>
                  <TableCell>{metric.affectedUsers}</TableCell>
                  <TableCell>
                    {metric.p95Ms === null
                      ? "—"
                      : `${(metric.p95Ms / 1000).toFixed(1)} s`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <h2 className="mt-10 mb-4 text-lg font-semibold">
            Steps reached and outcomes
          </h2>
          <p className="mb-4 max-w-prose text-sm text-muted-foreground">
            Distinct mature journeys per step. A journey can have multiple
            outcomes after retries. Reached means observed at this step; a
            missing next step is not proof of failure.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  "Flow / step",
                  "Reached",
                  "Technical",
                  "Validation",
                  "Unclassified",
                  "Cancelled",
                  "Retried",
                  "Timed out",
                  "Completed",
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.steps.map((step) => (
                <TableRow key={JSON.stringify([step.flow, step.stage])}>
                  <TableCell>
                    {step.flow}
                    <span className="block text-muted-foreground">
                      {step.stage}
                    </span>
                  </TableCell>
                  {[
                    step.reached,
                    step.technicalFailures,
                    step.validationFailures,
                    step.unknownFailures,
                    step.cancellations,
                    step.retries,
                    step.timeouts,
                    step.completed,
                  ].map((value, index) => (
                    <TableCell key={index}>{value}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <h2 className="mt-10 mb-4 text-lg font-semibold">
            Failures, timeouts, cancellations and unresolved journeys
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                {["Flow / step", "Outcome", "Release", "Evidence"].map(
                  (label) => (
                    <TableHead key={label}>{label}</TableHead>
                  )
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.journeys
                .filter(
                  (journey) =>
                    journey.failed ||
                    journey.stalled ||
                    journey.unresolved ||
                    journey.cancelled
                )
                .slice(0, 50)
                .map((journey) => (
                  <TableRow key={journey.id}>
                    <TableCell>
                      {journey.flow}
                      <span className="block text-muted-foreground">
                        {
                          (journey.failure ?? journey.stall ?? journey.last)
                            .stage
                        }{" "}
                        ·{" "}
                        {(journey.failure ?? journey.stall ?? journey.last)
                          .errorCode || "No terminal event"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {journey.eventualSuccess
                        ? "Recovered"
                        : journey.recoveredLate
                        ? "Recovered after window"
                        : journey.cancelled
                        ? "Cancelled"
                        : journey.unresolved
                        ? "Unresolved, not proven failed"
                        : "Failed"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {journey.release.slice(0, 12) || "Unknown"}
                    </TableCell>
                    <TableCell>
                      <a
                        className="underline underline-offset-4"
                        href={journeyEvidenceUrl(
                          (journey.failure ?? journey.stall ?? journey.last)
                            .attemptId
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ClickStack
                      </a>
                      {journey.last.rumSessionId && (
                        <a
                          className="ml-3 underline underline-offset-4"
                          href={`https://us5.datadoghq.com/rum/explorer?query=${encodeURIComponent(
                            `@session.id:${journey.last.rumSessionId}`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Datadog session
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </>
      )}
      <p className="mt-8 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Rates use journeys started at least ten minutes ago, with completion
        within ten minutes of the first attempt. Cancellations remain in the
        denominator. Failure and timeout counts retain those outcomes after
        recovery. Affected users counts identified users with failures or
        explicit timeouts; anonymous users are not merged. p95 includes
        successful journeys only. Missing terminal events are unresolved, not
        evidence of failure. Legacy and untagged events are excluded. Session
        replay is disabled.
      </p>
    </PageContainer>
  );
}
