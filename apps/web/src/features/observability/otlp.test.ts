import { describe, expect, test } from "bun:test";

import type { NormalizedLifecycleEvent } from "./lifecycle-contract";
import { buildOtlpLifecyclePayload, isAlertableLifecycleEvent } from "./otlp";

function lifecycleEvent(
  overrides: Partial<NormalizedLifecycleEvent> = {}
): NormalizedLifecycleEvent {
  return {
    deploymentEnvironment: "prod",
    durationMs: 100,
    elapsedMs: 100,
    flowId: "40697037-d01c-43b7-8379-acd8ff9073be",
    flowName: "earn.withdrawal",
    flowVariant: "full",
    outcome: "failed",
    pathname: "/",
    release: "0.1.2_test",
    runtime: "mobile",
    serviceName: "loyal-mobile",
    source: "mobile_app",
    stage: "prepare",
    timestamp: "2026-08-19T20:20:11.133Z",
    ...overrides,
  };
}

function severityText(event: NormalizedLifecycleEvent): string | undefined {
  const payload = buildOtlpLifecyclePayload(event) as {
    resourceLogs?: Array<{
      scopeLogs?: Array<{
        logRecords?: Array<{ severityText?: string }>;
      }>;
    }>;
  };
  return payload.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0]
    ?.severityText;
}

describe("lifecycle alert severity", () => {
  test.each([
    "wallet_authorization_expired",
    "wallet_connection_failed",
    "wallet_connection_timeout",
    "wallet_signing_failed",
    "wallet_unavailable",
  ] as const)("keeps expected local %s failures at INFO", (errorCode) => {
    const event = lifecycleEvent({ errorCode });

    expect(isAlertableLifecycleEvent(event)).toBe(false);
    expect(severityText(event)).toBe("INFO");
  });

  test.each([
    { errorDetail: "network_unreachable" as const },
    { errorDetail: "request_timeout" as const },
    { httpStatus: 409 },
  ])("keeps expected request failure %# at INFO", (diagnostics) => {
    const event = lifecycleEvent({
      errorCode: "request_failed",
      ...diagnostics,
    });

    expect(isAlertableLifecycleEvent(event)).toBe(false);
    expect(severityText(event)).toBe("INFO");
  });

  test.each([
    { errorCode: "unexpected_error" as const },
    { errorCode: "request_failed" as const, httpStatus: 502 },
    {
      errorCode: "request_failed" as const,
      errorDetail: "kamino_upstream_unavailable" as const,
    },
    {
      errorCode: "request_failed" as const,
      errorDetail: "rpc_request_failed" as const,
    },
    // Unknown cause from an older mobile build: fail closed until classified.
    { errorCode: "request_failed" as const },
    { errorCode: "wallet_mismatch" as const },
  ])("keeps actionable failure %# at ERROR", (diagnostics) => {
    const event = lifecycleEvent(diagnostics);

    expect(isAlertableLifecycleEvent(event)).toBe(true);
    expect(severityText(event)).toBe("ERROR");
  });

  test("a cancellation after landed work still pages for recovery", () => {
    const event = lifecycleEvent({
      chainState: "confirmed",
      errorCode: "backend_confirmation_failed",
      outcome: "cancelled",
      persistenceState: "failed",
      recoveryRequired: true,
      stage: "backend_confirm",
    });

    expect(isAlertableLifecycleEvent(event)).toBe(true);
    expect(severityText(event)).toBe("ERROR");
  });

  test("ordinary cancellation stays INFO", () => {
    const event = lifecycleEvent({
      errorCode: "wallet_rejected",
      outcome: "cancelled",
    });

    expect(isAlertableLifecycleEvent(event)).toBe(false);
    expect(severityText(event)).toBe("INFO");
  });
});
