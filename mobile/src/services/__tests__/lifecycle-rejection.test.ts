// Guards the telemetry wire contract for wallet rejections (ASK-1859): a user
// declining a prompt must reach the ingest as outcome "cancelled" (severity
// INFO), not "failed" (ERROR, which pages on-call). Nothing in the type system
// or lint catches a regression here — both outcomes are valid strings — so the
// emitted envelope is asserted directly.

import { WalletRejectedError } from "@/lib/wallet/rejection";
import { UserRejectedSigningError } from "@/lib/wallet/sign-approval/with-confirmation";
import { WalletSessionError } from "@/lib/wallet/wallet-session-error";
import { mapLifecycleErrorCode, startLifecycleFlow } from "../observability";

// Hoisted above the imports by babel-plugin-jest-hoist.
jest.mock("expo-updates", () => ({
  channel: "production",
  runtimeVersion: "1.0.0",
  updateId: undefined,
}));
jest.mock("@/config/env", () => ({
  env: { earnApiBaseUrl: "https://example.test" },
}));

type Envelope = {
  outcome: string;
  stage: string;
  errorCode?: string;
  httpStatus?: number;
};

function captureEnvelopes(): Envelope[] {
  const sent: Envelope[] = [];
  global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
    sent.push(JSON.parse((init as { body: string }).body) as Envelope);
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  return sent;
}

function newFlow() {
  return startLifecycleFlow({
    flowName: "earn.withdrawal",
    flowVariant: "partial",
  });
}

describe("wallet rejection classification", () => {
  beforeEach(() => jest.clearAllMocks());

  it("maps every wallet-rejection source to wallet_rejected", () => {
    expect(mapLifecycleErrorCode(new WalletRejectedError())).toBe("wallet_rejected");
    expect(mapLifecycleErrorCode(new UserRejectedSigningError())).toBe("wallet_rejected");
  });

  it("still maps ordinary and coded failures to their own codes", () => {
    expect(mapLifecycleErrorCode(new Error("boom"))).toBe("unexpected_error");
    expect(mapLifecycleErrorCode(new TypeError("network"))).toBe("request_failed");
    expect(mapLifecycleErrorCode({ code: "unconfirmed_signature" })).toBe(
      "unconfirmed_signature",
    );
  });

  it("emits cancelled, not failed, when the user declines the prompt", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom("prepare", new WalletRejectedError());

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      outcome: "cancelled",
      stage: "prepare",
      errorCode: "wallet_rejected",
    });
  });

  it("still emits failed for a genuine error", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom("prepare", new Error("RPC exploded"));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      outcome: "failed",
      stage: "prepare",
      errorCode: "unexpected_error",
    });
  });

  it("preserves caller diagnostics while reclassifying the outcome", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom("autodeposit_close", new WalletRejectedError(), {
      autodepositCloseRequired: true,
    });

    expect(sent[0]).toMatchObject({
      outcome: "cancelled",
      autodepositCloseRequired: true,
      errorCode: "wallet_rejected",
    });
  });

  it("latches: a cancelled flow ignores a later blanket fail", async () => {
    const sent = captureEnvelopes();
    const flow = newFlow();
    flow.start("prepare");
    flow.failFrom("wallet_submit_confirm", new WalletRejectedError());
    flow.failFrom("prepare", new Error("outer catch"));

    expect(sent).toHaveLength(2);
    expect(
      sent.filter(({ outcome }) =>
        ["cancelled", "completed", "failed"].includes(outcome),
      ),
    ).toEqual([
      expect.objectContaining({
        outcome: "cancelled",
        errorCode: "wallet_rejected",
      }),
    ]);
  });

  // A multi-step flow prompts per step (MWA signs each in its own session), so
  // declining step 2 leaves step 1 confirmed on-chain with no backend record.
  // Silencing that to INFO would hide real, recoverable money movement.
  it("stays failed when the decline came after a step already landed", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom(
      "wallet_submit_confirm",
      new WalletRejectedError("declined", ["sig1"]),
    );

    expect(sent[0]).toMatchObject({
      outcome: "failed",
      errorCode: "wallet_rejected",
    });
  });

  it("treats a decline with no landed steps as a clean cancellation", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom(
      "wallet_submit_confirm",
      new WalletRejectedError("declined", []),
    );

    expect(sent[0]).toMatchObject({ outcome: "cancelled" });
  });
});

// A wallet session that never opened is not a request failure (ASK-1872). MWA
// rejects with a coded error, which the `code` probe used to collapse into
// `request_failed` — an alert naming an HTTP failure for a flow that never
// reached the network. Every code below must exist in the backend's
// LIFECYCLE_ERROR_CODES; the ingest drops envelopes carrying an unknown one.
describe("wallet session classification", () => {
  beforeEach(() => jest.clearAllMocks());

  it("maps each session failure to its own code, not request_failed", () => {
    expect(
      mapLifecycleErrorCode(new WalletSessionError("connection_failed")),
    ).toBe("wallet_connection_failed");
    expect(mapLifecycleErrorCode(new WalletSessionError("timeout"))).toBe(
      "wallet_connection_timeout",
    );
    expect(mapLifecycleErrorCode(new WalletSessionError("unavailable"))).toBe(
      "wallet_unavailable",
    );
    expect(mapLifecycleErrorCode(new WalletSessionError("signing_failed"))).toBe(
      "wallet_signing_failed",
    );
  });

  // The native module's own codes must not leak through the generic probe.
  it("classifies by failure even when the wallet code looks transport-level", () => {
    const error = new WalletSessionError("connection_failed", "EUNSPECIFIED");

    expect(mapLifecycleErrorCode(error)).toBe("wallet_connection_failed");
  });

  it("classifies a Seed Vault native signing code as wallet_signing_failed", () => {
    const nativeError = Object.assign(new Error("No activity available"), {
      code: "NO_ACTIVITY",
    });
    const error = new WalletSessionError(
      "signing_failed",
      nativeError.code,
      nativeError,
    );

    expect(mapLifecycleErrorCode(error)).toBe("wallet_signing_failed");
    expect(error.walletCode).toBe("NO_ACTIVITY");
    expect(error.cause).toBe(nativeError);
  });

  it("emits failed with the session code and no httpStatus", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom("prepare", new WalletSessionError("connection_failed"));

    expect(sent[0]).toMatchObject({
      outcome: "failed",
      stage: "prepare",
      errorCode: "wallet_connection_failed",
    });
    expect(sent[0].httpStatus).toBeUndefined();
  });
});

// `httpStatus` is what separates a backend that answered from an error raised
// with no response at all — the distinction this alert lacked.
describe("http status reporting", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reports the status when the backend answered", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom("prepare", { code: "context_failed", status: 502 });

    expect(sent[0]).toMatchObject({
      outcome: "failed",
      errorCode: "request_failed",
      httpStatus: 502,
    });
  });

  it("omits it when the request never got a response", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom("prepare", { code: undefined });

    expect(sent[0]).toMatchObject({ errorCode: "request_failed" });
    expect(sent[0]).not.toHaveProperty("httpStatus");
  });

  // Out-of-range values would make the ingest reject the whole envelope.
  it("drops a status the ingest would refuse", async () => {
    const sent = captureEnvelopes();
    newFlow().failFrom("prepare", { code: "weird", status: 0 });

    expect(sent[0]).not.toHaveProperty("httpStatus");
  });
});
