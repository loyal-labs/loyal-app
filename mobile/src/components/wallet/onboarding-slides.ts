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
    title: "Privacy Makes Money",
    description: "Keep your cash private and earn up to 8% APY.",
    image: require("../../../assets/images/onboarding/on1.png"),
  },
  {
    title: "Gasless Private Transactions",
    description: "Zero fees and sub-10ms latency for any private transfers.",
    image: require("../../../assets/images/onboarding/on2.png"),
  },
  {
    title: "Send Over Telegram",
    description:
      "Send crypto to anyone over Telegram. Don’t reveal your address or sensitive data onchain.",
    image: require("../../../assets/images/onboarding/on3.png"),
  },
];

export function buildWalletSetupActions(
  seedVaultAvailable: boolean
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
