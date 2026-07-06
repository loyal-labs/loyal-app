export type OnboardingSlide = {
  title: string;
  description: string;
  image: number;
};

export type WalletSetupAction = {
  id: "seed-vault" | "create" | "import";
  label: string;
  disabled: boolean;
  helperText?: string;
};

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
  seedVaultAvailable: boolean,
): WalletSetupAction[] {
  return [
    {
      id: "seed-vault",
      label: "Use Seed Vault",
      disabled: !seedVaultAvailable,
      helperText: !seedVaultAvailable
        ? "Only available on Solana Seeker"
        : undefined,
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
