import {
  buildOriginFaviconUrl,
  coerceBrowserUrl,
  getTrustState,
  normalizeOrigin,
} from "../model/origin";

describe("dapp browser origin helpers", () => {
  it("coerces browser urls with https when missing a scheme", () => {
    expect(coerceBrowserUrl("jup.ag")).toBe("https://jup.ag");
  });

  it("normalizes an origin from a url", () => {
    expect(normalizeOrigin("https://jup.ag/swap?input=SOL")).toBe("https://jup.ag");
  });

  it("builds a favicon url from an origin", () => {
    expect(buildOriginFaviconUrl("https://jup.ag")).toBe("https://jup.ag/favicon.ico");
  });

  it("prefers trusted origins over connected origins", () => {
    expect(getTrustState("https://jup.ag", ["https://jup.ag", "https://example.com"])).toBe(
      "trusted",
    );
  });
});
