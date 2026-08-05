// Guards the cause token behind `request_failed` (ASK-2018). That code covers
// four unrelated incidents — the device is offline, our own deadline elapsed,
// Kamino is down, an RPC answered with an error — and when no response ever
// arrived there is no `httpStatus` to tell them apart. Nothing in the type
// system catches a regression, so the emitted envelope is asserted directly.
//
// Every token here must also exist in the backend's LIFECYCLE_ERROR_DETAILS
// (frontend/src/features/observability/lifecycle-contract.ts). The ingest
// drops an unknown detail silently, so a drift costs the field with no error.

import { WalletRejectedError } from "@/lib/wallet/rejection";
import {
  mapLifecycleErrorDetail,
  startLifecycleFlow,
} from "../observability";

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
  errorCode?: string;
  errorDetail?: string;
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
    flowVariant: "full",
  });
}

class FetchTimeoutError extends Error {
  constructor() {
    super("Fetch to https://example.test timed out after 12000ms");
    this.name = "FetchTimeoutError";
  }
}

// web3.js resolves to more than one module instance under Metro, so the real
// class is brand-checked by name rather than `instanceof` — mirror that here.
class SolanaJSONRPCError extends Error {
  readonly code: number;

  constructor(code: number) {
    super("failed to get account info");
    this.name = "SolanaJSONRPCError";
    this.code = code;
  }
}

describe("mapLifecycleErrorDetail", () => {
  test("reads a detail already classified at the throw site", () => {
    // What withConnectionRetry attaches: the cause it retried before giving up
    // is gone from the error that replaces it.
    const exhausted = Object.assign(new Error("Check your connection."), {
      name: "EarnApiError",
      detail: "kamino_upstream_unavailable",
    });

    expect(mapLifecycleErrorDetail(exhausted)).toBe(
      "kamino_upstream_unavailable",
    );
  });

  test("ignores a detail that is not a declared token", () => {
    const error = Object.assign(new Error("nope"), {
      detail: "kamino_is_having_a_bad_day",
    });

    expect(mapLifecycleErrorDetail(error)).toBeUndefined();
  });

  test("names our own elapsed deadline", () => {
    expect(mapLifecycleErrorDetail(new FetchTimeoutError())).toBe(
      "request_timeout",
    );
  });

  test("names a connection-level fetch failure", () => {
    expect(mapLifecycleErrorDetail(new TypeError("Network request failed"))).toBe(
      "network_unreachable",
    );
  });

  // The reason the message is matched and not just the type: every other
  // TypeError reaching a flow is a bug in our own code, and calling that a
  // dead network would send on-call looking at the wrong thing entirely.
  test("leaves a TypeError that is really a bug unexplained", () => {
    expect(
      mapLifecycleErrorDetail(new TypeError("undefined is not a function")),
    ).toBeUndefined();
  });

  test("names an RPC that answered with an error", () => {
    expect(mapLifecycleErrorDetail(new SolanaJSONRPCError(-32603))).toBe(
      "rpc_request_failed",
    );
  });

  test("says nothing when the cause is genuinely unknown", () => {
    expect(mapLifecycleErrorDetail(new Error("something broke"))).toBeUndefined();
    expect(mapLifecycleErrorDetail(undefined)).toBeUndefined();
  });
});

describe("errorDetail on the wire", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rides alongside request_failed when no response arrived", () => {
    const sent = captureEnvelopes();

    newFlow().failFrom("prepare", new TypeError("Network request failed"));

    const failed = sent.find((event) => event.outcome === "failed");
    expect(failed?.errorCode).toBe("request_failed");
    expect(failed?.errorDetail).toBe("network_unreachable");
    // Its absence is the signal that nothing ever answered.
    expect(failed?.httpStatus).toBeUndefined();
  });

  test("is omitted rather than guessed when the cause is unknown", () => {
    const sent = captureEnvelopes();

    newFlow().failFrom("prepare", new Error("something broke"));

    const failed = sent.find((event) => event.outcome === "failed");
    expect(failed?.errorCode).toBe("unexpected_error");
    expect("errorDetail" in (failed ?? {})) .toBe(false);
  });

  test("a call site's own detail wins over the derived one", () => {
    const sent = captureEnvelopes();

    newFlow().failFrom("prepare", new TypeError("Network request failed"), {
      errorDetail: "request_timeout",
    });

    expect(sent.find((event) => event.outcome === "failed")?.errorDetail).toBe(
      "request_timeout",
    );
  });

  // A declined prompt is a user decision, not a failure with a cause to name.
  test("stays off a wallet rejection", () => {
    const sent = captureEnvelopes();

    newFlow().failFrom("prepare", new WalletRejectedError());

    const terminal = sent.find((event) => event.outcome === "cancelled");
    expect(terminal?.errorCode).toBe("wallet_rejected");
    expect(terminal?.errorDetail).toBeUndefined();
  });
});
