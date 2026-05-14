import { buildBrowserHref, buildBrowserSiteHref } from "../routes";

describe("dapp browser routes", () => {
  it("buildBrowserHref returns the home tab path", () => {
    expect(buildBrowserHref()).toBe("/browser");
  });

  it("buildBrowserSiteHref encodes the target URL as a query param", () => {
    expect(buildBrowserSiteHref("https://jup.ag/swap")).toEqual({
      pathname: "/browser/site",
      params: { url: "https://jup.ag/swap" },
    });
  });
});
