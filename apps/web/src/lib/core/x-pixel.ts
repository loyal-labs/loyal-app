"use client";

import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";

export const X_PIXEL_ID = "qsgmc";
export const X_PIXEL_SCRIPT_SRC = "https://static.ads-twitter.com/uwt.js";

export const X_PIXEL_EVENTS = {
  signup: "tw-qsgmc-qsgme",
  installExtension: "tw-qsgmc-qsgmf",
} as const;

export type XPixelEventId =
  (typeof X_PIXEL_EVENTS)[keyof typeof X_PIXEL_EVENTS];

type Twq = ((...args: unknown[]) => void) & {
  exe?: (...args: unknown[]) => void;
  queue?: unknown[][];
  version?: string;
};

declare global {
  interface Window {
    twq?: Twq;
  }
}

let hasInitialized = false;

function ensureTwqStub(): Twq {
  if (window.twq) {
    return window.twq;
  }

  const stub: Twq = function (...args: unknown[]) {
    if (stub.exe) {
      stub.exe(...args);
      return;
    }
    stub.queue?.push(args);
  } as Twq;

  stub.version = "1.1";
  stub.queue = [];
  window.twq = stub;

  const script = document.createElement("script");
  script.async = true;
  script.src = X_PIXEL_SCRIPT_SRC;

  const firstScript = document.getElementsByTagName("script")[0];
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  return stub;
}

export function loadXPixel(pixelId: string = X_PIXEL_ID): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  if (hasInitialized) {
    return;
  }

  const twq = ensureTwqStub();
  twq("config", pixelId);
  hasInitialized = true;
}

export function isXPixelLoaded(): boolean {
  return hasInitialized;
}

export function xPixelEvent(
  eventId: XPixelEventId | string,
  properties: AnalyticsProperties = {}
): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!hasInitialized || !window.twq) {
    return;
  }
  window.twq("event", eventId, properties);
}

export function __resetXPixelForTests(): void {
  hasInitialized = false;
  if (typeof window !== "undefined") {
    delete (window as { twq?: unknown }).twq;
  }
}
