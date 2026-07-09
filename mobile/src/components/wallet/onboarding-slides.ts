export type OnboardingSlide = {
  title: string;
  description: string;
  image: number;
};

export type WalletSetupAction = {
  id: "connect-wallet" | "create" | "import";
  label: string;
  disabled: boolean;
  helperText?: string;
};

/**
 * Which external-wallet connect path this binary supports: "mwa" on builds
 * with the MWA native module, "seed-vault" as the legacy fallback on older
 * Seeker builds receiving this bundle via OTA, "none" elsewhere (iOS,
 * non-Seeker Android without MWA).
 */
export type WalletConnectMode = "mwa" | "seed-vault" | "none";

export type OnboardingMode = "setup" | "replay";

export type OnboardingStartStep = "slides" | "setup-onboarding";

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    title: "Autodeposit",
    description:
      "Connect your wallet once and earn the best rate on USDC with loyal automations",
    image: require("../../../assets/images/onboarding/autodeposit.png"),
  },
];

export function buildWalletSetupActions(
  connectMode: WalletConnectMode,
): WalletSetupAction[] {
  return [
    connectMode === "seed-vault"
      ? {
          id: "connect-wallet",
          label: "Use Seed Vault",
          disabled: false,
        }
      : {
          id: "connect-wallet",
          label: "Connect Wallet",
          disabled: connectMode === "none",
          helperText:
            connectMode === "none"
              ? "Only available on Android"
              : "Phantom, Solflare, or Seed Vault",
        },
    {
      id: "create",
      label: "Create New Wallet",
      disabled: false,
    },
    {
      id: "import",
      label: "Import Existing Wallet",
      disabled: false,
    },
  ];
}

export function getSetupStartStep(mode: OnboardingMode): OnboardingStartStep {
  return mode === "setup" ? "setup-onboarding" : "slides";
}
