import { buildBrowserHref } from "../routes";

describe("buildBrowserHref", () => {
  it("returns the dedicated browser route", () => {
    expect(buildBrowserHref()).toBe("/browser");
  });
});
