import { describe, expect, test } from "bun:test";

import {
  LIFECYCLE_ERROR_DETAILS,
  parseBrowserLifecycleEnvelope,
} from "./lifecycle-contract";

// `errorDetail` names the cause behind a broad `errorCode` (ASK-1872): mobile
// wallet failures all collapse into a handful of categories, and this is what
// tells them apart inside one of them.
//
// Two invariants the type system cannot hold, both of which cost more than the
// field is worth if they break. It is an enum, so no string a client holds can
// reach the exported `loyal.error.detail` attribute — a character filter would
// not do, since base58 addresses, JWTs and API keys are built entirely from
// token-safe characters. And an unrecognized value is dropped rather than
// rejected, because the field only annotates an event and must never cost the
// event it describes.

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
        errorDetail: "mwa_unspecified",
      })
    );

    expect(parsed.errorDetail).toBe("mwa_unspecified");
    expect(parsed.errorCode).toBe("wallet_connection_failed");
  });

  test("accepts every declared token", () => {
    for (const detail of LIFECYCLE_ERROR_DETAILS) {
      expect(
        parseBrowserLifecycleEnvelope(envelope({ errorDetail: detail }))
          .errorDetail
      ).toBe(detail);
    }
  });

  // The whole reason this is an enum: every one of these is built from
  // characters a sanitizer would have waved through intact.
  test.each([
    ["a wallet address", "BGtzTW2yczjR7FCpSvKfcjxCw811Rdori8aY96ZJdQ51"],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1"],
    // Shaped like an API key without matching a real provider's pattern —
    // secret scanners flag the genuine article even in a test fixture.
    ["an API key", "EXAMPLE_NOT_A_REAL_KEY_0123456789abcdefghij"],
    ["a raw vendor code", "EUNSPECIFIED"],
  ])("never stores %s", (_label, errorDetail) => {
    expect(
      parseBrowserLifecycleEnvelope(envelope({ errorDetail })).errorDetail
    ).toBeUndefined();
  });

  // Each of these would otherwise cost the entire event.
  test.each([
    ["an unknown token", "mwa_something_new"],
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

  // A `request_failed` with no `httpStatus` never got a response, so the status
  // that would normally explain it is absent. These tokens are the only thing
  // separating "the device is offline" from "Kamino is down" (ASK-2018).
  test.each([
    ["network_unreachable"],
    ["request_timeout"],
    ["kamino_upstream_unavailable"],
    ["rpc_request_failed"],
  ])("carries %s on a statusless request_failed", (errorDetail) => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({ errorCode: "request_failed", errorDetail })
    );

    expect(parsed.errorDetail).toBe(errorDetail);
    expect(parsed.errorCode).toBe("request_failed");
    expect(parsed.httpStatus).toBeUndefined();
  });
});
