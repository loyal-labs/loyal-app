import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import {
  evaluateRoutingBalances,
  formatSolLamports,
  type RoutingBalanceAlertState,
  runRoutingBalanceWatchdog,
  shortenPublicKey,
  toRoutingBalanceBucket,
} from "../routing-balance-alert.server";

const KEY_A = "RoutingKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
const KEY_B = "RoutingKeyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2";

const WEBHOOK_URL = "https://hooks.slack.com/services/test/stats/webhook";
const MENTIONS = "U01AAA,U02BBB,U03CCC";

const originalFetch = globalThis.fetch;

/** Balances are easier to read as SOL in the tests than as raw lamports. */
const sol = (value: string): bigint => {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(9, "0").slice(0, 9)}`);
};

const balance = (publicKey: string, value: string) => ({
  lamports: sol(value),
  publicKey,
});

const clearEnv = (): void => {
  delete process.env.SLACK_STATS_WEBHOOK_URL;
  delete process.env.SLACK_ALERT_MENTION_USER_IDS;
  globalThis.fetch = originalFetch;
};

const mockSlackOk = () => {
  const fetchMock = mock(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("ok", { status: 200 })
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const postedTexts = (fetchMock: ReturnType<typeof mockSlackOk>): string[] =>
  fetchMock.mock.calls.map(
    (call) => JSON.parse(String(call[1]?.body)).text as string
  );

describe("routing key low-balance watchdog", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test("buckets balances into 0.1 SOL steps", () => {
    expect(toRoutingBalanceBucket(sol("1"))).toBe(10);
    expect(toRoutingBalanceBucket(sol("0.99"))).toBe(9);
    expect(toRoutingBalanceBucket(sol("0.9"))).toBe(9);
    expect(toRoutingBalanceBucket(sol("0.05"))).toBe(0);
    expect(toRoutingBalanceBucket(BigInt(0))).toBe(0);
  });

  test("formats balances and public keys for humans", () => {
    expect(formatSolLamports(sol("0.4321"))).toBe("0.4321");
    expect(formatSolLamports(sol("12.5"))).toBe("12.5000");
    // Truncates so a low balance is never reported as higher than it is.
    expect(formatSolLamports(sol("0.99999"))).toBe("0.9999");
    expect(shortenPublicKey(KEY_A)).toBe("Rout…AAA1");
  });

  test("stays silent while every key is at or above 1 SOL", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockSlackOk();

    const result = await runRoutingBalanceWatchdog(
      [balance(KEY_A, "1"), balance(KEY_B, "42.5")],
      {}
    );

    expect(result.deliveries).toEqual([]);
    expect(result.nextState).toEqual({});
    expect(result.stateChanged).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("alerts on the first crossing below 1 SOL with mentions", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL = WEBHOOK_URL;
    process.env.SLACK_ALERT_MENTION_USER_IDS = MENTIONS;
    const fetchMock = mockSlackOk();

    const result = await runRoutingBalanceWatchdog(
      [balance(KEY_A, "0.94")],
      {}
    );

    expect(result.deliveries).toMatchObject([{ status: "sent" }]);
    expect(result.nextState).toEqual({ [KEY_A]: 9 });
    expect(result.stateChanged).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedTexts(fetchMock)[0]).toBe(
      "🪫 Routing key `Rout…AAA1` is low: 0.9400 SOL — top me up <@U01AAA> <@U02BBB> <@U03CCC>"
    );
  });

  test("re-alerts once per further 0.1 SOL step down", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockSlackOk();

    let state: RoutingBalanceAlertState = {};
    const observed: number[] = [];

    for (const value of ["0.94", "0.85", "0.72", "0.61", "0.09"]) {
      const result = await runRoutingBalanceWatchdog(
        [balance(KEY_A, value)],
        state
      );
      state = result.nextState;
      observed.push(result.deliveries.length);
    }

    expect(observed).toEqual([1, 1, 1, 1, 1]);
    expect(state).toEqual({ [KEY_A]: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      postedTexts(fetchMock).map((text) => text.split(" is low: ")[1])
    ).toEqual([
      "0.9400 SOL — top me up",
      "0.8500 SOL — top me up",
      "0.7200 SOL — top me up",
      "0.6100 SOL — top me up",
      "0.0900 SOL — top me up",
    ]);
  });

  test("does not repeat an alert while the balance stays in the same bucket", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockSlackOk();

    const first = await runRoutingBalanceWatchdog([balance(KEY_A, "0.45")], {});
    expect(first.deliveries).toHaveLength(1);

    for (const value of ["0.45", "0.44", "0.41"]) {
      const repeat = await runRoutingBalanceWatchdog(
        [balance(KEY_A, value)],
        first.nextState
      );
      expect(repeat.deliveries).toEqual([]);
      expect(repeat.nextState).toEqual({ [KEY_A]: 4 });
      expect(repeat.stateChanged).toBe(false);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a partial top-up below 1 SOL neither alerts nor raises the bucket", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockSlackOk();

    const toppedUp = await runRoutingBalanceWatchdog([balance(KEY_A, "0.8")], {
      [KEY_A]: 3,
    });
    expect(toppedUp.deliveries).toEqual([]);
    expect(toppedUp.nextState).toEqual({ [KEY_A]: 3 });

    // Still quiet until it drops below the last alerted bucket again.
    const backDown = await runRoutingBalanceWatchdog(
      [balance(KEY_A, "0.35")],
      toppedUp.nextState
    );
    expect(backDown.deliveries).toEqual([]);

    const lower = await runRoutingBalanceWatchdog(
      [balance(KEY_A, "0.25")],
      toppedUp.nextState
    );
    expect(lower.deliveries).toHaveLength(1);
    expect(lower.nextState).toEqual({ [KEY_A]: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("recovering above 1 SOL clears state so the next drop alerts again", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockSlackOk();

    const recovered = await runRoutingBalanceWatchdog([balance(KEY_A, "5")], {
      [KEY_A]: 2,
    });
    expect(recovered.deliveries).toEqual([]);
    expect(recovered.nextState).toEqual({});
    expect(recovered.stateChanged).toBe(true);

    const droppedAgain = await runRoutingBalanceWatchdog(
      [balance(KEY_A, "0.95")],
      recovered.nextState
    );
    expect(droppedAgain.deliveries).toMatchObject([{ status: "sent" }]);
    expect(droppedAgain.nextState).toEqual({ [KEY_A]: 9 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("tracks each routing key independently", () => {
    const { alerts, state } = evaluateRoutingBalances(
      [balance(KEY_A, "0.31"), balance(KEY_B, "2")],
      { [KEY_A]: 5, [KEY_B]: 7 }
    );

    expect(alerts.map((alert) => alert.publicKey)).toEqual([KEY_A]);
    expect(alerts[0]?.bucket).toBe(3);
    // KEY_B recovered; KEY_A's new bucket is applied only once Slack accepts it.
    expect(state).toEqual({ [KEY_A]: 5 });
  });

  test("keys whose balance could not be read keep their remembered bucket", () => {
    const { alerts, state } = evaluateRoutingBalances([balance(KEY_A, "0.2")], {
      [KEY_A]: 5,
      [KEY_B]: 4,
    });

    expect(alerts).toHaveLength(1);
    expect(state[KEY_B]).toBe(4);
  });

  test("leaves the bucket unadvanced when Slack rejects the post", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        throw new Error("Slack unavailable");
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await runRoutingBalanceWatchdog([balance(KEY_A, "0.4")], {});

    expect(result.deliveries).toMatchObject([{ status: "failed" }]);
    expect(result.nextState).toEqual({});
    expect(result.stateChanged).toBe(false);
    // Same two-attempt retry behaviour as the AUM alert.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("reports missing webhook configuration without throwing", async () => {
    const result = await runRoutingBalanceWatchdog([balance(KEY_A, "0.4")], {});

    expect(result.deliveries).toMatchObject([{ status: "not_configured" }]);
    expect(result.nextState).toEqual({});
  });

  test("omits the mention suffix when no user IDs are configured", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockSlackOk();

    await runRoutingBalanceWatchdog([balance(KEY_A, "0.4")], {});

    expect(postedTexts(fetchMock)[0]).toBe(
      "🪫 Routing key `Rout…AAA1` is low: 0.4000 SOL — top me up"
    );
  });
});
