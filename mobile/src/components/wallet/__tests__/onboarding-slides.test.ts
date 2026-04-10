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

  it("exposes image and description for each slide", () => {
    expect(ONBOARDING_SLIDES.every((slide) => slide.description.length > 0)).toBe(true);
    expect(ONBOARDING_SLIDES.every((slide) => typeof slide.image === "number")).toBe(true);
  });
});
