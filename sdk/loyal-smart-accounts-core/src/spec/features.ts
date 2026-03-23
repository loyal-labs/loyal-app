export const FEATURE_INSTRUCTION_COVERAGE = {
  programConfig: [
    "initializeProgramConfig",
    "setProgramConfigAuthority",
    "setProgramConfigSmartAccountCreationFee",
    "setProgramConfigTreasury",
  ],
  smartAccounts: [
    "createSmartAccount",
    "addSignerAsAuthority",
    "removeSignerAsAuthority",
    "setTimeLockAsAuthority",
    "changeThresholdAsAuthority",
    "setNewSettingsAuthorityAsAuthority",
    "setArchivalAuthorityAsAuthority",
    "createSettingsTransaction",
    "closeSettingsTransaction",
  ],
  proposals: [
    "createProposal",
    "activateProposal",
    "approveProposal",
    "rejectProposal",
    "cancelProposal",
  ],
  transactions: [
    "createTransaction",
    "createTransactionBuffer",
    "closeTransactionBuffer",
    "extendTransactionBuffer",
    "createTransactionFromBuffer",
    "closeTransaction",
    "logEvent",
  ],
  batches: [
    "createBatch",
    "addTransactionToBatch",
    "closeBatchTransaction",
    "closeBatch",
  ],
  policies: ["closeEmptyPolicyTransaction"],
  spendingLimits: [
    "addSpendingLimitAsAuthority",
    "removeSpendingLimitAsAuthority",
    "useSpendingLimit",
  ],
  execution: [
    "executeSettingsTransaction",
    "executeTransaction",
    "executeBatchTransaction",
    "executeTransactionSync",
    "executeTransactionSyncV2",
    "executeSettingsTransactionSync",
  ],
} as const;

export const EXTRA_FEATURE_ACTIONS = {
  policies: ["createPolicyTransaction"],
  execution: ["executePolicyTransaction", "executePolicyPayloadSync"],
} as const;

export const PUBLIC_FEATURE_EXPORTS = [
  "programConfig",
  "smartAccounts",
  "proposals",
  "transactions",
  "batches",
  "policies",
  "spendingLimits",
  "execution",
] as const;
