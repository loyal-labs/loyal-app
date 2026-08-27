import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));

type AlertModule = typeof import("../stats-slack-alert.server");
type EarnFlow = Parameters<AlertModule["createLoyalStatsEarnFlowAlert"]>[0];
let createLoyalStatsEarnFlowAlert: AlertModule["createLoyalStatsEarnFlowAlert"];
let sendLoyalStatsEarnFlowAlert: AlertModule["sendLoyalStatsEarnFlowAlert"];

const originalFetch = globalThis.fetch;
const raw = (value: string | number): bigint => BigInt(value);
const flow = (
  direction: "deposit" | "withdrawal",
  amountRaw: bigint
): EarnFlow => ({
  amountRaw,
  direction,
  eventId: BigInt(42),
  signature: "5ignature",
  walletAddress: "HtxtbgA4EhGXUTJg5vztYAtPrYezHfg5QBe4CXny8XcJ",
});

describe("stats Slack Earn flow alerts", () => {
  beforeAll(async () => {
    ({ createLoyalStatsEarnFlowAlert, sendLoyalStatsEarnFlowAlert } =
      await import("../stats-slack-alert.server"));
  });

  beforeEach(() => {
    delete process.env.SLACK_STATS_WEBHOOK_URL;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    delete process.env.SLACK_STATS_WEBHOOK_URL;
    globalThis.fetch = originalFetch;
  });

  test("alerts only when a finalized flow reaches 5,000 USDC", () => {
    expect(
      createLoyalStatsEarnFlowAlert(flow("deposit", raw("4999999999")))
    ).toBeNull();
    expect(
      createLoyalStatsEarnFlowAlert(flow("withdrawal", raw("4999999999")))
    ).toBeNull();

    expect(
      createLoyalStatsEarnFlowAlert(flow("deposit", raw("5000000000")))?.eventId
    ).toBe(BigInt(42));
    expect(
      createLoyalStatsEarnFlowAlert(flow("withdrawal", raw("5000000000")))
        ?.eventId
    ).toBe(BigInt(42));
  });

  test("formats finalized flows with wallet and Orb Markets links", () => {
    expect(
      createLoyalStatsEarnFlowAlert(flow("deposit", raw("5284370000")))?.text
    ).toBe(
      "📥 Earn deposit confirmed: $5,284.37\nWallet: <https://orbmarkets.io/address/HtxtbgA4EhGXUTJg5vztYAtPrYezHfg5QBe4CXny8XcJ|HtxtbgA4EhGXUTJg5vztYAtPrYezHfg5QBe4CXny8XcJ>\n<https://orbmarkets.io/tx/5ignature|View on Orb Markets>"
    );
    expect(
      createLoyalStatsEarnFlowAlert(flow("withdrawal", raw("6120000000")))?.text
    ).toContain("📤 Earn withdrawal confirmed: $6,120.00");
  });

  test("posts the finalized flow payload to the configured webhook", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL =
      "https://hooks.slack.com/services/test/stats/webhook";
    const fetchMock = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok", { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const earnFlow = flow("deposit", raw("5284370000"));
    const result = await sendLoyalStatsEarnFlowAlert(earnFlow);

    expect(result.status).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://hooks.slack.com/services/test/stats/webhook"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      text: createLoyalStatsEarnFlowAlert(earnFlow)?.text,
    });
  });

  test("keeps missing configuration and delivery failures non-throwing", async () => {
    expect(
      await sendLoyalStatsEarnFlowAlert(flow("deposit", raw("5000000000")))
    ).toMatchObject({ status: "not_configured" });

    process.env.SLACK_STATS_WEBHOOK_URL =
      "https://hooks.slack.com/services/test/stats/webhook";
    const fetchMock = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        throw new Error("Slack unavailable");
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(
      await sendLoyalStatsEarnFlowAlert(flow("withdrawal", raw("5000000000")))
    ).toMatchObject({ status: "failed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
