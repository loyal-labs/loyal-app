import {
  InvalidRoleResolutionError,
  MissingOperationConnectionError,
  MissingRequiredSignerError,
  OPERATION_NAMES,
  OPERATION_REGISTRY as CORE_OPERATION_REGISTRY,
  OperationRegistryCoverageError,
  PROGRAM_ID,
  freezePreparedOperation,
  getOperationsForFeature,
  type LoyalSmartAccountsConfirmBehavior,
  type LoyalSmartAccountsFeature,
  type LoyalSmartAccountsSendOptions,
  type LoyalSmartAccountsTransport,
  type LoyalSmartAccountsOperationMetadata,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts-core";
import * as internal from "@loyal-labs/loyal-smart-accounts-core/internal";
import { sendPreparedOperation } from "@loyal-labs/loyal-smart-accounts-core";
import type {
  AddressLookupTableAccount,
  PublicKey,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";

type PreparedInstructionResult =
  | TransactionInstruction
  | {
      instruction: TransactionInstruction;
      lookupTableAccounts?: AddressLookupTableAccount[];
    };

export const OPERATION_BUILDERS = {
  initializeProgramConfig: internal.initializeProgramConfig,
  setProgramConfigAuthority: internal.setProgramConfigAuthority,
  setProgramConfigSmartAccountCreationFee:
    internal.setProgramConfigSmartAccountCreationFee,
  setProgramConfigTreasury: internal.setProgramConfigTreasury,
  createSmartAccount: internal.createSmartAccount,
  addSignerAsAuthority: internal.addSignerAsAuthority,
  removeSignerAsAuthority: internal.removeSignerAsAuthority,
  setTimeLockAsAuthority: internal.setTimeLockAsAuthority,
  changeThresholdAsAuthority: internal.changeThresholdAsAuthority,
  setNewSettingsAuthorityAsAuthority: internal.setNewSettingsAuthorityAsAuthority,
  setArchivalAuthorityAsAuthority: internal.setArchivalAuthorityAsAuthority,
  createSettingsTransaction: internal.createSettingsTransaction,
  closeSettingsTransaction: internal.closeSettingsTransaction,
  createProposal: internal.createProposal,
  activateProposal: internal.activateProposal,
  approveProposal: internal.approveProposal,
  rejectProposal: internal.rejectProposal,
  cancelProposal: internal.cancelProposal,
  createTransaction: internal.createTransaction,
  createTransactionBuffer: internal.createTransactionBuffer,
  closeTransactionBuffer: internal.closeTransactionBuffer,
  extendTransactionBuffer: internal.extendTransactionBuffer,
  createTransactionFromBuffer: internal.createTransactionFromBuffer,
  closeTransaction: internal.closeTransaction,
  logEvent: internal.logEvent,
  createBatch: internal.createBatch,
  addTransactionToBatch: internal.addTransactionToBatch,
  closeBatchTransaction: internal.closeBatchTransaction,
  closeBatch: internal.closeBatch,
  createPolicyTransaction: internal.createPolicyTransaction,
  closeEmptyPolicyTransaction: internal.closeEmptyPolicyTransaction,
  addSpendingLimitAsAuthority: internal.addSpendingLimitAsAuthority,
  removeSpendingLimitAsAuthority: internal.removeSpendingLimitAsAuthority,
  useSpendingLimit: internal.useSpendingLimit,
  executeSettingsTransaction: internal.executeSettingsTransaction,
  executeTransaction: internal.executeTransaction,
  executeBatchTransaction: internal.executeBatchTransaction,
  executeTransactionSync: internal.executeTransactionSync,
  executeTransactionSyncV2: internal.executeTransactionSyncV2,
  executeSettingsTransactionSync: internal.executeSettingsTransactionSync,
  executePolicyTransaction: internal.executePolicyTransaction,
  executePolicyPayloadSync: internal.executePolicyPayloadSync,
} as const satisfies {
  [K in keyof typeof CORE_OPERATION_REGISTRY]: (
    args: any
  ) => PreparedInstructionResult | Promise<PreparedInstructionResult>;
};

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type OperationName = keyof typeof CORE_OPERATION_REGISTRY;
type MetadataFor<K extends OperationName> = LoyalSmartAccountsOperationMetadata &
  (typeof CORE_OPERATION_REGISTRY)[K];
type BuilderArgs<K extends OperationName> = Parameters<(typeof OPERATION_BUILDERS)[K]>[0];
type BuilderReturn<K extends OperationName> = Awaited<
  ReturnType<(typeof OPERATION_BUILDERS)[K]>
>;
type ExportNameFor<K extends OperationName> = MetadataFor<K>["exportName"];
type FeatureName = LoyalSmartAccountsFeature;
type OperationNameForFeature<F extends FeatureName> = {
  [K in OperationName]: MetadataFor<K>["feature"] extends F ? K : never;
}[OperationName];
type BoundPrepareArgs<K extends OperationName> = MetadataFor<K>["requiresConnection"] extends true
  ? Omit<BuilderArgs<K>, "connection">
  : BuilderArgs<K>;
type SignerAware<T> = T extends PublicKey
  ? PublicKey | Signer
  : T extends readonly (infer U)[]
    ? Array<SignerAware<U>>
    : T extends (infer U)[]
      ? Array<SignerAware<U>>
      : T;
type ClientArgsFor<K extends OperationName> = Simplify<
  {
    [P in keyof Omit<BuilderArgs<K>, "connection">]: P extends MetadataFor<K>["signerRoles"][number]
      ? SignerAware<Omit<BuilderArgs<K>, "connection">[P]>
      : Omit<BuilderArgs<K>, "connection">[P];
  } & {
    additionalSigners?: Signer[];
    sendOptions?: LoyalSmartAccountsSendOptions;
    confirm?: LoyalSmartAccountsConfirmBehavior;
  }
>;

type RuntimeOperationDefinition<K extends OperationName = OperationName> = {
  readonly name: K;
  readonly metadata: MetadataFor<K>;
  readonly instruction?: MetadataFor<K>["phase"] extends "offline"
    ? MetadataFor<K>["exposeInstruction"] extends false
      ? never
      : (args: BuilderArgs<K>) => TransactionInstruction
    : never;
  readonly prepare: (
    args: BuilderArgs<K>
  ) => Promise<PreparedLoyalSmartAccountsOperation<ExportNameFor<K>>>;
  readonly boundPrepare: (
    transport: LoyalSmartAccountsTransport,
    args: BoundPrepareArgs<K>
  ) => Promise<PreparedLoyalSmartAccountsOperation<ExportNameFor<K>>>;
  readonly client: (
    transport: LoyalSmartAccountsTransport,
    args: ClientArgsFor<K>
  ) => Promise<string>;
};

type RuntimeOperationsForFeature<F extends FeatureName> = {
  [K in OperationNameForFeature<F> as ExportNameFor<K>]: RuntimeOperationDefinition<K>;
};

function isSigner(value: unknown): value is Signer {
  return Boolean(
    value &&
      typeof value === "object" &&
      "publicKey" in value &&
      value.publicKey &&
      typeof (value as { publicKey?: { toBase58?: () => string } }).publicKey?.toBase58 ===
        "function"
  );
}

function isPublicKey(value: unknown): value is PublicKey {
  return value instanceof Object && value?.constructor?.name === "PublicKey";
}

function normalizePreparedInstruction(
  result: PreparedInstructionResult
): {
  instruction: TransactionInstruction;
  lookupTableAccounts: AddressLookupTableAccount[];
} {
  if ("instruction" in result) {
    return {
      instruction: result.instruction,
      lookupTableAccounts: [...(result.lookupTableAccounts ?? [])],
    };
  }

  return {
    instruction: result,
    lookupTableAccounts: [],
  };
}

function normalizeSignerValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSignerValue(entry));
  }

  if (isSigner(value)) {
    return value.publicKey;
  }

  return value;
}

function resolvePublicKey(
  operation: string,
  role: string,
  value: unknown
): PublicKey {
  if (isSigner(value)) {
    return value.publicKey;
  }

  if (isPublicKey(value)) {
    return value;
  }

  throw new InvalidRoleResolutionError(operation, role);
}

function normalizePreparedArgsFromClientArgs<K extends OperationName>(
  metadata: MetadataFor<K>,
  args: ClientArgsFor<K>,
  transport: LoyalSmartAccountsTransport
): BuilderArgs<K> {
  const next = {
    ...args,
  } as Record<string, unknown>;

  for (const [field, fallbackField] of Object.entries(
    metadata.signerFallbacks ?? {}
  )) {
    if (next[field] == null && next[fallbackField] != null) {
      next[field] = normalizeSignerValue(next[fallbackField]);
    }
  }

  for (const [field, value] of Object.entries(next)) {
    next[field] = normalizeSignerValue(value);
  }

  delete next.additionalSigners;
  delete next.sendOptions;
  delete next.confirm;

  if (metadata.requiresConnection) {
    next.connection = transport.connection;
  }

  return next as BuilderArgs<K>;
}

function collectClientSigners<K extends OperationName>(
  metadata: MetadataFor<K>,
  args: ClientArgsFor<K>
): Signer[] {
  const signers: Signer[] = [];

  for (const role of metadata.signerRoles) {
    const fallbackRole = metadata.signerFallbacks?.[role];
    const candidate =
      (args as Record<string, unknown>)[role] ??
      (fallbackRole
        ? (args as Record<string, unknown>)[fallbackRole]
        : undefined);

    if (candidate == null) {
      continue;
    }

    if (Array.isArray(candidate)) {
      const missingSigner = candidate.find((entry) => !isSigner(entry));
      if (missingSigner) {
        throw new MissingRequiredSignerError(metadata.exportName, role);
      }
      signers.push(...candidate);
      continue;
    }

    if (!isSigner(candidate)) {
      throw new MissingRequiredSignerError(metadata.exportName, role);
    }

    signers.push(candidate);
  }

  if (Array.isArray(args.additionalSigners)) {
    signers.push(...args.additionalSigners);
  }

  return signers;
}

async function prepareOperation<K extends OperationName>(
  operationName: K,
  args: BuilderArgs<K>
): Promise<PreparedLoyalSmartAccountsOperation<ExportNameFor<K>>> {
  const metadata = CORE_OPERATION_REGISTRY[operationName] as MetadataFor<K>;
  const builder = OPERATION_BUILDERS[operationName] as (
    args: BuilderArgs<K>
  ) => BuilderReturn<K>;
  if (metadata.requiresConnection && !("connection" in args && args.connection)) {
    throw new MissingOperationConnectionError(metadata.exportName);
  }

  const result = await builder(args);
  const normalized = normalizePreparedInstruction(result);

  return freezePreparedOperation({
    operation: metadata.exportName,
    payer: resolvePublicKey(
      metadata.exportName,
      metadata.payerRole,
      (args as Record<string, unknown>)[metadata.payerRole]
    ),
    programId:
      ((args as Record<string, unknown>).programId as PublicKey | undefined) ?? PROGRAM_ID,
    requiresConfirmation: metadata.requiresConfirmation ?? false,
    instructions: [normalized.instruction],
    lookupTableAccounts: normalized.lookupTableAccounts,
  });
}

function createRuntimeOperationDefinition<K extends OperationName>(
  operationName: K
): RuntimeOperationDefinition<K> {
  const metadata = CORE_OPERATION_REGISTRY[operationName] as MetadataFor<K>;
  const builder = OPERATION_BUILDERS[operationName] as (
    args: BuilderArgs<K>
  ) => BuilderReturn<K>;

  const instruction =
    metadata.phase === "offline" && metadata.exposeInstruction !== false
      ? ((args: BuilderArgs<K>) =>
          normalizePreparedInstruction(builder(args)).instruction)
      : undefined;

  return {
    name: operationName,
    metadata,
    instruction: instruction as RuntimeOperationDefinition<K>["instruction"],
    prepare: (args: BuilderArgs<K>) => prepareOperation(operationName, args),
    boundPrepare: (transport: LoyalSmartAccountsTransport, args: BoundPrepareArgs<K>) =>
      prepareOperation(operationName, {
        ...(args as Record<string, unknown>),
        ...(metadata.requiresConnection ? { connection: transport.connection } : {}),
      } as BuilderArgs<K>),
    client: async (
      transport: LoyalSmartAccountsTransport,
      args: ClientArgsFor<K>
    ) => {
      const prepared = await prepareOperation(
        operationName,
        normalizePreparedArgsFromClientArgs(metadata, args, transport)
      );

      return sendPreparedOperation({
        transport,
        prepared,
        signers: collectClientSigners(metadata, args),
        sendOptions: args.sendOptions,
        confirm: args.confirm,
      });
    },
  };
}

export function findRuntimeBindingIssues() {
  const coreOperationNames = new Set<string>(OPERATION_NAMES);
  const builderNames = new Set<string>(Object.keys(OPERATION_BUILDERS));

  const missingBuilders = OPERATION_NAMES.filter((name) => !builderNames.has(name));
  const extraBuilders = Object.keys(OPERATION_BUILDERS).filter(
    (name) => !coreOperationNames.has(name)
  );

  return {
    missingBuilders,
    extraBuilders,
  };
}

export function assertRuntimeBindingCoverage(): void {
  const issues = findRuntimeBindingIssues();
  if (issues.missingBuilders.length === 0 && issues.extraBuilders.length === 0) {
    return;
  }

  throw new OperationRegistryCoverageError(
    `Runtime operation binding coverage failed: missing=[${issues.missingBuilders.join(
      ", "
    )}] extra=[${issues.extraBuilders.join(", ")}]`
  );
}

export function getRuntimeOperationsForFeature<F extends FeatureName>(
  feature: F
): RuntimeOperationsForFeature<F> {
  assertRuntimeBindingCoverage();

  return Object.fromEntries(
    getOperationsForFeature(feature).map((operationName) => {
      const metadata = CORE_OPERATION_REGISTRY[operationName];
      return [metadata.exportName, createRuntimeOperationDefinition(operationName)];
    })
  ) as RuntimeOperationsForFeature<F>;
}

export type {
  BoundPrepareArgs,
  ClientArgsFor,
  FeatureName as LoyalSmartAccountsFeatureName,
  RuntimeOperationDefinition,
  RuntimeOperationsForFeature,
};
