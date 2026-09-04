import { describe, expect, test } from "bun:test";

import { waitForEarnRealtimeRecovery } from "./recovery";

class CountingEventTarget extends EventTarget {
  readonly counts = new Map<string, number>();

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    super.addEventListener(type, callback, options);
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void {
    super.removeEventListener(type, callback, options);
    this.counts.set(type, Math.max(0, (this.counts.get(type) ?? 0) - 1));
  }
}

describe("Earn realtime recovery wakeups", () => {
  test("online wakeup cancels backoff and removes every listener", async () => {
    const windowTarget = new CountingEventTarget();
    const documentTarget = new CountingEventTarget();
    let timerCanceled = false;
    const recovery = waitForEarnRealtimeRecovery({
      attempt: 5,
      documentTarget,
      schedule: () => () => {
        timerCanceled = true;
      },
      signal: new AbortController().signal,
      windowTarget,
    });

    expect(windowTarget.counts.get("online")).toBe(1);
    expect(documentTarget.counts.get("visibilitychange")).toBe(1);
    windowTarget.dispatchEvent(new Event("online"));
    await recovery;

    expect(timerCanceled).toBe(true);
    expect(windowTarget.counts.get("online")).toBe(0);
    expect(documentTarget.counts.get("visibilitychange")).toBe(0);
  });

  test("visible wakeup waits until the browser is both visible and online", async () => {
    const documentTarget = new CountingEventTarget();
    let visible = false;
    let online = true;
    let completed = false;
    const recovery = waitForEarnRealtimeRecovery({
      attempt: 0,
      documentTarget,
      isOnline: () => online,
      isVisible: () => visible,
      schedule: () => () => undefined,
      signal: new AbortController().signal,
      windowTarget: null,
    }).then(() => {
      completed = true;
    });

    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(completed).toBe(false);

    visible = true;
    online = false;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(completed).toBe(false);

    online = true;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await recovery;
    expect(completed).toBe(true);
    expect(documentTarget.counts.get("visibilitychange")).toBe(0);
  });
});
