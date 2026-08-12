import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

import {
  COOKIE_CONSENT_CHANGED_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  hasMarketingConsent,
  persistCookieConsent,
  readStoredCookieConsent,
} from "../cookie-consent-state";

type FakeWindow = {
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
  addEventListener: (...args: unknown[]) => void;
  removeEventListener: (...args: unknown[]) => void;
  dispatchEvent: ReturnType<typeof mock>;
};

function setupFakeWindow(): FakeWindow {
  const store = new Map<string, string>();
  const fakeWindow: FakeWindow = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: mock(),
  };
  (globalThis as { window?: unknown }).window = fakeWindow;
  return fakeWindow;
}

describe("cookie-consent-state", () => {
  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = setupFakeWindow();
    (globalThis as { CustomEvent?: unknown }).CustomEvent = class FakeCustomEvent {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
  });

  test("readStoredCookieConsent returns all-false when storage is empty", () => {
    expect(readStoredCookieConsent()).toEqual({
      analytics: false,
      marketing: false,
      personalization: false,
    });
  });

  test("readStoredCookieConsent parses persisted choices", () => {
    fakeWindow.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({ analytics: true, marketing: true })
    );

    expect(readStoredCookieConsent()).toEqual({
      analytics: true,
      marketing: true,
      personalization: false,
    });
  });

  test("readStoredCookieConsent ignores malformed JSON", () => {
    fakeWindow.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "{not json");

    expect(readStoredCookieConsent()).toEqual({
      analytics: false,
      marketing: false,
      personalization: false,
    });
  });

  test("persistCookieConsent writes to storage and dispatches event", () => {
    persistCookieConsent({
      analytics: true,
      marketing: true,
      personalization: false,
    });

    expect(fakeWindow.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe(
      JSON.stringify({
        analytics: true,
        marketing: true,
        personalization: false,
      })
    );

    expect(fakeWindow.dispatchEvent).toHaveBeenCalledTimes(1);
    const dispatched = fakeWindow.dispatchEvent.mock.calls[0]?.[0] as {
      type: string;
      detail: unknown;
    };
    expect(dispatched.type).toBe(COOKIE_CONSENT_CHANGED_EVENT);
    expect(dispatched.detail).toEqual({
      analytics: true,
      marketing: true,
      personalization: false,
    });
  });

  test("hasMarketingConsent reflects persisted marketing flag", () => {
    expect(hasMarketingConsent()).toBe(false);

    persistCookieConsent({
      analytics: false,
      marketing: true,
      personalization: false,
    });

    expect(hasMarketingConsent()).toBe(true);
  });
});
