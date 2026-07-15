"use client";

import { useEffect, useRef, useState } from "react";

import {
  acceptEarnRealtimeInvalidationBatch,
  EarnRealtimeInvalidationBatcher,
} from "./batch";
import {
  createEarnRealtimeCursorStore,
  earnRealtimeCursorStorageKey,
} from "./cursor-storage";
import { runEarnRealtimeLifecycle } from "./lifecycle";
import { EarnRealtimeTokenCache } from "./stream";
import type {
  EarnRealtimeConnectionState,
  EarnRealtimeInvalidation,
  EarnRealtimeProtocolIssue,
} from "./types";

const TOKEN_RENEWAL_LEAD_MS = 30_000;
const INVALIDATION_BATCH_MS = 150;

export type EarnRealtimeIdentity = {
  earnVaultAddress: string;
  settingsPda: string;
  solanaEnv: string;
  walletAddress: string;
};

export function useEarnRealtime({
  enabled,
  identity,
  onCursorlessConnected,
  onInvalidation,
  onInvalidationBatch,
  onProtocolIssue,
  onResyncRequired,
}: {
  enabled: boolean;
  identity: EarnRealtimeIdentity | null;
  onCursorlessConnected?: () => Promise<void> | void;
  onInvalidation: (event: EarnRealtimeInvalidation) => void;
  onInvalidationBatch: (
    events: readonly EarnRealtimeInvalidation[]
  ) => Promise<void> | void;
  onProtocolIssue?: (issue: EarnRealtimeProtocolIssue) => void;
  onResyncRequired: () => Promise<void> | void;
}): EarnRealtimeConnectionState {
  const [state, setState] = useState<EarnRealtimeConnectionState>("disabled");
  const callbacksRef = useRef({
    onCursorlessConnected,
    onInvalidation,
    onInvalidationBatch,
    onProtocolIssue,
    onResyncRequired,
  });
  callbacksRef.current = {
    onCursorlessConnected,
    onInvalidation,
    onInvalidationBatch,
    onProtocolIssue,
    onResyncRequired,
  };

  useEffect(() => {
    if (!enabled || !identity) {
      setState("disabled");
      return;
    }

    const lifecycle = new AbortController();
    const key = earnRealtimeCursorStorageKey(identity);
    const cursorStore = createEarnRealtimeCursorStore(key);
    const tokenCache = new EarnRealtimeTokenCache(TOKEN_RENEWAL_LEAD_MS);
    let admissionPromise: Promise<void> = Promise.resolve();
    const batcher = new EarnRealtimeInvalidationBatcher({
      acknowledge: (eventId) => cursorStore.acknowledge(eventId),
      delayMs: INVALIDATION_BATCH_MS,
      onBatch: async (events) => {
        await admissionPromise;
        await acceptEarnRealtimeInvalidationBatch({
          events,
          onInvalidationBatch: (supported) =>
            callbacksRef.current.onInvalidationBatch(supported),
          onProtocolIssue: (issue) => {
            callbacksRef.current.onProtocolIssue?.(issue);
            console.warn("[earn-realtime] unsupported protocol event", {
              eventType: issue.eventType,
              kind: issue.kind,
              schemaVersion: issue.schemaVersion,
            });
          },
          onResyncError: (error) => {
            console.warn("[earn-realtime] protocol resync failed", {
              errorMessage:
                error instanceof Error
                  ? error.message
                  : "Unknown resync error.",
            });
          },
          onResyncRequired: () => callbacksRef.current.onResyncRequired(),
        });
      },
      onError: (error) => {
        console.warn("[earn-realtime] invalidation batch was not accepted", {
          errorMessage:
            error instanceof Error ? error.message : "Unknown batch error.",
        });
      },
    });
    const enqueueInvalidation = (event: EarnRealtimeInvalidation) => {
      callbacksRef.current.onInvalidation(event);
      batcher.enqueue(event);
    };

    void runEarnRealtimeLifecycle({
      clearCursor: () => {
        cursorStore.clear();
        batcher.reset();
      },
      getCursor: () => cursorStore.get(),
      onConnected: () => setState("connected"),
      onConnecting: (isReconnect) =>
        setState(isReconnect ? "reconnecting" : "connecting"),
      onCursorlessConnected: () => {
        const reconcile = callbacksRef.current.onCursorlessConnected;
        admissionPromise = Promise.resolve().then(() =>
          reconcile ? reconcile() : callbacksRef.current.onResyncRequired()
        );
        return admissionPromise;
      },
      onError: (error) => {
        console.warn("[earn-realtime] connection failed", {
          errorMessage:
            error instanceof Error ? error.message : "Unknown stream error.",
        });
      },
      onInvalidation: enqueueInvalidation,
      signal: lifecycle.signal,
      tokenCache,
    });
    return () => {
      lifecycle.abort();
      batcher.dispose();
    };
  }, [enabled, identity]);

  return state;
}
