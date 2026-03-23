import {
  EXTRA_FEATURE_ACTIONS,
  FEATURE_INSTRUCTION_COVERAGE,
} from "./features.js";

export type LoyalSmartAccountsFeature =
  keyof typeof FEATURE_INSTRUCTION_COVERAGE;

export type LoyalSmartAccountsOperationPhase = "offline" | "online";

export type LoyalSmartAccountsOperationMetadata = {
  feature: LoyalSmartAccountsFeature;
  instruction: string;
  exportName: string;
  phase: LoyalSmartAccountsOperationPhase;
  payerRole: string;
  signerRoles: readonly string[];
  signerFallbacks?: Readonly<Record<string, string>>;
  exposeInstruction?: boolean;
  requiresConnection?: boolean;
  requiresLookupTables?: boolean;
  requiresConfirmation?: boolean;
};

const featureInstructionCoverage = FEATURE_INSTRUCTION_COVERAGE;
const extraFeatureActions = EXTRA_FEATURE_ACTIONS;

export const OPERATION_REGISTRY = {
  initializeProgramConfig: {
    feature: "programConfig",
    instruction: "initializeProgramConfig",
    exportName: "initialize",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "initializer"],
  },
  setProgramConfigAuthority: {
    feature: "programConfig",
    instruction: "setProgramConfigAuthority",
    exportName: "setAuthority",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "authority"],
  },
  setProgramConfigSmartAccountCreationFee: {
    feature: "programConfig",
    instruction: "setProgramConfigSmartAccountCreationFee",
    exportName: "setSmartAccountCreationFee",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "authority"],
  },
  setProgramConfigTreasury: {
    feature: "programConfig",
    instruction: "setProgramConfigTreasury",
    exportName: "setTreasury",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "authority"],
  },
  createSmartAccount: {
    feature: "smartAccounts",
    instruction: "createSmartAccount",
    exportName: "create",
    phase: "offline",
    payerRole: "creator",
    signerRoles: ["creator"],
  },
  addSignerAsAuthority: {
    feature: "smartAccounts",
    instruction: "addSignerAsAuthority",
    exportName: "addSigner",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "rentPayer"],
  },
  removeSignerAsAuthority: {
    feature: "smartAccounts",
    instruction: "removeSignerAsAuthority",
    exportName: "removeSigner",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  setTimeLockAsAuthority: {
    feature: "smartAccounts",
    instruction: "setTimeLockAsAuthority",
    exportName: "setTimeLock",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  changeThresholdAsAuthority: {
    feature: "smartAccounts",
    instruction: "changeThresholdAsAuthority",
    exportName: "changeThreshold",
    phase: "offline",
    payerRole: "settingsAuthority",
    signerRoles: ["settingsAuthority", "rentPayer"],
  },
  setNewSettingsAuthorityAsAuthority: {
    feature: "smartAccounts",
    instruction: "setNewSettingsAuthorityAsAuthority",
    exportName: "setNewSettingsAuthority",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  setArchivalAuthorityAsAuthority: {
    feature: "smartAccounts",
    instruction: "setArchivalAuthorityAsAuthority",
    exportName: "setArchivalAuthority",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  createSettingsTransaction: {
    feature: "smartAccounts",
    instruction: "createSettingsTransaction",
    exportName: "createSettingsTransaction",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  closeSettingsTransaction: {
    feature: "smartAccounts",
    instruction: "closeSettingsTransaction",
    exportName: "closeSettingsTransaction",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  createProposal: {
    feature: "proposals",
    instruction: "createProposal",
    exportName: "create",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "creator", "rentPayer"],
    signerFallbacks: {
      rentPayer: "creator",
    },
  },
  activateProposal: {
    feature: "proposals",
    instruction: "activateProposal",
    exportName: "activate",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signer"],
  },
  approveProposal: {
    feature: "proposals",
    instruction: "approveProposal",
    exportName: "approve",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signer"],
  },
  rejectProposal: {
    feature: "proposals",
    instruction: "rejectProposal",
    exportName: "reject",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signer"],
  },
  cancelProposal: {
    feature: "proposals",
    instruction: "cancelProposal",
    exportName: "cancel",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signer"],
  },
  createTransaction: {
    feature: "transactions",
    instruction: "createTransaction",
    exportName: "create",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  createTransactionBuffer: {
    feature: "transactions",
    instruction: "createTransactionBuffer",
    exportName: "createBuffer",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "creator", "rentPayer"],
    signerFallbacks: {
      rentPayer: "creator",
    },
  },
  closeTransactionBuffer: {
    feature: "transactions",
    instruction: "closeTransactionBuffer",
    exportName: "closeBuffer",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "creator"],
  },
  extendTransactionBuffer: {
    feature: "transactions",
    instruction: "extendTransactionBuffer",
    exportName: "extendBuffer",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "creator"],
  },
  createTransactionFromBuffer: {
    feature: "transactions",
    instruction: "createTransactionFromBuffer",
    exportName: "createFromBuffer",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "creator", "rentPayer"],
    signerFallbacks: {
      rentPayer: "creator",
    },
  },
  closeTransaction: {
    feature: "transactions",
    instruction: "closeTransaction",
    exportName: "close",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  logEvent: {
    feature: "transactions",
    instruction: "logEvent",
    exportName: "logEvent",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "logAuthority"],
  },
  createBatch: {
    feature: "batches",
    instruction: "createBatch",
    exportName: "create",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "creator", "rentPayer"],
    signerFallbacks: {
      rentPayer: "creator",
    },
  },
  addTransactionToBatch: {
    feature: "batches",
    instruction: "addTransactionToBatch",
    exportName: "addTransaction",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signer", "rentPayer"],
    signerFallbacks: {
      rentPayer: "signer",
    },
    exposeInstruction: false,
    requiresLookupTables: true,
  },
  closeBatchTransaction: {
    feature: "batches",
    instruction: "closeBatchTransaction",
    exportName: "closeTransaction",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  closeBatch: {
    feature: "batches",
    instruction: "closeBatch",
    exportName: "close",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  createPolicyTransaction: {
    feature: "policies",
    instruction: "createPolicyTransaction",
    exportName: "createTransaction",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  closeEmptyPolicyTransaction: {
    feature: "policies",
    instruction: "closeEmptyPolicyTransaction",
    exportName: "closeEmptyTransaction",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  addSpendingLimitAsAuthority: {
    feature: "spendingLimits",
    instruction: "addSpendingLimitAsAuthority",
    exportName: "add",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "settingsAuthority", "rentPayer"],
  },
  removeSpendingLimitAsAuthority: {
    feature: "spendingLimits",
    instruction: "removeSpendingLimitAsAuthority",
    exportName: "remove",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  useSpendingLimit: {
    feature: "spendingLimits",
    instruction: "useSpendingLimit",
    exportName: "use",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signer"],
  },
  executeSettingsTransaction: {
    feature: "execution",
    instruction: "executeSettingsTransaction",
    exportName: "executeSettingsTransaction",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signer", "rentPayer"],
    requiresConfirmation: true,
  },
  executeTransaction: {
    feature: "execution",
    instruction: "executeTransaction",
    exportName: "executeTransaction",
    phase: "online",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
    requiresConnection: true,
    requiresLookupTables: true,
    requiresConfirmation: true,
  },
  executeBatchTransaction: {
    feature: "execution",
    instruction: "executeBatchTransaction",
    exportName: "executeBatchTransaction",
    phase: "online",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signer"],
    requiresConnection: true,
    requiresLookupTables: true,
    requiresConfirmation: true,
  },
  executeTransactionSync: {
    feature: "execution",
    instruction: "executeTransactionSync",
    exportName: "executeTransactionSync",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signers"],
  },
  executeTransactionSyncV2: {
    feature: "execution",
    instruction: "executeTransactionSyncV2",
    exportName: "executeTransactionSyncV2",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  executeSettingsTransactionSync: {
    feature: "execution",
    instruction: "executeSettingsTransactionSync",
    exportName: "executeSettingsTransactionSync",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer", "signers"],
  },
  executePolicyTransaction: {
    feature: "execution",
    instruction: "executePolicyTransaction",
    exportName: "executePolicyTransaction",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
  executePolicyPayloadSync: {
    feature: "execution",
    instruction: "executePolicyPayloadSync",
    exportName: "executePolicyPayloadSync",
    phase: "offline",
    payerRole: "feePayer",
    signerRoles: ["feePayer"],
  },
} as const satisfies Record<string, LoyalSmartAccountsOperationMetadata>;

export const OPERATION_NAMES = Object.keys(OPERATION_REGISTRY) as Array<
  keyof typeof OPERATION_REGISTRY
>;

export const FEATURE_EXPORTS_FROM_REGISTRY = Object.fromEntries(
  Object.entries(OPERATION_REGISTRY).map(([operation, metadata]) => [
    operation,
    metadata.exportName,
  ])
) as {
  [K in keyof typeof OPERATION_REGISTRY]: (typeof OPERATION_REGISTRY)[K]["exportName"];
};

export function getOperationsForFeature(feature: LoyalSmartAccountsFeature) {
  return OPERATION_NAMES.filter(
    (operation) => OPERATION_REGISTRY[operation].feature === feature
  );
}

export function findOperationCoverageIssues() {
  const missingMappings = [
    ...Object.values(featureInstructionCoverage).flat(),
    ...Object.values(extraFeatureActions).flat(),
  ].filter((instruction) => !OPERATION_NAMES.includes(instruction as never));

  const duplicateExports = Object.values(OPERATION_REGISTRY).reduce<
    Record<string, number>
  >((accumulator, metadata) => {
    const key = `${metadata.feature}:${metadata.exportName}`;
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    missingMappings,
    duplicateExports: Object.entries(duplicateExports)
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  };
}
