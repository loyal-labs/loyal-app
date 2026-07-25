import { describe, expect, test } from "bun:test";

import { parseBrowserLifecycleEnvelope } from "./lifecycle-contract";

// `errorDetail` names the cause behind a broad `errorCode` (ASK-1872): mobile
// wallet failures all collapse into a handful of categories, and this is what
// distinguishes `EUNSPECIFIED` from `ERROR_SESSION_TIMEOUT` inside one of them.
//
// Two invariants the type system cannot hold. The envelope parser rejects
// unknown keys outright, so a client sending this before the field exists
// loses the whole event — and because it only ever *adds* detail, a malformed
// value must be dropped rather than take the event down with it.

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    durationMs: 10,
    elapsedMs: 10,
    flowId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    flowName: "earn.withdrawal",
    flowVariant: "full",
    outcome: "failed",
    pathname: "/",
    runtime: "browser",
    source: "browser",
    stage: "prepare",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("lifecycle errorDetail", () => {
  test("is accepted alongside a category error code", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({
        errorCode: "wallet_connection_failed",
        errorDetail: "EUNSPECIFIED",
      })
    );

    expect(parsed.errorDetail).toBe("EUNSPECIFIED");
    expect(parsed.errorCode).toBe("wallet_connection_failed");
  });

  test("keeps the tokens real wallet codes are made of", () => {
    expect(
      parseBrowserLifecycleEnvelope(
        envelope({ errorDetail: "ERROR_SESSION_TIMEOUT" })
      ).errorDetail
    ).toBe("ERROR_SESSION_TIMEOUT");
    expect(
      parseBrowserLifecycleEnvelope(envelope({ errorDetail: "-100" }))
        .errorDetail
    ).toBe("-100");
  });

  // The character class is the guard against prose — and anything hiding in
  // it — reaching telemetry intact.
  test("mangles prose instead of storing it verbatim", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({ errorDetail: "user 5CjK@mail failed at 10:31" })
    );

    expect(parsed.errorDetail).not.toContain("@");
    expect(parsed.errorDetail).not.toContain(" ");
  });

  test("truncates rather than storing an unbounded string", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({ errorDetail: "E".repeat(500) })
    );

    expect(parsed.errorDetail!.length).toBeLessThanOrEqual(64);
  });

  // Each of these would otherwise cost the entire event.
  test.each([
    ["a value that normalizes away", "   "],
    ["a non-string value", 42],
    ["null", null],
  ])("drops %s without failing the envelope", (_label, errorDetail) => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({ errorCode: "wallet_connection_failed", errorDetail })
    );

    expect(parsed.errorDetail).toBeUndefined();
    expect(parsed.errorCode).toBe("wallet_connection_failed");
  });

  test("is optional", () => {
    expect(parseBrowserLifecycleEnvelope(envelope()).errorDetail).toBeUndefined();
  });
});
