export const SPONSOR_SETUP_STAGES = [
  "settings",
  "autodeposit-authority",
  "autodeposit-policy",
  "autodeposit-delegation",
  "autodeposit-approval",
  "earn-route-policy",
  "earn-setup-policy",
  "exit-policy",
  "teardown-withdraw",
  "teardown-cleanup",
  "teardown-autodeposit",
  "teardown-exit",
  "teardown-refund",
] as const;

export const DEMO_MOVE_ACTIONS = [
  "wallet_to_smart_account",
  "smart_account_to_kamino",
  "kamino_to_smart_account",
  "smart_account_to_wallet",
] as const;

export type SponsorStage = (typeof SPONSOR_SETUP_STAGES)[number];
export type DemoMoveAction = (typeof DEMO_MOVE_ACTIONS)[number];

export type SponsorPolicyReference = {
  account: string;
  seed: string;
};

export type DemoPolicyBundle = {
  autodeposit: SponsorPolicyReference & {
    nonce: string;
    recurringDelegation: string;
  };
  earnRoute: SponsorPolicyReference;
  earnSetup: SponsorPolicyReference;
  exit: SponsorPolicyReference;
};

export type DemoExpectedMoneyState = {
  kaminoUsdcRaw: string;
  smartAccountUsdcRaw: string;
  walletUsdcRaw: string;
};

export type SponsorSetupRequestBody = {
  kind: "setup";
  transaction: string;
  wallet: string;
  settings: string;
  stage: SponsorStage;
  autodepositPolicySeed?: string;
};

export type SponsorPrefundRequestBody = {
  kind: "prefund";
  wallet: string;
  settings: string;
};

export type DemoMoveRequestBody = {
  kind: "move";
  action: DemoMoveAction;
  wallet: string;
  settings: string;
  policies: DemoPolicyBundle;
  expected: DemoExpectedMoneyState;
};

export type SponsorRequestBody =
  | SponsorSetupRequestBody
  | SponsorPrefundRequestBody
  | DemoMoveRequestBody;

export type SponsorResponse = {
  signature: string;
};
