export const SPONSOR_SETUP_STAGES = [
  "settings",
  "autodeposit-authority",
  "autodeposit-policy",
  "autodeposit-delegation",
  "autodeposit-approval",
  "earn-route-policy",
  "earn-setup-policy",
  "exit-policy",
] as const;

export const DEMO_MOVE_ACTIONS = [
  "wallet_to_smart_account",
  "smart_account_to_kamino",
  "kamino_to_smart_account",
  "smart_account_to_wallet",
] as const;

export type SponsorStage = (typeof SPONSOR_SETUP_STAGES)[number];
export type DemoMoveAction = (typeof DEMO_MOVE_ACTIONS)[number];

// Fixed demo money movement amounts (raw USDC units, 6 decimals). Client and
// server both build transactions from these; they must never diverge.
export const AUTODEPOSIT_AMOUNT_RAW = 2_000_000n;
export const AUTODEPOSIT_NONCE = 0n;
export const AUTODEPOSIT_PERIOD_SECONDS = 30n * 24n * 60n * 60n;
export const AUTODEPOSIT_EXPIRY = 9_223_372_036_854_775_807n;
export const KAMINO_DEPOSIT_AMOUNT_RAW = 2_000_000n;
export const KAMINO_WITHDRAW_AMOUNT_RAW = 1_000_000n;
export const WALLET_RETURN_AMOUNT_RAW = 1_000_000n;
export const EXIT_DAILY_LIMIT_RAW = 10_000_000n;

// Maps the vaults SDK's autodeposit sub-stage names to the demo's sponsor
// stages. Shared so the client's stage selection and the server's stage
// verification can never drift apart.
export const AUTODEPOSIT_STAGE_BY_SDK_STAGE = {
  initialize_subscription_authority: "autodeposit-authority",
  create_policy: "autodeposit-policy",
  create_recurring_delegation: "autodeposit-delegation",
  approve_token_delegate: "autodeposit-approval",
} as const satisfies Record<string, SponsorStage>;

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
