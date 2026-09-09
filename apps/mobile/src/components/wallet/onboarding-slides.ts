export type OnboardingSlide = {
  title: string;
  description: string;
  image: number;
};

/**
 * Which external-wallet connect path this binary supports: "mwa" on builds
 * with the MWA native module, "seed-vault" as the legacy fallback on older
 * Seeker builds receiving this bundle via OTA, "deeplink" on iOS with
 * Phantom/Solflare installed, "none" elsewhere.
 */
export type WalletConnectMode = "mwa" | "seed-vault" | "deeplink" | "none";

export type OnboardingMode = "setup" | "replay";

export type OnboardingStartStep = "slides" | "sign-in";

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    title: "Autodeposit",
    description:
      "Connect your wallet once and earn the best rate on USDC with loyal automations",
    image: require("../../../assets/images/onboarding/autodeposit.png"),
  },
];

export function getSetupStartStep(mode: OnboardingMode): OnboardingStartStep {
  return mode === "setup" ? "sign-in" : "slides";
}
