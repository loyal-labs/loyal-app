"use client";

import { useEffect, useRef, useState } from "react";

import { runEarnRealtimeLifecycle } from "./lifecycle";
import { EarnRealtimeTokenCache } from "./stream";
import type {
  EarnRealtimeConnectionState,
  EarnRealtimeInvalidation,
} from "./types";

const TOKEN_RENEWAL_LEAD_MS = 30_000;
const INVALIDATION_BATCH_MS = 150;

export type EarnRealtimeIdentity = {
  earnVaultAddress: string;
  settingsPda: string;
  solanaEnv: string;
  walletAddress: string;
};

function cursorStorageKey(identity: EarnRealtimeIdentity): string {
  return [
    "loyal:earn-realtime-cursor:v1",
    identity.solanaEnv,
    identity.walletAddress,
    identity.settingsPda,
    identity.earnVaultAddress,
  ].join(":");
}

export function useEarnRealtime({
  enabled,
  identity,
  onInvalidation,
  onInvalidationBatch,
  onResyncRequired,
}: {
  enabled: boolean;
  identity: EarnRealtimeIdentity | null;
  onInvalidation: (event: EarnRealtimeInvalidation) => void;
  onInvalidationBatch: (events: readonly EarnRealtimeInvalidation[]) => void;
  onResyncRequired: () => Promise<void> | void;
}): EarnRealtimeConnectionState {
  const [state, setState] = useState<EarnRealtimeConnectionState>("disabled");
  const callbacksRef = useRef({
    onInvalidation,
    onInvalidationBatch,
    onResyncRequired,
  });
  callbacksRef.current = {
    onInvalidation,
    onInvalidationBatch,
    onResyncRequired,
  };

  useEffect(() => {
    if (!enabled || !identity) {
      setState("disabled");
      return;
    }

    const lifecycle = new AbortController();
    const key = cursorStorageKey(identity);
    const tokenCache = new EarnRealtimeTokenCache(TOKEN_RENEWAL_LEAD_MS);
    let batchTimer: number | null = null;
    let pendingBatch: EarnRealtimeInvalidation[] = [];

    const flushBatch = () => {
      batchTimer = null;
      if (pendingBatch.length === 0) {
        return;
      }
      const batch = pendingBatch;
      pendingBatch = [];
      callbacksRef.current.onInvalidationBatch(batch);
    };
    const enqueueInvalidation = (event: EarnRealtimeInvalidation) => {
      callbacksRef.current.onInvalidation(event);
      sessionStorage.setItem(key, event.eventId);
      pendingBatch.push(event);
      if (batchTimer === null) {
        batchTimer = window.setTimeout(flushBatch, INVALIDATION_BATCH_MS);
      }
    };

    void runEarnRealtimeLifecycle({
      clearCursor: () => sessionStorage.removeItem(key),
      getCursor: () => sessionStorage.getItem(key),
      onConnected: () => setState("connected"),
      onConnecting: (isReconnect) =>
        setState(isReconnect ? "reconnecting" : "connecting"),
      onError: (error) => {
        console.warn("[earn-realtime] connection failed", {
          errorMessage:
            error instanceof Error ? error.message : "Unknown stream error.",
        });
      },
      onInvalidation: enqueueInvalidation,
      onResyncRequired: async () => {
        flushBatch();
        await callbacksRef.current.onResyncRequired();
      },
      signal: lifecycle.signal,
      tokenCache,
    });
    return () => {
      lifecycle.abort();
      if (batchTimer !== null) {
        window.clearTimeout(batchTimer);
      }
      pendingBatch = [];
    };
  }, [enabled, identity]);

  return state;
}
