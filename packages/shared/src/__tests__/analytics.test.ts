import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

const initCalls: unknown[] = [];
const identifyCalls: string[] = [];
const trackCalls: Array<{ event: string; properties?: Record<string, unknown> }> = [];
const resetCalls: Array<undefined> = [];
const registerCalls: Array<Record<string, unknown>> = [];
const peopleSetOnceCalls: Array<Record<string, unknown>> = [];
const peopleSetCalls: Array<Record<string, unknown>> = [];
const peopleUnionCalls: Array<Record<string, unknown>> = [];
let shouldFailLoad = false;

const mixpanelMock = {
  init: (...args: unknown[]) => {
    initCalls.push(args);
  },
  track: (event: string, properties?: Record<string, unknown>) => {
    trackCalls.push({ event, properties });
  },
  identify: (distinctId: string) => {
    identifyCalls.push(distinctId);
  },
  reset: () => {
    resetCalls.push(undefined);
  },
  register: (properties: Record<string, unknown>) => {
    registerCalls.push(properties);
  },
  people: {
    set: (properties: Record<string, unknown>) => {
      peopleSetCalls.push(properties);
    },
    set_once: (properties: Record<string, unknown>) => {
      peopleSetOnceCalls.push(properties);
    },
    union: (properties: Record<string, unknown>) => {
      peopleUnionCalls.push(properties);
    },
  },
};

mock.module("mixpanel-browser", () => ({
  get default() {
    if (shouldFailLoad) {
      throw new Error("Failed to load Mixpanel");
    }

    return mixpanelMock;
  },
}));

let analytics: typeof import("../analytics");

describe("shared analytics client factory", () => {
  beforeAll(async () => {
    analytics = await import("../analytics");
  });

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
    initCalls.length = 0;
    identifyCalls.length = 0;
    trackCalls.length = 0;
    resetCalls.length = 0;
    registerCalls.length = 0;
    peopleSetCalls.length = 0;
    peopleSetOnceCalls.length = 0;
    peopleUnionCalls.length = 0;
    shouldFailLoad = false;
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("initializes only once", async () => {
    const client = analytics.createMixpanelBrowserClient({
      token: "test-mixpanel-token",
      apiHost: "https://loyal.example/ingest",
      persistence: "localStorage",
      defaultEventProperties: {
        workspace: "website",
      },
      registerProperties: {
        workspace: "website",
      },
    });

    await client.init();
    await client.init();

    expect(initCalls).toEqual([
      [
        "test-mixpanel-token",
        {
          api_host: "https://loyal.example/ingest",
          debug: false,
          track_pageview: false,
          persistence: "localStorage",
        },
      ],
    ]);
    expect(registerCalls).toEqual([{ workspace: "website" }]);
  });

  test("missing token makes calls no-op", async () => {
    const client = analytics.createMixpanelBrowserClient({});

    await client.init();
    client.track("Page View");
    client.identify("user-1");
    client.setUserProfile({ role: "admin" });
    client.setUserProfileOnce({ role: "admin" });
    client.reset();

    expect(initCalls).toHaveLength(0);
    expect(trackCalls).toHaveLength(0);
    expect(identifyCalls).toHaveLength(0);
    expect(peopleSetCalls).toHaveLength(0);
    expect(peopleSetOnceCalls).toHaveLength(0);
    expect(resetCalls).toHaveLength(0);
  });

  test("retries init after a load failure", async () => {
    shouldFailLoad = true;
    const client = analytics.createMixpanelBrowserClient({
      token: "test-mixpanel-token",
      apiHost: "https://loyal.example/ingest",
      persistence: "localStorage",
      defaultEventProperties: {
        workspace: "bot",
      },
    });

    await client.init();
    shouldFailLoad = false;
    await client.init();

    expect(initCalls).toHaveLength(1);
  });

  test("merges context into tracked events", async () => {
    const client = analytics.createMixpanelBrowserClient({
      token: "test-mixpanel-token",
      apiHost: "https://loyal.example/ingest",
      persistence: "localStorage",
      defaultEventProperties: {
        workspace: "website",
      },
    });

    await client.init();
    client.setContext({
      path_group: "wallet",
    });
    client.track("Page View", { path: "/wallet" });
    await Promise.resolve();

    expect(trackCalls).toEqual([
      {
        event: "Page View",
        properties: {
          workspace: "website",
          path_group: "wallet",
          path: "/wallet",
        },
      },
    ]);
  });

  test("identify, setUserProfile, setUserProfileOnce, and reset delegate after init", async () => {
    const client = analytics.createMixpanelBrowserClient({
      token: "test-mixpanel-token",
      apiHost: "https://loyal.example/ingest",
      persistence: "localStorage",
      defaultEventProperties: {
        workspace: "miniapp",
      },
    });

    await client.init();
    client.identify("grid:user-1");
    client.setUserProfile({ email: "user@example.com" });
    client.setUserProfileOnce({ auth_method: "wallet" });
    client.unionUserProfile({ workspaces: ["miniapp"] });
    client.reset();
    await Promise.resolve();

    expect(identifyCalls).toEqual(["grid:user-1"]);
    expect(peopleSetCalls).toEqual([{ email: "user@example.com" }]);
    expect(peopleSetOnceCalls).toEqual([{ auth_method: "wallet" }]);
    expect(peopleUnionCalls).toEqual([{ workspaces: ["miniapp"] }]);
    expect(resetCalls).toHaveLength(1);
  });
});
