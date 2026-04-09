import "server-only";

import { FRONTEND_ANALYTICS_EVENTS } from "@/lib/core/analytics/events";
import { trackServerAnalyticsEvent } from "@/lib/core/analytics-server";

type WalletOnboardingEventName =
  | "challenge_created"
  | "invalid_signature"
  | "existing_smart_account_reused"
  | "sponsorship_submitted"
  | "reservation_conflict"
  | "reconciliation_succeeded"
  | "reconciliation_failed";

const EVENT_NAMES: Record<WalletOnboardingEventName, string> = {
  challenge_created: FRONTEND_ANALYTICS_EVENTS.walletAuthChallengeCreated,
  invalid_signature: FRONTEND_ANALYTICS_EVENTS.walletAuthInvalidSignature,
  existing_smart_account_reused:
    FRONTEND_ANALYTICS_EVENTS.walletAuthExistingSmartAccountReused,
  sponsorship_submitted: FRONTEND_ANALYTICS_EVENTS.walletAuthSponsorshipSubmitted,
  reservation_conflict: FRONTEND_ANALYTICS_EVENTS.walletAuthReservationConflict,
  reconciliation_succeeded:
    FRONTEND_ANALYTICS_EVENTS.walletAuthReconciliationSucceeded,
  reconciliation_failed:
    FRONTEND_ANALYTICS_EVENTS.walletAuthReconciliationFailed,
};

export function trackWalletOnboardingEvent(
  eventName: WalletOnboardingEventName,
  properties: Record<string, unknown>
): void {
  const analyticsEventName = EVENT_NAMES[eventName];

  try {
    trackServerAnalyticsEvent(analyticsEventName, {
      distinct_id:
        typeof properties.walletAddress === "string"
          ? properties.walletAddress
          : analyticsEventName,
      ...properties,
    });
    console.info("[wallet-onboarding]", analyticsEventName, properties);
  } catch (error) {
    console.error("[wallet-onboarding] failed to track event", {
      analyticsEventName,
      properties,
      error,
    });
  }
}
