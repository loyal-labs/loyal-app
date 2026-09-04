// Earn/Autodeposit events. Mixpanel cohorts for push nudges (ASK-1651) key
// off these — rename in lockstep with the cohort definitions.
export const EARN_EVENTS = {
  earnDeposit: "Earn Deposit",
  autodepositEnabled: "Autodeposit Enabled",
  autodepositDisabled: "Autodeposit Disabled",
} as const;
