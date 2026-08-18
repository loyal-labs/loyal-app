export type OnboardingSlide = {
  title: string;
  description: string;
  image: number;
};

export type WalletSetupAction = {
  id: "connect-wallet" | "create" | "import" | "restore-icloud";
  label: string;
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
  hasCloudBackup = false,
): WalletSetupAction[] {
  // A found iCloud backup outranks everything: the user already has a wallet
  // and almost certainly wants it back, so restore renders as the primary.
  const restore: WalletSetupAction[] = hasCloudBackup
    ? [
        {
          id: "restore-icloud",
          label: "Restore from iCloud",
          helperText: "Wallet backup found in your iCloud",
        },
      ]
    : [];

  const createAndImport: WalletSetupAction[] = [
    { id: "create", label: "Create New Wallet" },
    { id: "import", label: "Import Existing Wallet" },
  ];

  // No external wallet backend (iOS: no Seed Vault, no Mobile Wallet
  // Adapter). Drop the action entirely rather than rendering a disabled
  // primary CTA — a dead first button that names another mobile platform is
  // both a bad first impression and an App Review flag.
  if (connectMode === "none") return [...restore, ...createAndImport];

  return [
    ...restore,
    connectMode === "seed-vault"
      ? { id: "connect-wallet", label: "Use Seed Vault" }
      : {
          id: "connect-wallet",
          label: "Connect Wallet",
          helperText: "Phantom, Solflare, or Seed Vault",
        },
    ...createAndImport,
  ];
}

export function getSetupStartStep(mode: OnboardingMode): OnboardingStartStep {
  return mode === "setup" ? "setup-onboarding" : "slides";
}
