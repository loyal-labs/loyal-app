import { EARN_REALTIME_EVENT_TYPES } from "./types";
import type { EarnRealtimeInvalidation } from "./types";

export type EarnRealtimeRefreshPlan = {
  earnings: boolean;
  earnState: boolean;
  position: boolean;
  transactions: boolean;
};

export function resolveEarnRealtimeRefreshPlan(
  events: readonly Pick<EarnRealtimeInvalidation, "eventType" | "state">[]
): EarnRealtimeRefreshPlan {
  const plan: EarnRealtimeRefreshPlan = {
    earnings: false,
    earnState: false,
    position: false,
    transactions: false,
  };

  for (const event of events) {
    if (event.eventType === EARN_REALTIME_EVENT_TYPES.autodeposit) {
      if (event.state === "scheduled") {
        plan.earnState = true;
      } else if (event.state === "pull_confirmed") {
        plan.position = true;
        plan.transactions = true;
      } else if (event.state === "completed") {
        plan.earnState = true;
        plan.position = true;
        plan.transactions = true;
        plan.earnings = true;
      } else if (
        event.state === "failed" ||
        event.state === "released" ||
        event.state === "canceled"
      ) {
        plan.earnState = true;
      }
    } else if (event.eventType === EARN_REALTIME_EVENT_TYPES.allowance) {
      plan.earnState = true;
      plan.transactions = true;
    } else if (event.eventType === EARN_REALTIME_EVENT_TYPES.rebalance) {
      plan.position = true;
      plan.transactions = true;
      plan.earnings = true;
    } else if (event.eventType === EARN_REALTIME_EVENT_TYPES.transaction) {
      plan.transactions = true;
      plan.earnings = true;
    } else if (event.eventType === EARN_REALTIME_EVENT_TYPES.position) {
      plan.position = true;
      plan.earnings = true;
    } else if (event.eventType === EARN_REALTIME_EVENT_TYPES.onboarding) {
      plan.earnState = true;
    }
  }

  return plan;
}
