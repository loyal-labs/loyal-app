import { expect, spyOn, test } from "bun:test";

import {
  createBrowserLifecycleTracker,
  resetBrowserJourneys,
  restoreBrowserJourneys,
} from "./client";
import type { BrowserLifecycleEnvelope } from "./lifecycle-contract";

test("reload resumes a failed journey only for the verified owner and logout removes it", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      location: { pathname: "/app" },
      setTimeout,
      clearTimeout,
    },
  });
  const events: BrowserLifecycleEnvelope[] = [];
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_input: unknown, init?: RequestInit) => {
        events.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      },
      { preconnect: globalThis.fetch.preconnect }
    )
  );
  try {
    resetBrowserJourneys();
    await restoreBrowserJourneys("fixture-owner-a");
    const first = createBrowserLifecycleTracker({
      flowName: "earn.deposit",
      flowVariant: "initial",
    });
    first.start("intent");
    first.fail("preflight", { errorCode: "simulation_failed" });
    const saved = storage.get("loyal.journeys.v2")!;
    expect(saved).not.toContain("fixture-owner-a");
    resetBrowserJourneys();
    storage.set("loyal.journeys.v2", saved);
    await restoreBrowserJourneys("fixture-owner-a");
    const retry = createBrowserLifecycleTracker({
      flowName: "earn.deposit",
      flowVariant: "resumed",
    });
    retry.start("intent");
    expect(events[2].journeyId).toBe(events[0].journeyId);
    expect(events[2].attemptNumber).toBe(2);
    resetBrowserJourneys();
    expect(storage.has("loyal.journeys.v2")).toBe(false);
    storage.set("loyal.journeys.v2", saved);
    await restoreBrowserJourneys("fixture-owner-b");
    createBrowserLifecycleTracker({
      flowName: "earn.deposit",
      flowVariant: "initial",
    }).start("intent");
    expect(events[3].journeyId).not.toBe(events[0].journeyId);
    expect(events[3].attemptNumber).toBe(1);
    resetBrowserJourneys();
    const lateRestore = restoreBrowserJourneys("fixture-owner-a");
    resetBrowserJourneys();
    await lateRestore;
    expect(storage.has("loyal.journeys.v2")).toBe(false);
  } finally {
    resetBrowserJourneys();
    fetchMock.mockRestore();
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
