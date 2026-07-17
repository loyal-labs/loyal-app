import { describe, expect, test } from "bun:test";

import {
  createLifecycleTracker,
  type BrowserLifecycleEnvelope,
} from "@/features/observability/lifecycle-contract";

import {
  createEarnAutodepositSetupFailure,
  settleEarnAutodepositSetupFailure,
} from "./setup-lifecycle";

const NOW = Date.parse("2026-07-18T08:00:00.000Z");

function createTracker(events: BrowserLifecycleEnvelope[]) {
  return createLifecycleTracker({
    emit: (event) => events.push(event),
    flowId: "123e4567-e89b-42d3-a456-426614174000",
    flowName: "earn.autodeposit.configuration",
    flowVariant: "setup",
    now: () => NOW,
    pathname: "/app",
  });
}

describe("Earn Autodeposit setup lifecycle", () => {
  test("reports preparation failures at prepare without a backend-confirm claim", async () => {
    const events: BrowserLifecycleEnvelope[] = [];
    const tracker = createTracker(events);
    tracker.start("intent");

    const reconciled = await settleEarnAutodepositSetupFailure({
      failure: createEarnAutodepositSetupFailure({
        error: new Error(
          "prepare failed for wallet SecretWallet and signature SecretSignature"
        ),
        errorCode: "instruction_fetch_failed",
        stage: "prepare",
      }),
      onReconciled: () => {
        throw new Error("preparation failures must not reconcile");
      },
      refreshEarnAutodeposit: () => {
        throw new Error("preparation failures must not refetch Earn state");
      },
      tracker,
    });

    expect(reconciled).toBe(false);
    expect(events.at(-1)).toMatchObject({
      errorClass: "error",
      errorCode: "instruction_fetch_failed",
      outcome: "failed",
      stage: "prepare",
    });
    expect(events.some((event) => event.stage === "backend_confirm")).toBe(
      false
    );
    expect(JSON.stringify(events)).not.toContain("SecretWallet");
    expect(JSON.stringify(events)).not.toContain("SecretSignature");
  });

  test("reconciles an authoritative recorded setup instead of reporting failure", async () => {
    const events: BrowserLifecycleEnvelope[] = [];
    const tracker = createTracker(events);
    tracker.start("intent");
    const reconciledStates: string[] = [];

    const reconciled = await settleEarnAutodepositSetupFailure({
      failure: createEarnAutodepositSetupFailure({
        chainState: "confirmed",
        error: new Error("response could not be committed"),
        errorCode: "record_failed",
        httpStatus: 200,
        persistenceState: "recorded",
        reconcileAuthoritativeState: true,
        stage: "ui_commit",
      }),
      onReconciled: (config) => {
        reconciledStates.push(config.state);
      },
      refreshEarnAutodeposit: async () => ({
        amountPerPeriodRaw: "2000000",
        policyAccount: "policy-account",
        policySeed: "3",
        periodLengthSeconds: "86400",
        recurringDelegation: "recurring-delegation",
        startTimestamp: "1784361600",
        status: "active",
        walletBalanceFloorRaw: "1000000",
      }),
      tracker,
    });

    expect(reconciled).toBe(true);
    expect(reconciledStates).toEqual(["created"]);
    expect(events.at(-1)).toMatchObject({
      outcome: "completed",
      persistenceState: "recorded",
      stage: "ui_commit",
    });
    expect(events.some((event) => event.outcome === "failed")).toBe(false);
  });

  test("emits only one terminal outcome when a later handler reports again", async () => {
    const events: BrowserLifecycleEnvelope[] = [];
    const tracker = createTracker(events);
    tracker.start("intent");
    const failure = createEarnAutodepositSetupFailure({
      error: new Error("wallet send failed"),
      errorCode: "send_failed",
      stage: "wallet_approval",
    });

    await settleEarnAutodepositSetupFailure({
      failure,
      onReconciled: () => undefined,
      refreshEarnAutodeposit: async () => null,
      tracker,
    });
    tracker.fail("backend_confirm", {
      errorCode: "unexpected_error",
    });

    expect(
      events.filter((event) =>
        ["cancelled", "completed", "failed"].includes(event.outcome)
      )
    ).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      errorCode: "send_failed",
      outcome: "failed",
      stage: "wallet_approval",
    });
  });
});
