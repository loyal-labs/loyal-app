import {
  buildWalletSetupActions,
  getSetupStartStep,
  ONBOARDING_SLIDES,
} from "../onboarding-slides";

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

describe("buildWalletSetupActions", () => {
  it("marks Seed Vault unavailable when the device does not support it", () => {
    expect(buildWalletSetupActions(false)[0]).toMatchObject({
      id: "seed-vault",
      disabled: true,
      helperText: "Only available on Solana Seeker",
    });
  });

  it("keeps create and import actions enabled", () => {
    const actions = buildWalletSetupActions(false);
    expect(actions[1].disabled).toBe(false);
    expect(actions[2].disabled).toBe(false);
  });
});

describe("getSetupStartStep", () => {
  it("starts setup in the combined onboarding and replay in slides", () => {
    expect(getSetupStartStep("setup")).toBe("setup-onboarding");
    expect(getSetupStartStep("replay")).toBe("slides");
  });
});
