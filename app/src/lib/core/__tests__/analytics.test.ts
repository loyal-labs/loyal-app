import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

const createClientCalls: Array<Record<string, unknown>> = [];
const trackCalls: Array<{ event: string; properties?: Record<string, unknown> }> = [];
const identifyCalls: string[] = [];
const setUserProfileCalls: Array<Record<string, unknown>> = [];

let currentEventContext: Record<string, unknown> = {};

mock.module("@loyal-labs/shared/analytics", () => ({
  createMixpanelBrowserClient: (config: Record<string, unknown>) => {
    createClientCalls.push(config);
    return {
      init: async () => {},
      setContext: (properties: Record<string, unknown>) => {
        currentEventContext = { ...properties };
      },
      clearContext: () => {
        currentEventContext = {};
      },
      track: (event: string, properties?: Record<string, unknown>) => {
        trackCalls.push({
          event,
          properties: {
            ...currentEventContext,
            ...(properties ?? {}),
          },
        });
      },
      identify: (distinctId: string) => {
        identifyCalls.push(distinctId);
      },
      reset: () => {},
      setUserProfile: (properties: Record<string, unknown>) => {
        setUserProfileCalls.push(properties);
      },
      setUserProfileOnce: () => {},
      __resetForTests: () => {
        currentEventContext = {};
      },
    };
  },
}));

mock.module("@/lib/core/config/public", () => ({
  publicEnv: {
    mixpanelToken: "test-mixpanel-token",
    mixpanelProxyPath: "/ingest",
    solanaEnv: "devnet",
  },
}));

let analytics: typeof import("../analytics");
const SUMMARY_ID = "123e4567-e89b-12d3-a456-426614174000";
const GROUP_CHAT_ID = "-1001234567890";
const VALID_START_PARAM = `sf1_${GROUP_CHAT_ID}_${SUMMARY_ID}`;

describe("app analytics facade", () => {
  beforeAll(async () => {
    analytics = await import("../analytics");
  });

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      location: { origin: "https://loyal.example" },
    };
    createClientCalls.length = 0;
    trackCalls.length = 0;
    identifyCalls.length = 0;
    setUserProfileCalls.length = 0;
    currentEventContext = {};
    analytics.__resetAnalyticsStateForTests();
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("applies devnet Mixpanel configuration on init", async () => {
    await analytics.initAnalytics();

    expect(createClientCalls).toEqual([
      {
        token: "test-mixpanel-token",
        apiHost: "https://loyal.example/ingest",
        debug: true,
        persistence: "localStorage",
        registerProperties: {
          app_mode: "demo",
          app_solana_env: "devnet",
        },
      },
    ]);
  });

  test("deduplicates Telegram identify/profile calls for the same user", () => {
    const identity = {
      telegramId: "123456789",
      firstName: "Ada",
      lastName: "Lovelace",
      username: "ada",
      photoUrl: "https://example.com/avatar.png",
      languageCode: "en",
      isPremium: true,
    };

    analytics.identifyTelegramUser(identity);
    analytics.identifyTelegramUser(identity);

    expect(identifyCalls).toEqual(["tg:123456789"]);
    expect(setUserProfileCalls).toHaveLength(1);
    expect(setUserProfileCalls[0]).toMatchObject({
      telegram_id: "123456789",
      telegram_username: "ada",
      telegram_language_code: "en",
      telegram_is_premium: true,
    });
  });

  test("refreshes the Telegram profile when tracked fields change", () => {
    analytics.identifyTelegramUser({
      telegramId: "123456789",
      firstName: "Ada",
      username: "ada",
      languageCode: "en",
    });
    analytics.identifyTelegramUser({
      telegramId: "123456789",
      firstName: "Ada",
      username: "ada",
      languageCode: "es",
    });

    expect(identifyCalls).toEqual(["tg:123456789"]);
    expect(setUserProfileCalls).toHaveLength(2);
    expect(setUserProfileCalls[1]).toMatchObject({
      telegram_language_code: "es",
    });
  });

  test("adds launch context to tracked events while context is set", () => {
    analytics.setTelegramLaunchContext({
      startParamRaw: VALID_START_PARAM,
      chatType: "channel",
      chatInstance: "99887766",
    });

    analytics.track("Page View", { path: "/telegram/wallet" });

    expect(trackCalls).toEqual([
      {
        event: "Page View",
        properties: {
          start_param_raw: VALID_START_PARAM,
          group_chat_id: GROUP_CHAT_ID,
          summary_id: SUMMARY_ID,
          path: "/telegram/wallet",
        },
      },
    ]);
  });

  test("uses none placeholders when launch start param is missing", () => {
    analytics.setTelegramLaunchContext({
      chatType: "channel",
      chatInstance: "99887766",
    });

    analytics.track("Page View", { path: "/telegram/wallet" });

    expect(trackCalls).toEqual([
      {
        event: "Page View",
        properties: {
          start_param_raw: "none",
          group_chat_id: "none",
          summary_id: "none",
          path: "/telegram/wallet",
        },
      },
    ]);
  });

  test("stops attaching launch context after clear", () => {
    analytics.setTelegramLaunchContext({
      startParamRaw: VALID_START_PARAM,
      chatType: "channel",
      chatInstance: "99887766",
    });
    analytics.clearTelegramLaunchContext();

    analytics.track("Page View", { path: "/telegram/wallet" });

    expect(trackCalls).toEqual([
      {
        event: "Page View",
        properties: {
          path: "/telegram/wallet",
        },
      },
    ]);
  });
});
