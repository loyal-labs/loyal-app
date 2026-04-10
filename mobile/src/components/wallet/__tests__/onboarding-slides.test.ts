import { ONBOARDING_SLIDES } from "../onboarding-slides";

describe("ONBOARDING_SLIDES", () => {
  it("preserves the existing slide order and copy", () => {
    expect(ONBOARDING_SLIDES.map((slide) => slide.title)).toEqual([
      "Group Summaries",
      "Swipe Through Your DMs",
      "Private Transactions",
    ]);
    expect(ONBOARDING_SLIDES).toHaveLength(3);
  });
});
