import { expect, test } from "bun:test";
import { isVoltrOperationVisible } from "../earn-max/voltr/visibility";
import { isSwapVisible } from "./swap-visibility";

import {
  type BrowserLifecycleEnvelope,
  createLifecycleTracker,
  parseBrowserLifecycleEnvelope,
} from "./lifecycle-contract";
import { buildOtlpLifecyclePayload, isAlertableLifecycleEvent } from "./otlp";
import { classifyTransactionFailure } from "./transaction-failure";

const journeyId = "123e4567-e89b-42d3-a456-426614174000";

test("swap visibility rejects account changes, unchanged or partial balances and invalid values", () => {
  const before = {
    owner: "fixture",
    balances: [
      { mint: "input", amount: 10 },
      { mint: "output", amount: 0 },
    ],
  };
  const after = {
    owner: "fixture",
    balances: [
      { mint: "input", amount: 9 },
      { mint: "output", amount: 1 },
    ],
  };
  expect(isSwapVisible(before, before, "input", "output")).toBe(false);
  expect(isSwapVisible(before, after, "input", "output")).toBe(true);
  expect(
    isSwapVisible(before, { ...after, owner: "other" }, "input", "output")
  ).toBe(false);
  expect(
    isSwapVisible(
      before,
      { ...after, balances: [{ mint: "input", amount: 9 }] },
      "input",
      "output"
    )
  ).toBe(false);
  expect(
    isSwapVisible(
      before,
      {
        ...after,
        balances: [
          { mint: "input", amount: NaN },
          { mint: "output", amount: 1 },
        ],
      },
      "input",
      "output"
    )
  ).toBe(false);
  expect(isSwapVisible(before, after, "input", "input")).toBe(false);
});

test("Earn MAX completion waits for a snapshot at or beyond the matching confirmed transaction", () => {
  const operation = {
    signature: "fixture",
    status: "confirmed",
    confirmedSlot: "101",
  };
  expect(
    isVoltrOperationVisible("fixture", { observedSlot: "100" }, [operation])
  ).toBe(false);
  expect(
    isVoltrOperationVisible("fixture", { observedSlot: "101" }, [operation])
  ).toBe(true);
  expect(
    isVoltrOperationVisible("fixture", { observedSlot: "102" }, [operation])
  ).toBe(true);
  expect(
    isVoltrOperationVisible("other", { observedSlot: "102" }, [operation])
  ).toBe(false);
  expect(
    isVoltrOperationVisible("fixture", { observedSlot: "102" }, [
      { ...operation, status: "submitted" },
    ])
  ).toBe(false);
});

test("Earn MAX missing or malformed observation evidence never proves visibility", () => {
  const operation = {
    signature: "fixture",
    status: "confirmed",
    confirmedSlot: "101",
  };
  for (const summary of [null, {}, { observedSlot: "NaN" }]) {
    expect(isVoltrOperationVisible("fixture", summary, [operation])).toBe(
      false
    );
  }
  for (const confirmedSlot of [undefined, "NaN", "-1"]) {
    expect(
      isVoltrOperationVisible("fixture", { observedSlot: "102" }, [
        { ...operation, confirmedSlot },
      ])
    ).toBe(false);
  }
});

test("retry success preserves the first failure and diagnostic join keys", () => {
  const events: BrowserLifecycleEnvelope[] = [];
  const attempt = (attemptNumber: number) =>
    createLifecycleTracker({
      attemptNumber,
      emit: (event) => events.push(event),
      flowName: "earn.deposit",
      flowVariant: "initial",
      journeyId,
      pathname: "/app",
    });
  const first = attempt(1);
  first.start("intent");
  first.fail("preflight", {
    errorCode: "simulation_failed",
    chainState: "not_submitted",
  });
  first.complete("ui_commit");
  const second = attempt(2);
  second.start("intent");
  second.complete("ui_commit", {
    chainState: "confirmed",
    persistenceState: "recorded",
  });
  expect(events.map((event) => event.outcome)).toEqual([
    "started",
    "failed",
    "started",
    "completed",
  ]);
  expect(new Set(events.map((event) => event.eventId)).size).toBe(4);
  expect(new Set(events.map((event) => event.journeyId)).size).toBe(1);
  expect(first.flowId).not.toBe(second.flowId);
  const normalized = {
    ...events[1],
    deploymentEnvironment: "test",
    release: "fixture",
    serviceName: "loyal-frontend" as const,
  };
  expect(isAlertableLifecycleEvent(normalized)).toBe(true);
  const payload = JSON.stringify(buildOtlpLifecyclePayload(normalized));
  expect(payload).toContain(journeyId);
  expect(payload).toContain(first.flowId);
  expect(payload).toContain("simulation_failed");
});

test("automatic retry remains visible on eventual completion", () => {
  const events: BrowserLifecycleEnvelope[] = [];
  const tracker = createLifecycleTracker({
    emit: (event) => events.push(event),
    flowName: "earn.deposit",
    flowVariant: "initial",
    pathname: "/app",
  });
  tracker.start("intent");
  tracker.retry("prepare", { errorCode: "state_not_ready" });
  tracker.complete("ui_commit");
  expect(events[1].outcome).toBe("retrying");
  expect(events[2].retryCount).toBe(1);
  expect(() =>
    parseBrowserLifecycleEnvelope({
      ...events[0],
      journeyId: "secret-token",
      attemptNumber: 1,
    })
  ).toThrow();
});

test("telemetry delivery failure never prevents a product action", () => {
  const tracker = createLifecycleTracker({
    emit: () => {
      throw new Error("offline");
    },
    flowName: "earn.deposit",
    flowVariant: "initial",
    pathname: "/app",
  });
  expect(() => {
    tracker.start("intent");
    tracker.fail("preflight");
  }).not.toThrow();
});

test("fresh-wallet simulation, rejection and unresolved submission stay distinct", () => {
  const missingAccount = new Error(
    "An account required for this policy is absent."
  );
  missingAccount.name = "SquadsMissingAccountSimulationError";
  expect(classifyTransactionFailure(missingAccount)).toBe("simulation_failed");
  expect(
    classifyTransactionFailure(
      Object.assign(new Error("User rejected"), { code: 4001 })
    )
  ).toBe("wallet_rejected");
  expect(
    classifyTransactionFailure(
      Object.assign(new Error("Confirmation unresolved"), {
        transactionWasSubmitted: true,
      })
    )
  ).toBe("unconfirmed_signature");
});

test("browser and backend trace spans join without accepting malformed parent context", async () => {
  const { parseJourneyTraceparent, journeyTraceparent } = await import(
    "./trace-context"
  );
  const { buildOtlpJourneyTracePayload } = await import("./otlp");
  const browser = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
  expect(parseJourneyTraceparent(journeyTraceparent(browser))).toEqual(browser);
  expect(
    parseJourneyTraceparent(`00-${"0".repeat(32)}-${browser.spanId}-01`)
  ).toBeUndefined();
  expect(
    parseJourneyTraceparent(`00-${browser.traceId}-${"0".repeat(16)}-01`)
  ).toBeUndefined();
  expect(
    parseJourneyTraceparent(
      `${journeyTraceparent(browser)}\r\nAuthorization: secret`
    )
  ).toBeUndefined();
  const events: BrowserLifecycleEnvelope[] = [];
  let time = Date.now();
  const tracker = createLifecycleTracker({
    traceContext: {
      traceId: browser.traceId,
      parentSpanId: browser.spanId,
      spanId: "c".repeat(16),
    },
    flowName: "auth.authenticated_action",
    flowVariant: "overview",
    pathname: "/api/smart-accounts/overview/base",
    source: "next_api",
    runtime: "node",
    emit: (event) => {
      events.push(event);
    },
    now: () => time,
  });
  tracker.start("intent");
  time += 125;
  tracker.complete("action_completed");
  const event = {
    ...events[1],
    serviceName: "loyal-frontend" as const,
    release: "fixture",
    deploymentEnvironment: "test",
  };
  const logs =
    buildOtlpLifecyclePayload(event).resourceLogs[0].scopeLogs[0].logRecords[0];
  const payload = buildOtlpJourneyTracePayload(event) as {
    resourceSpans: {
      scopeSpans: {
        spans: {
          traceId: string;
          spanId: string;
          parentSpanId: string;
          startTimeUnixNano: string;
          endTimeUnixNano: string;
        }[];
      }[];
    }[];
  };
  const [step, request] = payload.resourceSpans[0].scopeSpans[0].spans;
  expect(logs.traceId).toBe(browser.traceId);
  expect(logs.spanId).toBe(step.spanId);
  expect(step.parentSpanId).toBe(request.spanId);
  expect(request.parentSpanId).toBe(browser.spanId);
  expect(
    BigInt(request.endTimeUnixNano) - BigInt(request.startTimeUnixNano)
  ).toBe(BigInt(125_000_000));
  expect(() =>
    parseBrowserLifecycleEnvelope({
      ...events[1],
      traceId: "token-not-a-trace",
    })
  ).toThrow();
});

test("withdrawal visibility rejects stale reads and requires a reduced or empty position", async () => {
  const { isWithdrawalVisible } = await import("./withdrawal-visibility");
  const position = {
    holdings: [{ sourceId: "reserve:fixture", amountRaw: "60" }],
  } as import("@/hooks/use-active-earn-position").ActiveEarnPosition;
  expect(
    isWithdrawalVisible(
      { observedSlot: "9", position },
      "10",
      "reserve:fixture",
      "100"
    )
  ).toBe(false);
  expect(
    isWithdrawalVisible(
      { observedSlot: "10", position },
      "10",
      "reserve:fixture",
      "60"
    )
  ).toBe(false);
  expect(
    isWithdrawalVisible(
      { observedSlot: "10", position },
      "10",
      "reserve:fixture",
      "100"
    )
  ).toBe(true);
  expect(
    isWithdrawalVisible({ observedSlot: "10", position }, "10", null, "0")
  ).toBe(false);
  expect(
    isWithdrawalVisible({ observedSlot: "10", position: null }, "10", null, "0")
  ).toBe(true);
  expect(
    isWithdrawalVisible({ observedSlot: "9", position: null }, "10", null, "0")
  ).toBe(false);
});

test("swap chain outcomes are retained instead of being silently dropped", () => {
  const events: BrowserLifecycleEnvelope[] = [];
  const tracker = createLifecycleTracker({
    flowName: "wallet.swap",
    flowVariant: "wallet_adapter",
    pathname: "/app",
    emit: (event) => {
      events.push(event);
    },
  });
  tracker.start("intent");
  tracker.observe("wallet_submit_confirm", { chainState: "submitted" });
  tracker.retry("wallet_submit_confirm", { errorCode: "slippage_exceeded" });
  tracker.complete("ui_commit", { chainState: "confirmed" });
  expect(events.map((event) => event.outcome)).toEqual([
    "started",
    "observed",
    "retrying",
    "completed",
  ]);
  expect(events.at(-1)?.retryCount).toBe(1);
});
