import { describe, expect, test } from "bun:test";

import { parseBrowserLifecycleEnvelope } from "./lifecycle-contract";

const NOW = Date.parse("2026-08-04T17:30:00.000Z");

function cleanupRecoveryEnvelope() {
  return {
    chainState: "confirmed",
    cleanupRequired: true,
    durationMs: 10,
    elapsedMs: 20,
    errorCode: "backend_confirmation_failed",
    flowId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    flowName: "earn.withdrawal",
    flowVariant: "full",
    outcome: "observed",
    pathname: "/",
    persistenceState: "failed",
    recoveryRequired: true,
    runtime: "mobile",
    source: "mobile_app",
    stage: "cleanup_backend_confirm",
    timestamp: new Date(NOW).toISOString(),
  };
}

describe("lifecycle recovery events", () => {
  test("accepts failed full-withdrawal cleanup persistence", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      cleanupRecoveryEnvelope(),
      NOW
    );

    expect(parsed.stage).toBe("cleanup_backend_confirm");
    expect(parsed.recoveryRequired).toBe(true);
    expect(parsed.persistenceState).toBe("failed");
  });

  test("accepts confirmed chain state with pending routing projection", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      {
        ...cleanupRecoveryEnvelope(),
        errorCode: undefined,
        persistenceState: "pending",
        recoveryRequired: undefined,
        stage: "ui_commit",
      },
      NOW
    );

    expect(parsed.chainState).toBe("confirmed");
    expect(parsed.persistenceState).toBe("pending");
  });
});
