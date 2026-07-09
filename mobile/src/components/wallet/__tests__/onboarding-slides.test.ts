import {
  buildWalletSetupActions,
  getSetupStartStep,
  ONBOARDING_SLIDES,
} from "../onboarding-slides";

describe("ONBOARDING_SLIDES", () => {
  it("preserves the existing slide order and copy", () => {
    expect(ONBOARDING_SLIDES.map((slide) => slide.title)).toEqual([
      "Autodeposit",
    ]);
    expect(ONBOARDING_SLIDES).toHaveLength(1);
  });

  it("exposes image and description for each slide", () => {
    expect(ONBOARDING_SLIDES.every((slide) => slide.description.length > 0)).toBe(true);
    expect(ONBOARDING_SLIDES.every((slide) => typeof slide.image === "number")).toBe(true);
  });
});

describe("buildWalletSetupActions", () => {
  it("marks Connect Wallet unavailable when no external wallet path exists", () => {
    expect(buildWalletSetupActions("none")[0]).toMatchObject({
      id: "connect-wallet",
      label: "Connect Wallet",
      disabled: true,
      helperText: "Only available on Android",
    });
  });

  it("enables Connect Wallet and names supported wallets on MWA builds", () => {
    expect(buildWalletSetupActions("mwa")[0]).toMatchObject({
      id: "connect-wallet",
      label: "Connect Wallet",
      disabled: false,
      helperText: "Phantom, Solflare, or Seed Vault",
    });
  });

  it("falls back to the direct Seed Vault action on pre-MWA Seeker builds", () => {
    expect(buildWalletSetupActions("seed-vault")[0]).toMatchObject({
      id: "connect-wallet",
      label: "Use Seed Vault",
      disabled: false,
    });
  });

  it("keeps create and import actions enabled", () => {
    const actions = buildWalletSetupActions("none");
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
