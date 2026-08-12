import { describe, expect, test } from "bun:test";

import {
  EarnMutationReconciliationRegistry,
  type PlannedEarnRealtimeEvent,
} from "./mutation-reconciliation";
import { EARN_REALTIME_EVENT_TYPES } from "./types";

function planned(
  eventId: string,
  eventType: string,
  resources: string[],
  reason?: string
): PlannedEarnRealtimeEvent {
  return {
    event: {
      eventId,
      eventType,
      occurredAt: "2026-07-14T00:00:00Z",
      reason,
      schemaVersion: 1,
      scope: "earn",
    },
    resources,
  };
}

describe("Earn mutation reconciliation", () => {
  test("a matching event reconciles the related canonical plane exactly once", async () => {
    let relatedRefreshCount = 0;
    const registry = new EarnMutationReconciliationRegistry();
    registry.register(
      {
        key: "deposit:two-plane",
        operation: "deposit",
        reconcileRelated: async () => {
          relatedRefreshCount += 1;
        },
        resources: ["position", "transactions", "earnings"],
        signature: "two-plane",
      },
      async () => undefined
    );

    const reconciliation = registry.plan([
      planned(
        "10",
        EARN_REALTIME_EVENT_TYPES.transaction,
        ["position", "transactions", "earnings"],
        "holding_event_deposit_top_up"
      ),
    ]);
    await reconciliation.reconcileRelated();
    reconciliation.accept(true);

    const later = registry.plan([
      planned(
        "11",
        EARN_REALTIME_EVENT_TYPES.transaction,
        ["position", "transactions", "earnings"],
        "holding_event_deposit_top_up"
      ),
    ]);
    await later.reconcileRelated();
    later.accept(true);
    expect(relatedRefreshCount).toBe(1);
  });

  test("registered-first SSE owns each resource once and cancels the fallback", () => {
    const scheduled = new Map<number, () => void>();
    let timer = 0;
    let fallbackCount = 0;
    const registry = new EarnMutationReconciliationRegistry({
      schedule: (callback) => {
        timer += 1;
        scheduled.set(timer, callback);
        return () => scheduled.delete(timer);
      },
    });
    registry.register(
      {
        key: "deposit:signature-a",
        operation: "deposit",
        resources: ["position", "transactions", "earnings"],
        signature: "signature-a",
      },
      async () => {
        fallbackCount += 1;
      }
    );

    const reconciliation = registry.plan([
      planned(
        "11",
        EARN_REALTIME_EVENT_TYPES.transaction,
        ["transactions", "earnings"],
        "holding_event_deposit_top_up"
      ),
      planned("12", EARN_REALTIME_EVENT_TYPES.position, [
        "position",
        "earnings",
      ]),
    ]);
    expect(reconciliation.resources.sort()).toEqual([
      "earnings",
      "position",
      "transactions",
    ]);
    reconciliation.accept(true);
    for (const callback of scheduled.values()) callback();
    expect(fallbackCount).toBe(0);
  });

  test("unrelated recent balance events cannot cancel signature fallbacks", async () => {
    const cases = [
      {
        operation: "deposit" as const,
        reason: "holding_event_deposit_top_up",
        resources: ["position", "transactions", "earnings"],
      },
      {
        operation: "withdraw_partial" as const,
        reason: "holding_event_withdrawal_partial",
        resources: ["position", "transactions", "earnings"],
      },
      {
        operation: "withdraw_full" as const,
        reason: "holding_event_withdrawal_full",
        resources: ["position", "transactions", "earnings"],
      },
      {
        operation: "cleanup" as const,
        reason: "holding_event_withdrawal_full",
        resources: ["state", "position", "transactions", "earnings"],
      },
    ];

    for (const [index, current] of cases.entries()) {
      const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
      const fallbackReads: string[][] = [];
      const registry = new EarnMutationReconciliationRegistry({
        schedule: (callback, delayMs) => {
          scheduled.push({ callback, delayMs });
          return () => undefined;
        },
      });

      const unrelated = registry.plan([
        planned(
          String(index + 12),
          EARN_REALTIME_EVENT_TYPES.transaction,
          current.resources,
          current.reason
        ),
      ]);
      expect(unrelated.resources).toEqual(current.resources);
      unrelated.accept(true);

      registry.register(
        {
          key: `${current.operation}:new-signature`,
          operation: current.operation,
          resources: current.resources,
          signature: "new-signature",
        },
        async (resources) => {
          fallbackReads.push([...resources]);
        }
      );

      scheduled.find(({ delayMs }) => delayMs === 2_500)?.callback();
      await Promise.resolve();

      expect(fallbackReads).toEqual([current.resources]);
    }
  });

  test("one fallback does not suppress a later event's causal read", async () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const fallbackReads: string[][] = [];
    const registry = new EarnMutationReconciliationRegistry({
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return () => undefined;
      },
    });
    registry.register(
      {
        key: "floor:target-7",
        operation: "autodeposit_floor",
        resources: ["state", "transactions"],
        targetId: "7",
      },
      async (resources) => {
        fallbackReads.push([...resources]);
      }
    );

    scheduled.find(({ delayMs }) => delayMs === 2_500)?.callback();
    await Promise.resolve();
    const event = planned("21", EARN_REALTIME_EVENT_TYPES.allowance, [
      "state",
      "transactions",
    ]);
    event.event.targetId = "7";
    const late = registry.plan([event]);
    expect(fallbackReads).toEqual([["state", "transactions"]]);
    expect(late.resources).toEqual(["state", "transactions"]);
    late.accept(true);
  });

  test("an accepted event covers a mutation registered while its read is in flight", () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const registry = new EarnMutationReconciliationRegistry({
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return () => undefined;
      },
    });
    const event = planned("31", EARN_REALTIME_EVENT_TYPES.allowance, [
      "state",
      "transactions",
    ]);
    event.event.targetId = "target-31";
    const reconciliation = registry.plan([event]);

    let fallbackCount = 0;
    registry.register(
      {
        key: "toggle:target-31",
        operation: "autodeposit_toggle",
        resources: ["state", "transactions"],
        targetId: "target-31",
      },
      async () => {
        fallbackCount += 1;
      }
    );
    reconciliation.accept(true);

    for (const scheduledTask of scheduled) scheduledTask.callback();
    expect(fallbackCount).toBe(0);
  });

  test("an event received during fallback still owns a post-event refresh", async () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    let resolveFallback: () => void = () => undefined;
    const fallback = new Promise<void>((resolve) => {
      resolveFallback = resolve;
    });
    const registry = new EarnMutationReconciliationRegistry({
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return () => undefined;
      },
    });
    registry.register(
      {
        key: "close:target-41",
        operation: "autodeposit_close",
        resources: ["state", "transactions"],
        targetId: "target-41",
      },
      () => fallback
    );
    scheduled.find(({ delayMs }) => delayMs === 2_500)?.callback();

    const event = planned("41", EARN_REALTIME_EVENT_TYPES.allowance, [
      "state",
      "transactions",
    ]);
    event.event.targetId = "target-41";
    const reconciliation = registry.plan([event]);
    expect(reconciliation.resources).toEqual(["state", "transactions"]);
    reconciliation.accept(true);
    resolveFallback();
    await fallback;
  });
});
