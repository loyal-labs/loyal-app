import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import {
  createLoyalStatsAumAlert,
  sendLoyalStatsAumAlert,
} from "../stats-slack-alert.server";

const originalFetch = globalThis.fetch;
const raw = (value: string | number): bigint => BigInt(value);

describe("stats Slack AUM alerts", () => {
  beforeEach(() => {
    delete process.env.SLACK_STATS_WEBHOOK_URL;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    delete process.env.SLACK_STATS_WEBHOOK_URL;
    globalThis.fetch = originalFetch;
  });

  test("alerts only when the snapshot-to-snapshot change reaches 5,000 USDC", () => {
    const previous = raw("100000000000");

    expect(
      createLoyalStatsAumAlert(previous, previous + raw("4999999999"))
    ).toBeNull();
    expect(
      createLoyalStatsAumAlert(previous, previous - raw("4999999999"))
    ).toBeNull();

    expect(
      createLoyalStatsAumAlert(previous, previous + raw("5000000000"))
        ?.direction
    ).toBe("increased");
    expect(
      createLoyalStatsAumAlert(previous, previous - raw("5000000000"))
        ?.direction
    ).toBe("decreased");
  });

  test("formats positive and negative messages as human USDC values", () => {
    expect(
      createLoyalStatsAumAlert(raw("121125850000"), raw("126410220000"))?.text
    ).toBe("📈 Earn AUM increased by $5,284.37\nCurrent Earn AUM: $126,410.22");
    expect(
      createLoyalStatsAumAlert(raw("126410220000"), raw("120290220000"))?.text
    ).toBe("📉 Earn AUM decreased by $6,120.00\nCurrent Earn AUM: $120,290.22");
  });

  test("posts the alert payload to the configured webhook", async () => {
    process.env.SLACK_STATS_WEBHOOK_URL =
      "https://hooks.slack.com/services/test/stats/webhook";
    const fetchMock = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok", { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendLoyalStatsAumAlert(
      raw("121125850000"),
      raw("126410220000")
    );

    expect(result.status).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://hooks.slack.com/services/test/stats/webhook"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      text: "📈 Earn AUM increased by $5,284.37\nCurrent Earn AUM: $126,410.22",
    });
  });

  test("keeps missing configuration and delivery failures non-throwing", async () => {
    expect(
      await sendLoyalStatsAumAlert(raw("100000000000"), raw("105000000000"))
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
      await sendLoyalStatsAumAlert(raw("100000000000"), raw("105000000000"))
    ).toMatchObject({ status: "failed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
