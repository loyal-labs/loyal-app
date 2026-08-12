import { describe, expect, test } from "bun:test";

import {
  lifecycleErrorMessage,
  MAX_LIFECYCLE_ERROR_MESSAGE_LENGTH,
  parseBrowserLifecycleEnvelope,
} from "./lifecycle-contract";

// `errorMessage` carries the underlying error's own words on a failure
// (ASK-2049): two Brave signing failures were undiagnosable because only the
// normalized `errorCode` survived. Unlike `errorDetail` it is free text, so
// its guarantee is the sanitizer, not an enum — every parse redacts
// identifier-shaped and secret-shaped substrings and caps the length.

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    durationMs: 10,
    elapsedMs: 10,
    flowId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    flowName: "auth.sign_in",
    flowVariant: "interactive",
    outcome: "failed",
    pathname: "/app",
    runtime: "browser",
    source: "browser",
    stage: "completion",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("lifecycle errorMessage", () => {
  test("is kept on a failed outcome", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({
        errorCode: "wallet_signing_failed",
        errorMessage: "WalletSignTransactionError: Transaction rejected",
      })
    );

    expect(parsed.errorMessage).toBe(
      "WalletSignTransactionError: Transaction rejected"
    );
  });

  test("redacts identifier-shaped substrings", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({
        errorMessage:
          "signer BGtzTW2yczjR7FCpSvKfcjxCw811Rdori8aY96ZJdQ51 missing",
      })
    );

    expect(parsed.errorMessage).toBe("signer [REDACTED_IDENTIFIER] missing");
  });

  test("is capped at the maximum length", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({ errorMessage: "x ".repeat(400) })
    );

    expect(parsed.errorMessage?.length).toBe(
      MAX_LIFECYCLE_ERROR_MESSAGE_LENGTH
    );
  });

  // A message on a healthy event is a caller bug, not a reason to lose the
  // event — and messages must only ever describe failures.
  test.each([["started"], ["observed"], ["completed"]])(
    "is dropped on a %s outcome",
    (outcome) => {
      const parsed = parseBrowserLifecycleEnvelope(
        envelope({
          errorMessage: "should not survive",
          outcome,
          stage: "intent",
        })
      );

      expect(parsed.errorMessage).toBeUndefined();
    }
  );

  test.each([
    ["a non-string value", 42],
    ["null", null],
    ["an empty string", ""],
  ])("drops %s without failing the envelope", (_label, errorMessage) => {
    const parsed = parseBrowserLifecycleEnvelope(envelope({ errorMessage }));

    expect(parsed.errorMessage).toBeUndefined();
    expect(parsed.outcome).toBe("failed");
  });
});

describe("lifecycle clientPlatform", () => {
  test.each([["desktop"], ["mobile"]] as const)(
    "accepts %s",
    (clientPlatform) => {
      const parsed = parseBrowserLifecycleEnvelope(
        envelope({ clientPlatform })
      );

      expect(parsed.clientPlatform).toBe(clientPlatform);
    }
  );

  // Bounded like `errorDetail`: an unknown value is dropped rather than
  // bucketed, and never costs the event.
  test.each([
    ["an unknown token", "smart_fridge"],
    ["a raw user agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"],
    ["a non-string value", 7],
  ])("drops %s without failing the envelope", (_label, clientPlatform) => {
    const parsed = parseBrowserLifecycleEnvelope(envelope({ clientPlatform }));

    expect(parsed.clientPlatform).toBeUndefined();
    expect(parsed.outcome).toBe("failed");
  });
});

describe("lifecycleErrorMessage", () => {
  test("formats an Error as name plus message", () => {
    expect(lifecycleErrorMessage(new Error("boom"))).toBe("Error: boom");
  });

  test("appends the wallet adapter's nested cause", () => {
    const wrapped = new Error("Transaction rejected") as Error & {
      error?: unknown;
    };
    wrapped.name = "WalletSignTransactionError";
    wrapped.error = new Error("simulation failed");

    expect(lifecycleErrorMessage(wrapped)).toBe(
      "WalletSignTransactionError: Transaction rejected <- Error: simulation failed"
    );
  });

  test("stringifies a non-Error", () => {
    expect(lifecycleErrorMessage("plain failure")).toBe("plain failure");
  });
});
