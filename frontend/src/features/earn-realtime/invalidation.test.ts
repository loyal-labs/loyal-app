import { describe, expect, test } from "bun:test";

import { resolveEarnRealtimeRefreshPlan } from "./invalidation";
import { EARN_REALTIME_EVENT_TYPES } from "./types";

describe("Earn realtime targeted invalidation", () => {
  test("refreshes only allowance state and activity for allowance changes", () => {
    expect(
      resolveEarnRealtimeRefreshPlan([
        { eventType: EARN_REALTIME_EVENT_TYPES.allowance },
      ])
    ).toEqual({
      earnings: false,
      earnState: true,
      position: false,
      transactions: true,
    });
  });

  test("refreshes rebalance-backed activity, position, and earnings", () => {
    expect(
      resolveEarnRealtimeRefreshPlan([
        { eventType: EARN_REALTIME_EVENT_TYPES.rebalance },
      ])
    ).toEqual({
      earnings: true,
      earnState: false,
      position: true,
      transactions: true,
    });
  });

  test("coalesces mixed events into one targeted refresh plan", () => {
    expect(
      resolveEarnRealtimeRefreshPlan([
        {
          eventType: EARN_REALTIME_EVENT_TYPES.autodeposit,
          state: "completed",
        },
        { eventType: EARN_REALTIME_EVENT_TYPES.rebalance },
      ])
    ).toEqual({
      earnings: true,
      earnState: true,
      position: true,
      transactions: true,
    });
  });
});
