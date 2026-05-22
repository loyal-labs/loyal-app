import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

/**
 * Signals that should trigger a wallet refresh. Tracked as an enum so
 * the coordinator can de-dupe and log *why* a refresh happened.
 */
export type WalletRefreshReason =
  | "app-foreground"
  | "screen-focus"
  | "push-received"
  | "interval"
  | "mutation"
  | "network-switch"
  | "manual";

type RefreshFn = (reason: WalletRefreshReason) => Promise<void> | void;

type Options = {
  walletAddress: string | null;
  /**
   * Called when the coordinator decides a refresh should run. The
   * coordinator guarantees at most one in-flight call at a time per
   * `walletAddress` and coalesces rapid-fire triggers.
   */
  refresh: RefreshFn;
  /**
   * Optional: how often to poll as a safety net while the app is
   * foregrounded AND the wallet screen is focused. Defaults to 60s.
   */
  intervalMs?: number;
  /**
   * Optional: minimum time between non-user-initiated refreshes.
   * Manual and mutation reasons bypass this. Defaults to 3s.
   */
  minIntervalMs?: number;
};

const BYPASS_THROTTLE_REASONS: ReadonlySet<WalletRefreshReason> = new Set([
  "manual",
  "mutation",
  "network-switch",
]);

/**
 * Coordinates wallet data refresh from multiple ambient triggers:
 * AppState foreground, screen focus, push-notification arrival (the
 * backend pushes Helius-derived transfer notifications via Expo
 * push), and a periodic safety-net poll. Callers funnel manual
 * pull-to-refresh and post-mutation refreshes into the same
 * `refresh(reason)` callback, which the coordinator de-dupes.
 */
export function useWalletAutoRefresh({
  walletAddress,
  refresh,
  intervalMs = 60_000,
  minIntervalMs = 3_000,
}: Options): {
  requestRefresh: RefreshFn;
} {
  const refreshRef = useRef<RefreshFn>(refresh);
  refreshRef.current = refresh;

  const inFlightRef = useRef(false);
  const pendingReasonRef = useRef<WalletRefreshReason | null>(null);
  const lastRefreshAtRef = useRef(0);

  const requestRefresh = useCallback<RefreshFn>(async (reason) => {
    if (!walletAddress) return;

    if (inFlightRef.current) {
      // Preserve the "strongest" pending reason: user-initiated wins
      // over ambient ticks so we don't skip a manual refresh just
      // because a 60-s timer popped a moment earlier.
      const current = pendingReasonRef.current;
      if (!current || BYPASS_THROTTLE_REASONS.has(reason)) {
        pendingReasonRef.current = reason;
      }
      return;
    }

    const now = Date.now();
    if (
      !BYPASS_THROTTLE_REASONS.has(reason) &&
      now - lastRefreshAtRef.current < minIntervalMs
    ) {
      return;
    }

    inFlightRef.current = true;
    lastRefreshAtRef.current = now;
    try {
      await refreshRef.current(reason);
    } catch (error) {
      console.error(`[wallet-auto-refresh] ${reason} refresh failed`, error);
    } finally {
      inFlightRef.current = false;
      const pending = pendingReasonRef.current;
      if (pending) {
        pendingReasonRef.current = null;
        void requestRefresh(pending);
      }
    }
  }, [walletAddress, minIntervalMs]);

  // 1. AppState: every transition to "active" while we have a wallet.
  useEffect(() => {
    if (!walletAddress) return;
    let previous: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") {
        void requestRefresh("app-foreground");
      }
      previous = next;
    });
    return () => sub.remove();
  }, [walletAddress, requestRefresh]);

  // 2. Screen focus (expo-router tab navigation).
  useFocusEffect(
    useCallback(() => {
      void requestRefresh("screen-focus");
      return undefined;
    }, [requestRefresh]),
  );

  // 3. Push notification received → wallet activity changed on chain.
  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    let remove: (() => void) | null = null;
    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        if (cancelled) return;
        const sub = Notifications.addNotificationReceivedListener(() => {
          void requestRefresh("push-received");
        });
        remove = () => sub.remove();
      } catch {
        // expo-notifications unavailable (Expo Go) — silent.
      }
    })();
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [walletAddress, requestRefresh]);

  // 4. Periodic safety-net poll while app is foregrounded.
  useEffect(() => {
    if (!walletAddress) return;
    const handle = setInterval(() => {
      if (AppState.currentState !== "active") return;
      void requestRefresh("interval");
    }, intervalMs);
    return () => clearInterval(handle);
  }, [walletAddress, requestRefresh, intervalMs]);

  return { requestRefresh };
}
