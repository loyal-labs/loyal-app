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
    title: "Group Summaries",
    description:
      "Filter noise and Instantly see what’s happening in group chats you don’t have time to read.",
    image: require("../../../assets/images/onboarding/on1.png"),
  },
  {
    title: "Swipe Through Your DMs",
    description: "Quickly review and manage your Telegram DMs in one place.",
    image: require("../../../assets/images/onboarding/on2.png"),
  },
  {
    title: "Private Transactions",
    description:
      "Send crypto privately over Telegram username. Don’t reveal your address and sensitive data onchain.",
    image: require("../../../assets/images/onboarding/on3.png"),
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
