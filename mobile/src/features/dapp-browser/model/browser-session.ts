export type BrowserSession = {
  mode: "home" | "page";
  currentUrl: string | null;
  pendingUrlInput: string;
  title: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
};

export function createBrowserSession(): BrowserSession {
  return {
    mode: "home",
    currentUrl: null,
    pendingUrlInput: "",
    title: null,
    canGoBack: false,
    canGoForward: false,
  };
}

export function openUrl(session: BrowserSession, url: string): BrowserSession {
  return {
    ...session,
    mode: "page",
    currentUrl: url,
    pendingUrlInput: url,
    title: null,
    canGoBack: false,
    canGoForward: false,
  };
}

export function applyNavigationSnapshot(
  session: BrowserSession,
  snapshot: {
    url: string;
    title: string | null;
    canGoBack: boolean;
    canGoForward: boolean;
  },
): BrowserSession {
  return {
    ...session,
    mode: "page",
    currentUrl: snapshot.url,
    pendingUrlInput: snapshot.url,
    title: snapshot.title,
    canGoBack: snapshot.canGoBack,
    canGoForward: snapshot.canGoForward,
  };
}

export function goHome(session: BrowserSession): BrowserSession {
  return {
    ...session,
    mode: "home",
    canGoBack: false,
    canGoForward: false,
  };
}
