import {
  applyNavigationSnapshot,
  createBrowserSession,
  goHome,
  openUrl,
} from "../model/browser-session";

describe("browser session", () => {
  it("opens a URL and flips out of home mode", () => {
    const session = openUrl(createBrowserSession(), "https://jup.ag");

    expect(session).toMatchObject({
      mode: "page",
      currentUrl: "https://jup.ag",
      pendingUrlInput: "https://jup.ag",
    });
  });

  it("tracks navigation flags from the webview", () => {
    const next = applyNavigationSnapshot(createBrowserSession(), {
      url: "https://jup.ag/swap",
      title: "Jupiter",
      canGoBack: true,
      canGoForward: false,
    });

    expect(next).toMatchObject({
      currentUrl: "https://jup.ag/swap",
      title: "Jupiter",
      canGoBack: true,
      canGoForward: false,
    });
  });

  it("returns to the home surface", () => {
    expect(goHome(openUrl(createBrowserSession(), "https://jup.ag")).mode).toBe(
      "home"
    );
  });
});
