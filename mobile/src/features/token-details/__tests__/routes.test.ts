import { buildTokenDetailHref } from "../routes";

describe("buildTokenDetailHref", () => {
  it("builds the token detail route for a mint", () => {
    expect(buildTokenDetailHref("So11111111111111111111111111111111111111112")).toBe(
      "/token/So11111111111111111111111111111111111111112",
    );
  });
});
