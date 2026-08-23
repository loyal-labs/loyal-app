import { useEffect } from "react";
import { AppState } from "react-native";

import { env } from "@/config/env";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { earnHeaders } from "@/lib/solana/earn/earn-api";
import { clearEarnSession, getEarnSessionToken } from "@/lib/solana/earn/earn-session";
import { mmkv } from "@/lib/storage";

import { emitEarnRealtimeEvent } from "./events";

type TokenResponse = {
  accessToken: string;
  eventsUrl: string;
  expiresAt: string;
  schemaVersion: 1;
};

const RETRY_MAX_MS = 30_000;
const SILENCE_TIMEOUT_MS = 45_000;

function cursorKey(walletAddress: string): string {
  return `earn:realtime:v1:${walletAddress}`;
}

function parseFrames(text: string): { data: string; event?: string; id?: string }[] {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    if (!block.trim()) return [];
    const frame: { data: string; event?: string; id?: string } = { data: "" };
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "data") frame.data += `${frame.data ? "\n" : ""}${value}`;
      else if (field === "event") frame.event = value;
      else if (field === "id") frame.id = value;
    }
    return frame.data || frame.event || frame.id ? [frame] : [];
  });
}

async function requestToken(walletAddress: string): Promise<TokenResponse | null> {
  const sessionToken = await getEarnSessionToken(walletAddress);
  if (!sessionToken) return null;
  const response = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/realtime/token`,
    {
      headers: { ...earnHeaders(), Authorization: `Bearer ${sessionToken}` },
      method: "POST",
    },
  );
  if (response.status === 401) await clearEarnSession();
  if (!response.ok) return null;
  const value = (await response.json()) as Partial<TokenResponse>;
  return value.schemaVersion === 1 && value.accessToken && value.eventsUrl && value.expiresAt
    ? (value as TokenResponse)
    : null;
}

export function EarnRealtimeProvider(): null {
  const { publicKey, state } = useWallet();

  useEffect(() => {
    if (!publicKey || state !== "vault-unlocked") return;
    let stopped = false;
    let retryMs = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let xhr: XMLHttpRequest | null = null;

    const stopStream = () => {
      if (xhr) {
        xhr.onerror = null;
        xhr.onloadend = null;
        xhr.onprogress = null;
        xhr.abort();
      }
      xhr = null;
      if (renewTimer) clearTimeout(renewTimer);
      renewTimer = null;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
    };
    const schedule = (delay = retryMs) => {
      if (stopped || AppState.currentState !== "active") return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void connect(), delay);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
    const connect = async () => {
      stopStream();
      const token = await requestToken(publicKey).catch(() => null);
      if (!token || stopped || AppState.currentState !== "active") {
        schedule(token ? retryMs : RETRY_MAX_MS);
        return;
      }
      let consumed = 0;
      let pending = "";
      let processing = Promise.resolve();
      let accepting = true;
      const cursor = mmkv.getString(cursorKey(publicKey));
      xhr = new XMLHttpRequest();
      xhr.open("GET", token.eventsUrl, true);
      xhr.setRequestHeader("Accept", "text/event-stream");
      xhr.setRequestHeader("Authorization", `Bearer ${token.accessToken}`);
      if (cursor) xhr.setRequestHeader("Last-Event-ID", cursor);
      const resetSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          stopStream();
          schedule();
        }, SILENCE_TIMEOUT_MS);
      };
      const acceptFrame = async (frame: {
        data: string;
        event?: string;
        id?: string;
      }) => {
        if (frame.event !== "loyal_yield" || !frame.data) return;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(frame.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.eventType === "resync_required") {
          await emitEarnRealtimeEvent();
          mmkv.delete(cursorKey(publicKey));
          return;
        }
        const eventId =
          typeof message.eventId === "string" ? message.eventId : frame.id;
        if (!eventId || !/^\d+$/.test(eventId)) return;
        const previous = mmkv.getString(cursorKey(publicKey));
        if (previous && BigInt(eventId) <= BigInt(previous)) return;
        await emitEarnRealtimeEvent(
          typeof message.eventType === "string"
            ? message.eventType
            : undefined,
          typeof message.state === "string" ? message.state : undefined,
        );
        mmkv.setString(cursorKey(publicKey), eventId);
        retryMs = 1_000;
      };
      xhr.onprogress = () => {
        resetSilenceTimer();
        const next = xhr?.responseText.slice(consumed) ?? "";
        consumed += next.length;
        pending += next;
        const boundary = pending.match(/\r?\n\r?\n/);
        if (!boundary) return;
        const end = pending.lastIndexOf(boundary[0]);
        const complete = pending.slice(0, end + boundary[0].length);
        pending = pending.slice(end + boundary[0].length);
        for (const frame of parseFrames(complete)) {
          processing = processing
            .then(() => (accepting ? acceptFrame(frame) : undefined))
            .catch(() => {
              accepting = false;
              stopStream();
              schedule();
            });
        }
      };
      xhr.onerror = () => {
        stopStream();
        schedule();
      };
      xhr.onloadend = () => {
        stopStream();
        schedule();
      };
      xhr.send();
      resetSilenceTimer();
      const renewIn = Math.max(Date.parse(token.expiresAt) - Date.now() - 15_000, 1_000);
      renewTimer = setTimeout(() => void connect(), renewIn);
    };

    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void emitEarnRealtimeEvent();
        retryMs = 1_000;
        void connect();
      } else stopStream();
    });
    void connect();
    return () => {
      stopped = true;
      appState.remove();
      stopStream();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [publicKey, state]);

  return null;
}
