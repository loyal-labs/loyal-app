import { useEffect } from "react";
import { AppState } from "react-native";

import { refreshEarnEarningsCache } from "@/hooks/wallet/useEarnEarnings";
import {
  EarnApiError,
  fetchEarnRealtimeToken,
} from "@/lib/solana/earn/earn-api";
import { ensureEarnRealtimeSession } from "@/lib/solana/earn/earn-auth";
import {
  clearEarnSession,
  getEarnSessionToken,
} from "@/lib/solana/earn/earn-session";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import { mmkv } from "@/lib/storage";

import {
  emitEarnRealtimeEvent,
  setEarnRealtimeScope,
  subscribeEarnRealtime,
} from "./events";
import { setEarnSessionRenewal } from "./session-renewal";
import {
  acceptEarnInvalidation,
  earnCursorKey,
  earnCursorScope,
  parseEarnFrames,
  type EarnSseFrame,
} from "./stream";

const RETRY_MAX_MS = 30_000;
const SILENCE_TIMEOUT_MS = 45_000;

export function EarnRealtimeProvider(): null {
  const { publicKey, state, signer } = useWallet();

  useEffect(() => {
    if (!publicKey || !isWalletUnlocked(state)) return;
    let stopped = false;
    let generation = 0;
    let retryMs = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let xhr: XMLHttpRequest | null = null;
    let renewalInFlight: Promise<void> | null = null;

    const unsubscribe = subscribeEarnRealtime(async (refresh) => {
      if (refresh.earnings)
        await refreshEarnEarningsCache(publicKey, {
          notify: true,
          throwOnError: true,
        });
    });
    const stopStream = () => {
      ++generation;
      if (xhr) {
        xhr.onerror = null;
        xhr.onloadend = null;
        xhr.onprogress = null;
        xhr.onreadystatechange = null;
        xhr.abort();
      }
      xhr = null;
      if (renewTimer) clearTimeout(renewTimer);
      if (silenceTimer) clearTimeout(silenceTimer);
      if (retryTimer) clearTimeout(retryTimer);
      renewTimer = silenceTimer = retryTimer = null;
    };
    const schedule = (delay = retryMs) => {
      if (stopped || AppState.currentState !== "active") return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void connect(), delay);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
    const renewSession = (): Promise<void> => {
      if (renewalInFlight) return renewalInFlight;
      renewalInFlight = (async () => {
        if (stopped || !signer || signer.publicKey.toBase58() !== publicKey)
          return;
        if (!(await ensureEarnRealtimeSession(publicKey, signer, true)))
          throw new Error(
            "Unable to renew Earn live updates. Please try again."
          );
        if (!stopped) {
          setEarnSessionRenewal(null);
          schedule(0);
        }
      })().finally(() => {
        renewalInFlight = null;
      });
      return renewalInFlight;
    };
    const connect = async () => {
      stopStream();
      const epoch = generation;
      const current = () =>
        !stopped && generation === epoch && AppState.currentState === "active";
      if (!current()) return;
      try {
        let sessionToken = await getEarnSessionToken(publicKey);
        if (!current()) return;
        if (!sessionToken) {
          if (
            signer?.kind === "local" &&
            signer.publicKey.toBase58() === publicKey
          ) {
            sessionToken = await ensureEarnRealtimeSession(publicKey, signer);
            if (!current()) return;
          } else {
            setEarnSessionRenewal(renewSession);
          }
        }
        if (!sessionToken) {
          schedule(RETRY_MAX_MS);
          return;
        }
        setEarnSessionRenewal(null);
        const token = await fetchEarnRealtimeToken(sessionToken).catch(
          async (error) => {
            if (error instanceof EarnApiError && error.status === 401)
              await clearEarnSession(sessionToken!);
            throw error;
          }
        );
        if (!current()) return;
        const key = earnCursorKey(token, publicKey);
        setEarnRealtimeScope(earnCursorScope(token, publicKey));
        const saved = mmkv.getString(key);
        const cursor = saved && /^\d+$/.test(saved) ? saved : null;
        let consumed = 0;
        let pending = "";
        let admitted = false;
        let processing = Promise.resolve();
        const stream = new XMLHttpRequest();
        xhr = stream;
        const reconnect = () => {
          if (!current()) return;
          stopStream();
          schedule();
        };
        const enqueue = (work: () => Promise<void>) => {
          processing = processing
            .then(async () => {
              if (current()) await work();
            })
            .catch(reconnect);
        };
        const resetSilenceTimer = () => {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(reconnect, SILENCE_TIMEOUT_MS);
        };
        const acceptFrame = async (frame: EarnSseFrame) => {
          if (frame.event !== "loyal_yield" || !frame.data) return;
          const message = JSON.parse(frame.data) as Record<string, unknown>;
          if (message.eventType === "resync_required") {
            await acceptEarnInvalidation({
              isCurrent: current,
              refresh: () => emitEarnRealtimeEvent(),
              acknowledge: () => {
                mmkv.delete(key);
                reconnect();
              },
            });
            return;
          }
          const eventId =
            typeof message.eventId === "string" ? message.eventId : frame.id;
          if (!eventId || !/^\d+$/.test(eventId))
            throw new Error("Invalid Earn event cursor.");
          const previous = mmkv.getString(key);
          if (
            previous &&
            /^\d+$/.test(previous) &&
            BigInt(eventId) <= BigInt(previous)
          )
            return;
          await acceptEarnInvalidation({
            isCurrent: current,
            refresh: () =>
              emitEarnRealtimeEvent(
                typeof message.eventType === "string"
                  ? message.eventType
                  : undefined,
                typeof message.state === "string" ? message.state : undefined
              ),
            acknowledge: () => {
              mmkv.setString(key, eventId);
              retryMs = 1_000;
            },
          });
        };
        const admit = () => {
          if (!current() || admitted || stream.readyState < 2) return;
          if (stream.status !== 200) {
            reconnect();
            return;
          }
          admitted = true;
          // Cursorless admission starts at the server high-water. Refresh AFTER
          // admission, before accepting any frames, to close the initial-read gap.
          // Also resync on resume/reconnect; replay is an invalidation plane.
          enqueue(() => emitEarnRealtimeEvent());
        };
        stream.open("GET", token.eventsUrl, true);
        stream.setRequestHeader("Accept", "text/event-stream");
        stream.setRequestHeader("Authorization", `Bearer ${token.accessToken}`);
        if (cursor) stream.setRequestHeader("Last-Event-ID", cursor);
        stream.onreadystatechange = admit;
        stream.onprogress = () => {
          if (!current()) return;
          admit();
          if (!admitted) return;
          resetSilenceTimer();
          const next = stream.responseText.slice(consumed);
          consumed += next.length;
          pending += next;
          let boundary: RegExpMatchArray | null;
          while (
            (boundary = pending.match(/\r?\n\r?\n/)) &&
            boundary.index !== undefined
          ) {
            const end = boundary.index + boundary[0].length;
            const complete = pending.slice(0, end);
            pending = pending.slice(end);
            for (const frame of parseEarnFrames(complete))
              enqueue(() => acceptFrame(frame));
          }
        };
        stream.onerror = reconnect;
        stream.onloadend = reconnect;
        stream.send();
        resetSilenceTimer();
        renewTimer = setTimeout(() => {
          if (current()) void connect();
        }, Math.max(Date.parse(token.expiresAt) - Date.now() - 15_000, 1_000));
      } catch {
        if (current()) schedule();
      }
    };
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        retryMs = 1_000;
        void connect();
      } else stopStream();
    });
    void connect();
    return () => {
      stopped = true;
      appState.remove();
      unsubscribe();
      setEarnSessionRenewal(null);
      setEarnRealtimeScope(null);
      stopStream();
    };
  }, [publicKey, state, signer]);

  return null;
}
