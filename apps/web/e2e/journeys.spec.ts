import { expect, test } from "@playwright/test";
import {
  summarizeJourneys,
  journeyFlowMetrics,
  journeyStepMetrics,
  type JourneyEvent,
} from "../../admin/src/app/(admin)/journeys/journey-summary";
import type {
  BrowserLifecycleEnvelope,
  LifecycleTracker,
} from "../src/features/observability/lifecycle-contract";
import type {
  createBrowserLifecycleTracker,
  createAuthenticatedActionTracker,
  lifecycleFlowHeaders,
} from "../src/features/observability/client";
import type { isDepositVisible } from "../src/features/observability/deposit-visibility";
import type { classifyTransactionFailure } from "../src/features/observability/transaction-failure";

declare global {
  interface Window {
    swapFixture: {
      quote: () => Promise<unknown>;
      execute: () => Promise<{ success: boolean }>;
      ready: boolean;
      transaction: string;
      update: (input: number, output: number, owner?: string) => void;
    };
    journeyFixture: {
      create: typeof createBrowserLifecycleTracker;
      authenticatedAction: typeof createAuthenticatedActionTracker;
      headers: typeof lifecycleFlowHeaders;
      reset: () => void;
      visible: typeof isDepositVisible;
      classify: typeof classifyTransactionFailure;
    };
    activeJourney: LifecycleTracker;
  }
}

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

for (const scenario of [
  "success",
  "fresh_user",
  "fresh_retry",
  "cancel",
  "oauth_cancel",
  "privy_error",
  "registration_delayed",
  "context_delayed",
  "missing_wallet",
  "backend_mismatch",
  "signer_mismatch",
  "connect_rejected",
  "connect_delayed",
] as const) {
  test(`real Privy controller: ${scenario}`, async ({ page }) => {
    await page.clock.install();
    const events: BrowserLifecycleEnvelope[] = [];
    let exchanges = 0;
    let exchangeHeaders: Record<string, string> = {};
    await page.route("**/api/observability/events", async (route) => {
      const event = route.request().postDataJSON();
      if (event.flowName === "auth.sign_in") events.push(event);
      await route.fulfill({ status: 202, json: { accepted: true } });
    });
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        status: 401,
        json: { error: { code: "unauthenticated" } },
      })
    );
    await page.route("**/api/auth/privy/complete", async (route) => {
      exchanges++;
      exchangeHeaders = route.request().headers();
      if (scenario === "fresh_retry" && exchanges === 1) {
        await route.fulfill({
          status: 503,
          json: { error: { message: "Controlled exchange failure" } },
        });
        return;
      }
      await route.fulfill({ json: { ok: true } });
    });
    const address =
      scenario === "backend_mismatch"
        ? "So11111111111111111111111111111111111111112"
        : "11111111111111111111111111111111";
    await page.route("**/api/auth/session/refresh", (route) =>
      route.fulfill({
        json: {
          user: {
            authMethod: "wallet",
            subjectAddress: address,
            walletAddress: address,
            displayAddress: address,
          },
          session: {
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            refreshAfter: new Date(Date.now() + 600000).toISOString(),
          },
        },
      })
    );
    await page.goto(`/auth?scenario=${scenario}`);
    await expect(page.getByLabel("Session state")).toHaveText("Anonymous");
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    if (
      ["registration_delayed", "context_delayed", "missing_wallet"].includes(
        scenario
      )
    ) {
      await expect(page.getByLabel("Session state")).toHaveText(
        "Authenticated"
      );
      await page.clock.fastForward(
        scenario === "missing_wallet" ? 120_001 : 1000
      );
      if (scenario !== "missing_wallet") {
        expect(
          events.some((event) =>
            ["failed", "completed"].includes(event.outcome)
          )
        ).toBe(false);
        await page
          .getByRole("button", {
            name: "Finish wallet connection",
            exact: true,
          })
          .click();
      }
    }
    if (scenario === "privy_error") {
      await expect(page.getByRole("alert")).toContainText(
        "Sign-in could not be completed"
      );
      await expect(page.getByLabel("Account modal")).toHaveText("Closed");
      await expect
        .poll(() =>
          events.some(
            (event) =>
              event.errorMessage === "Privy login: unknown_connect_wallet_error"
          )
        )
        .toBe(true);
      await page.getByRole("button", { name: "Try signing in again" }).click();
      await expect
        .poll(() => events.some((event) => event.outcome === "completed"))
        .toBe(true);
    }
    if (scenario === "connect_delayed") {
      await expect
        .poll(() =>
          events.some((event) => event.stage === "backend_session_valid")
        )
        .toBe(true);
      await page.clock.fastForward(120_001);
      await expect
        .poll(() =>
          events.some(
            (event) =>
              event.outcome === "timed_out" && event.stage === "wallet_connect"
          )
        )
        .toBe(true);
      expect(
        events.some((event) => ["failed", "completed"].includes(event.outcome))
      ).toBe(false);
      await page
        .getByRole("button", { name: "Finish wallet connection", exact: true })
        .click();
    }
    await expect
      .poll(() =>
        events.some((event) =>
          ["completed", "failed", "cancelled"].includes(event.outcome)
        )
      )
      .toBe(true);
    if (scenario === "fresh_retry") {
      expect(events.some((event) => event.outcome === "failed")).toBe(true);
      await expect(page.getByLabel("Sign-in step")).toHaveText("idle");
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await expect
        .poll(() => events.some((event) => event.outcome === "completed"))
        .toBe(true);
      const attempts = events.filter((event) => event.outcome === "started");
      expect(attempts).toHaveLength(2);
      expect(attempts[0].journeyId).toBe(attempts[1].journeyId);
      expect(attempts[1].attemptNumber).toBe(2);
      expect(events.some((event) => event.outcome === "failed")).toBe(true);
    }
    const terminal = events
      .filter((event) =>
        ["completed", "failed", "cancelled"].includes(event.outcome)
      )
      .at(-1)!;
    expect(JSON.stringify(events)).not.toContain("controlled-identity-fixture");
    await expect(page.getByLabel("Account modal")).toHaveText("Closed");
    if (scenario === "cancel" || scenario === "oauth_cancel") {
      expect(terminal.outcome).toBe("cancelled");
      expect(exchanges).toBe(0);
      await expect(page.getByLabel("Session state")).toHaveText("Anonymous");
      return;
    }
    expect(exchanges).toBe(scenario === "fresh_retry" ? 2 : 1);
    await expect(page.getByLabel("Created wallets")).toHaveText(
      scenario.startsWith("fresh_") ? "1" : "0"
    );
    expect(exchangeHeaders["x-loyal-flow-id"]).toBe(terminal.flowId);
    expect(exchangeHeaders.traceparent).toBe(
      `00-${terminal.traceId}-${terminal.spanId}-01`
    );
    await expect(page.getByLabel("Session state")).toHaveText("Authenticated");
    if (
      ["privy_error", "registration_delayed", "context_delayed"].includes(
        scenario
      ) ||
      scenario === "success" ||
      scenario === "connect_delayed" ||
      scenario.startsWith("fresh_")
    ) {
      expect(terminal.outcome).toBe("completed");
      const stages = events.map((event) => event.stage);
      expect(stages.indexOf("privy_authenticated")).toBeLessThan(
        stages.indexOf("backend_session_valid")
      );
      expect(stages.indexOf("backend_session_valid")).toBeLessThan(
        stages.indexOf("signer_ready")
      );
    } else {
      expect(terminal.outcome).toBe("failed");
      expect(terminal.errorCode).toBe(
        scenario === "missing_wallet"
          ? "wallet_unavailable"
          : scenario === "connect_rejected"
          ? "wallet_connection_failed"
          : "wallet_account_mismatch"
      );
      expect(terminal.stage).toBe(
        scenario === "backend_mismatch" ? "session_refresh" : "wallet_connect"
      );
      expect(
        events.some(
          (event) =>
            event.stage === "signer_ready" || event.outcome === "completed"
        )
      ).toBe(false);
    }
  });
}

test("real swap hook waits for both rendered balance changes after confirmation", async ({
  page,
}) => {
  await page.clock.install();
  const events: BrowserLifecycleEnvelope[] = [];
  await page.route("**/api/observability/events", async (route) => {
    const event = route.request().postDataJSON();
    if (event.flowName === "wallet.swap") events.push(event);
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.route("https://api.jup.ag/**", async (route) => {
    if (route.request().method() === "POST") {
      const wire = await page.evaluate(() => window.swapFixture.transaction);
      await route.fulfill({ json: { swapTransaction: wire } });
    } else {
      await route.fulfill({
        json: {
          inputMint: "input",
          outputMint: "output",
          inAmount: "1000000",
          outAmount: "1000000",
          priceImpactPct: "0",
          otherAmountThreshold: "990000",
        },
      });
    }
  });
  await page.goto("/swap");
  await page.evaluate(() => window.swapFixture.quote());
  await expect
    .poll(() => page.evaluate(() => window.swapFixture.ready))
    .toBe(true);
  expect(await page.evaluate(() => window.swapFixture.execute())).toMatchObject(
    { success: true }
  );
  await expect
    .poll(() => events.some((event) => event.stage === "ui_commit"))
    .toBe(true);
  expect(events.some((event) => event.outcome === "completed")).toBe(false);
  await page.clock.fastForward(60_001);
  await expect
    .poll(() =>
      events.some(
        (event) =>
          event.outcome === "timed_out" && event.stage === "balance_visible"
      )
    )
    .toBe(true);
  await page.evaluate(() => window.swapFixture.update(9, 0));
  await expect(page.getByLabel("Swap balances")).toHaveText(
    "input: 9, output: 0"
  );
  expect(events.some((event) => event.outcome === "completed")).toBe(false);
  await page.evaluate(() => window.swapFixture.update(9, 1));
  await expect(page.getByLabel("Swap balances")).toHaveText(
    "input: 9, output: 1"
  );
  await expect
    .poll(() => events.filter((event) => event.outcome === "completed").length)
    .toBe(1);
  expect(events.find((event) => event.outcome === "completed")?.stage).toBe(
    "balance_visible"
  );
  await page.evaluate(() => window.swapFixture.update(8, 2));
  await expect(page.getByLabel("Swap balances")).toHaveText(
    "input: 8, output: 2"
  );
  expect(events.filter((event) => event.outcome === "completed")).toHaveLength(
    1
  );
  const rows = events.map((event) => ({
    ...event,
    time: Date.parse(event.timestamp),
    attemptId: event.flowId,
    flow: event.flowName,
    variant: event.flowVariant,
    release: event.clientBuildId,
    userId: "fixture",
    errorCategory: event.outcome === "failed" ? "technical" : "none",
    rumSessionId: "",
  })) as JourneyEvent[];
  const matureAt = rows[0].time + 700_000;
  expect(
    journeyFlowMetrics(summarizeJourneys(rows, matureAt))[0]
  ).toMatchObject({
    firstAttemptSuccess: 0,
    eventualSuccess: 1,
    stalls: 1,
    unresolved: 0,
  });
  const confirmationOnly = rows
    .filter((event) => event.stage !== "balance_visible")
    .map((event) =>
      event.stage === "ui_commit" ? { ...event, outcome: "completed" } : event
    );
  expect(summarizeJourneys(confirmationOnly, matureAt)[0].eventualSuccess).toBe(
    false
  );
});

test("fresh-wallet simulation failure and recovery preserve first-attempt failure through dashboard aggregation", async ({
  page,
}, testInfo) => {
  const events: BrowserLifecycleEnvelope[] = [];
  await page.route("**/api/observability/events", async (route) => {
    const event = route.request().postDataJSON();
    if (event.flowName === "earn.deposit") events.push(event);
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("/");
  await page.evaluate(() => {
    const fixture = window.journeyFixture;
    const first = fixture.create({
      flowName: "earn.deposit",
      flowVariant: "initial",
    });
    first.start("intent");
    const error = Object.assign(new Error("Missing setup account"), {
      name: "SquadsMissingAccountSimulationError",
    });
    first.fail("preflight", {
      errorCode: fixture.classify(error),
      chainState: "not_submitted",
    });
    first.complete("position_visible"); // A terminal failure must not be erased.
    const retry = fixture.create({
      flowName: "earn.deposit",
      flowVariant: "resumed",
    });
    retry.start("intent");
    retry.observe("wallet_submit_confirm", { chainState: "submitted" });
    window.activeJourney = retry;
  });
  await expect.poll(() => events.length).toBe(4);
  expect(events.some((event) => event.outcome === "completed")).toBe(false);
  await page.evaluate(() => {
    const fixture = window.journeyFixture;
    const holding = {
      reserve: "fixture",
      amountRaw: "1",
      observedSlot: "10",
      provenance: { source: "earn_deposit_confirmation" },
    };
    if (fixture.visible([holding], "fixture", "10"))
      throw new Error("Optimistic state counted as success");
    holding.provenance.source = "rpc_getMultipleAccounts";
    if (fixture.visible([holding], "fixture", "11"))
      throw new Error("Stale state counted as success");
    holding.observedSlot = "11";
    if (fixture.visible([holding], "fixture", "11"))
      window.activeJourney.complete("position_visible", {
        chainState: "confirmed",
        persistenceState: "recorded",
      });
  });
  await expect.poll(() => events.length).toBe(5);
  expect(events[0].journeyId).toBe(events[2].journeyId);
  expect(events[0].flowId).not.toBe(events[2].flowId);
  const start = Date.now() - 700_000;
  const rows: JourneyEvent[] = events.map((event, index) => ({
    ...event,
    time: start + index * 1000,
    attemptId: event.flowId,
    flow: event.flowName,
    variant: event.flowVariant,
    release: event.clientBuildId,
    userId: "fixture",
    errorCategory: event.outcome === "failed" ? "technical" : "none",
    rumSessionId: "",
  })) as JourneyEvent[];
  await testInfo.attach("journey-events", {
    body: JSON.stringify(rows),
    contentType: "application/json",
  });
  const metrics = journeyFlowMetrics(
    summarizeJourneys([...rows, ...rows], Date.now())
  )[0];
  expect(metrics).toMatchObject({
    volume: 1,
    denominator: 1,
    firstAttemptSuccess: 0,
    eventualSuccess: 1,
    failures: 1,
    affectedUsers: 1,
  });
  const steps = journeyStepMetrics(
    [...rows, ...rows],
    summarizeJourneys(rows, Date.now())
  );
  expect(steps.find((step) => step.stage === "preflight")).toMatchObject({
    reached: 1,
    technicalFailures: 1,
    completed: 0,
  });
  expect(steps.find((step) => step.stage === "position_visible")).toMatchObject(
    { reached: 1, technicalFailures: 0, completed: 1, retries: 1 }
  );
});

test("delayed deposit visibility records a timeout and later recovery without restoring first-attempt success", async ({
  page,
}) => {
  const events: BrowserLifecycleEnvelope[] = [];
  await page.route("**/api/observability/events", async (route) => {
    const event = route.request().postDataJSON();
    if (event.flowName === "earn.deposit") events.push(event);
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("/");
  await page.evaluate(() => {
    const tracker = window.journeyFixture.create({
      flowName: "earn.deposit",
      flowVariant: "initial",
    });
    tracker.start("intent");
    tracker.observe("wallet_submit_confirm", { chainState: "submitted" });
    tracker.timeout("position_visible", {
      chainState: "confirmed",
      persistenceState: "recorded",
      errorCode: "request_failed",
      errorDetail: "request_timeout",
    });
    window.activeJourney = tracker;
  });
  await expect.poll(() => events.length).toBe(3);
  expect(events.some((event) => event.outcome === "completed")).toBe(false);
  await page.evaluate(() => {
    window.activeJourney.complete("position_visible", {
      chainState: "confirmed",
      persistenceState: "recorded",
    });
    window.activeJourney.complete("position_visible");
  });
  await expect.poll(() => events.length).toBe(4);
  const now = Date.now();
  const rows = events.map((event, index) => ({
    ...event,
    time: now - 700_000 + index * 1000,
    attemptId: event.flowId,
    flow: event.flowName,
    variant: event.flowVariant,
    release: event.clientBuildId,
    userId: "fixture",
    errorCategory: event.outcome === "failed" ? "technical" : "none",
    rumSessionId: "",
  })) as JourneyEvent[];
  expect(journeyFlowMetrics(summarizeJourneys(rows, now))[0]).toMatchObject({
    volume: 1,
    denominator: 1,
    firstAttemptSuccess: 0,
    eventualSuccess: 1,
    unresolved: 0,
    failures: 0,
    stalls: 1,
    affectedUsers: 1,
  });
  expect(summarizeJourneys(rows, now)[0].stall?.stage).toBe("position_visible");
  expect(events[2].outcome).toBe("timed_out");
  expect(events[3].flowId).toBe(events[2].flowId);
});

test("rejection and unavailable telemetry never block an action; account switches separate journeys", async ({
  page,
}) => {
  const events: BrowserLifecycleEnvelope[] = [];
  await page.route("**/api/observability/events", (route) => {
    const event = route.request().postDataJSON();
    if (event.flowName === "auth.sign_in") events.push(event);
    return route.abort();
  });
  await page.goto("/");
  const result = await page.evaluate(() => {
    const fixture = window.journeyFixture;
    const first = fixture.create({
      flowName: "auth.sign_in",
      flowVariant: "interactive",
    });
    first.start("intent");
    const code = fixture.classify(
      Object.assign(new Error("User rejected"), { code: 4001 })
    );
    first.cancel("wallet_approval", { errorCode: code });
    const stale = fixture.create({
      flowName: "auth.sign_in",
      flowVariant: "interactive",
    });
    stale.start("intent");
    fixture.reset();
    stale.fail("completion", { errorCode: "request_failed" });
    const second = fixture.create({
      flowName: "auth.sign_in",
      flowVariant: "interactive",
    });
    second.start("intent");
    second.fail("signer_ready", { errorCode: "wallet_account_mismatch" });
    return {
      code,
      differentAttempt: first.flowId !== second.flowId,
      actionRan: true,
    };
  });
  expect(result).toEqual({
    code: "wallet_rejected",
    differentAttempt: true,
    actionRan: true,
  });
  await expect.poll(() => events.length).toBe(5);
  const starts = events.filter((event) => event.outcome === "started");
  expect(starts[0].journeyId).toBe(starts[1].journeyId);
  expect(starts[2].journeyId).not.toBe(starts[0].journeyId);
  expect(events.some((event) => event.errorCode === "request_failed")).toBe(
    false
  );
});

test("real session provider restores returning users and clears expired sessions", async ({
  page,
}) => {
  const now = Date.now();
  await page.clock.setFixedTime(now);
  let expired = false;
  const events: BrowserLifecycleEnvelope[] = [];
  await page.route("**/api/observability/events", async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill(
      expired
        ? { status: 401, json: { error: { code: "unauthenticated" } } }
        : {
            status: 200,
            json: {
              user: {
                authMethod: "wallet",
                subjectAddress: "fixture-wallet",
                walletAddress: "fixture-wallet",
                displayAddress: "fixture-wallet",
              },
              session: {
                expiresAt: new Date(now + 30 * 60_000).toISOString(),
                refreshAfter: new Date(now + 10 * 60_000).toISOString(),
              },
            },
          }
    )
  );
  await page.goto("/");
  await expect(page.getByLabel("Session state")).toHaveText("Authenticated");
  await expect
    .poll(() =>
      events.some(
        (event) =>
          event.stage === "backend_session_valid" &&
          event.outcome === "completed"
      )
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel("Session state")).toHaveText("Authenticated");
  expired = true;
  await page.clock.setFixedTime(now + 31 * 60_000);
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      return page.getByLabel("Session state").textContent();
    })
    .toBe("Anonymous");
  await expect
    .poll(() =>
      events.some(
        (event) =>
          event.flowVariant === "return" &&
          event.outcome === "cancelled" &&
          event.errorCode === "unauthenticated"
      )
    )
    .toBe(true);
});

test("authenticated action retries retain failure, propagate trace context and reset on account switch", async ({
  page,
}) => {
  const events: BrowserLifecycleEnvelope[] = [];
  await page.route("**/api/observability/events", async (route) => {
    const event = route.request().postDataJSON();
    if (event.flowName === "auth.authenticated_action") events.push(event);
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("/");
  const headers = await page.evaluate(() => {
    const fixture = window.journeyFixture;
    const first = fixture.authenticatedAction()!;
    first.start("intent");
    if (fixture.authenticatedAction() !== null)
      throw new Error("Concurrent readiness probes were not deduplicated");
    first.fail("backend_session_valid", {
      errorCode: "unauthenticated",
      httpStatus: 401,
    });
    const second = fixture.authenticatedAction()!;
    second.start("intent");
    second.complete("action_completed");
    if (fixture.authenticatedAction() !== null)
      throw new Error("Readiness reported more than once per identity");
    const headers = fixture.headers(second.flowId);
    fixture.reset();
    const nextUser = fixture.authenticatedAction()!;
    nextUser.start("intent");
    return headers;
  });
  await expect.poll(() => events.length).toBe(5);
  expect(events[0].journeyId).toBe(events[2].journeyId);
  expect(events[4].journeyId).not.toBe(events[0].journeyId);
  expect(headers.traceparent).toBe(
    `00-${events[2].traceId}-${events[2].spanId}-01`
  );
  expect(events[2].attemptNumber).toBe(2);
});

for (const scenario of [
  "success",
  "context_delayed",
  "registration_delayed",
  "missing_wallet",
  "signer_mismatch",
  "connect_rejected",
  "connect_delayed",
]) {
  test(`returning session restores signer: ${scenario}`, async ({ page }) => {
    await page.clock.install();
    const events: BrowserLifecycleEnvelope[] = [];
    let exchanges = 0;
    await page.route("**/api/observability/events", async (route) => {
      const event = route.request().postDataJSON();
      if (event.flowName === "auth.signer_restore") events.push(event);
      await route.fulfill({ status: 202, json: { accepted: true } });
    });
    await page.route("**/api/auth/privy/complete", async (route) => {
      exchanges++;
      await route.fulfill({ status: 500 });
    });
    const address = "11111111111111111111111111111111";
    const session = {
      user: {
        authMethod: "wallet",
        subjectAddress: address,
        walletAddress: address,
        displayAddress: address,
      },
      session: {
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        refreshAfter: new Date(Date.now() + 600000).toISOString(),
      },
    };
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: session })
    );
    await page.route("**/api/auth/session/refresh", (route) =>
      route.fulfill({ json: session })
    );
    await page.goto(`/auth?scenario=${scenario}`);
    await expect(page.getByLabel("Session state")).toHaveText("Authenticated");
    if (scenario === "connect_delayed") {
      await expect
        .poll(() => events.some((event) => event.stage === "wallet_connect"))
        .toBe(true);
      await page.clock.fastForward(30001);
      await expect
        .poll(
          () => events.filter((event) => event.outcome === "timed_out").length
        )
        .toBe(1);
      await page
        .getByRole("button", { name: "Finish wallet connection" })
        .click();
    }
    if (
      ["registration_delayed", "context_delayed", "missing_wallet"].includes(
        scenario
      )
    ) {
      await page.clock.fastForward(
        scenario === "missing_wallet" ? 30_001 : 1000
      );
      if (scenario !== "missing_wallet") {
        expect(
          events.some((event) =>
            ["failed", "completed"].includes(event.outcome)
          )
        ).toBe(false);
        await page
          .getByRole("button", {
            name: "Finish wallet connection",
            exact: true,
          })
          .click();
      }
    }
    const succeeds = [
      "success",
      "connect_delayed",
      "registration_delayed",
      "context_delayed",
    ].includes(scenario);
    await expect
      .poll(
        () =>
          events.filter(
            (event) => event.outcome === (succeeds ? "completed" : "failed")
          ).length
      )
      .toBe(1);
    await page
      .getByRole("button", { name: "Refresh session", exact: true })
      .click();
    await page.clock.fastForward(1000);
    expect(events.filter((event) => event.outcome === "started")).toHaveLength(
      1
    );
    expect(
      events.filter((event) => event.outcome === "completed")
    ).toHaveLength(succeeds ? 1 : 0);
    expect(exchanges).toBe(0);
    if (!succeeds)
      expect(
        events.find((event) => event.outcome === "failed")?.errorCode
      ).toBe(
        scenario === "missing_wallet"
          ? "wallet_unavailable"
          : scenario === "signer_mismatch"
          ? "wallet_account_mismatch"
          : "wallet_connection_failed"
      );
  });
}

for (const scenario of [
  "ready",
  "registration_delayed",
  "delayed",
  "rejected",
] as const) {
  test(`real wallet adapter: ${scenario}`, async ({ page }) => {
    const events: BrowserLifecycleEnvelope[] = [];
    await page.route("**/api/observability/events", async (route) => {
      events.push(route.request().postDataJSON());
      await route.fulfill({ status: 202, json: { accepted: true } });
    });
    await page.goto(`/standard?scenario=${scenario}`);
    await page.getByRole("button", { name: "Restore session signer" }).click();
    if (scenario === "registration_delayed" || scenario === "delayed") {
      await expect(page.getByLabel("Signer")).toHaveText("Disconnected");
      expect(events.some((event) => event.outcome === "failed")).toBe(false);
      await page.getByRole("button", { name: "Finish connection" }).click();
    }
    if (scenario === "rejected") {
      await expect
        .poll(() => events.some((event) => event.outcome === "cancelled"))
        .toBe(true);
      await expect(page.getByLabel("Signer")).toHaveText("Disconnected");
      return;
    }
    await expect(page.getByLabel("Signer")).toHaveText(
      "11111111111111111111111111111111"
    );
    await expect
      .poll(() => events.some((event) => event.outcome === "completed"))
      .toBe(true);
    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "Refresh Privy wallets" }).click();
      await expect(page.getByLabel("Adapters")).toHaveText("Privy");
    }
    await page.getByRole("button", { name: "Sign offline message" }).click();
    await expect(page.getByLabel("Signatures")).toHaveText("1");
    await page.getByRole("button", { name: "Switch account" }).click();
    await page.getByRole("button", { name: "Sign offline message" }).click();
    await expect(page.getByLabel("Error")).toHaveText("Wrong signer blocked");
    await expect(page.getByLabel("Signatures")).toHaveText("1");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Wrong wallet connected" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue signing" })
    ).toHaveCount(0);
    // Account changes happen in the wallet while the reconnect dialog is open.
    await page
      .getByRole("button", { name: "Restore account" })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await page.getByRole("button", { name: "Continue signing" }).click();
    await page.getByRole("button", { name: "Sign offline message" }).click();
    await expect(page.getByLabel("Signatures")).toHaveText("2");
  });
}

test("real wallet adapter: withdrawal reconnect stays usable after repeated Privy updates", async ({
  page,
}) => {
  await page.goto("/standard");
  await expect(page.getByLabel("Adapters")).toHaveText("Privy");
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "Refresh Privy wallets" }).click();
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Privy", exact: true })
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Privy", exact: true }).click();
  await page.getByRole("button", { name: "Continue signing" }).click();
  await page.getByRole("button", { name: "Sign offline message" }).click();
  await expect(page.getByLabel("Signatures")).toHaveText("1");
  await page.getByRole("button", { name: "Disconnect session signer" }).click();
  await expect(page.getByLabel("Signer")).toHaveText("Disconnected");
  await page.getByRole("button", { name: "Restore session signer" }).click();
  await expect(page.getByLabel("Signer")).toHaveText(
    "11111111111111111111111111111111"
  );
  await page.getByRole("button", { name: "Sign offline message" }).click();
  await expect(page.getByLabel("Signatures")).toHaveText("2");
});
