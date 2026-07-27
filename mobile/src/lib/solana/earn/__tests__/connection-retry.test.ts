// Mirrors the real KaminoUpstreamError. The retry predicate keys off this
// class, so a mock that drifts from `packages/smart-account-vaults` would make
// these tests pass while production keeps throwing through un-retried.
class MockKaminoUpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "KaminoUpstreamError";
    this.status = status;
  }
}

// Mirrors the real EarnApiError. Mocked rather than imported because
// `earn-api` reaches `@/config/env` → `@loyal-labs/solana-rpc`, whose ESM dist
// Jest does not transform.
class MockEarnApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "EarnApiError";
    this.code = code;
  }
}

jest.mock(
  "@loyal-labs/smart-account-vaults",
  () => ({
    KaminoUpstreamError: MockKaminoUpstreamError,
  }),
  { virtual: true },
);

jest.mock("../earn-api", () => ({
  EarnApiError: MockEarnApiError,
}));

// Keep the subject import after mock initialization: this test uses a virtual
// workspace-package mock that cannot be referenced before its declaration.
// eslint-disable-next-line import/first
import { withConnectionRetry } from "../connection-retry";

const EXHAUSTED = "network exhausted";

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// The helper sleeps between attempts; advance timers as they are scheduled so
// the assertions do not wait out the real 1s backoff.
async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await jest.runAllTimersAsync();
  const result = await settled;
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

describe("withConnectionRetry", () => {
  test("retries a transient Kamino 5xx and returns the eventual success", async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new MockKaminoUpstreamError(502, "bad gateway"))
      .mockResolvedValueOnce("prepared");

    await expect(
      runWithTimers(withConnectionRetry("device prepare", EXHAUSTED, run)),
    ).resolves.toBe("prepared");
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("retries a Kamino 429", async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new MockKaminoUpstreamError(429, "slow down"))
      .mockResolvedValueOnce("prepared");

    await expect(
      runWithTimers(withConnectionRetry("device prepare", EXHAUSTED, run)),
    ).resolves.toBe("prepared");
    expect(run).toHaveBeenCalledTimes(2);
  });

  // A rejected request is rejected identically on every retry — spending the
  // budget on it only delays the error the user needs to see.
  test("throws a Kamino 4xx straight through without retrying", async () => {
    const error = new MockKaminoUpstreamError(400, "bad request");
    const run = jest.fn().mockRejectedValue(error);

    await expect(
      runWithTimers(withConnectionRetry("device prepare", EXHAUSTED, run)),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("still retries RN connection-level TypeErrors", async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce("prepared");

    await expect(
      runWithTimers(withConnectionRetry("device prepare", EXHAUSTED, run)),
    ).resolves.toBe("prepared");
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("still throws a backend EarnApiError through untouched", async () => {
    const error = new MockEarnApiError("nope", "resolve_failed");
    const run = jest.fn().mockRejectedValue(error);

    await expect(
      runWithTimers(withConnectionRetry("device prepare", EXHAUSTED, run)),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  // A plain Error is a build/validation bug, not a network blip.
  test("throws an unbranded Error through without retrying", async () => {
    const error = new Error("Kamino did not return a withdraw instruction.");
    const run = jest.fn().mockRejectedValue(error);

    await expect(
      runWithTimers(withConnectionRetry("device prepare", EXHAUSTED, run)),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("gives up as EarnApiError once the retry budget is spent", async () => {
    const run = jest
      .fn()
      .mockRejectedValue(new MockKaminoUpstreamError(503, "unavailable"));

    await expect(
      runWithTimers(withConnectionRetry("device prepare", EXHAUSTED, run)),
    ).rejects.toThrow(EXHAUSTED);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
