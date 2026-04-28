import bs58 from "bs58";
import BN from "bn.js";
import {
  createLoyalSmartAccountsClient,
  generated,
  pda,
  type LoyalSmartAccountsClient,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  Policy,
  Permission,
  Permissions,
  Proposal,
  SettingsTransaction,
  Transaction,
  freezePreparedOperation,
  policyDiscriminator,
  proposalDiscriminator,
  settingsTransactionDiscriminator,
  toBigInt,
  transactionDiscriminator,
  transactionMessageToMultisigTransactionMessageBytes,
  type SettingsAction,
  type SmartAccountSigner,
} from "@loyal-labs/loyal-smart-accounts-core";
import {
  NATIVE_SOL_MINT,
  type PortfolioPosition,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { decodeTransferCheckedInstruction } from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  SystemInstruction,
  type AccountMeta,
  type AccountInfo,
  type AddressLookupTableAccount,
  type Connection,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";
import {
  createVaultCustomInstructionMessage,
  createVaultSolTransferMessage,
  createVaultSplTransferMessage,
  isSupportedTokenProgram,
  resolveVaultAccountIndex,
} from "./messages";
import type {
  SmartAccountOverview,
  SmartAccountCustomInstructionProposalInput,
  SmartAccountPolicySnapshot,
  SmartAccountPolicyCustomInstructionProposalInput,
  SmartAccountPreparedSettingsChange,
  SmartAccountProposalPayloadType,
  SmartAccountProposalSnapshot,
  SmartAccountProposalStatus,
  SmartAccountRemoveSpendingLimitProposalInput,
  SmartAccountSetSpendingLimitProposalInput,
  SmartAccountSignerPermission,
  SmartAccountSignerSnapshot,
  SmartAccountSpendingLimitSnapshot,
  SmartAccountProposalSummary,
  SmartAccountTokenTransferProposalInput,
  SmartAccountTransferProposalInput,
  SmartAccountUseSpendingLimitInput,
  SmartAccountVaultSnapshot,
  SmartAccountVaultsClientConfig,
} from "./types";
import {
  SOL_SPENDING_LIMIT_MINT,
  formatTokenAmount,
  getEffectiveSpendingLimitRemainingAmount,
  getSpendingLimitNextReset,
  toSpendingLimitPeriodLabel,
  tokenAmountToNumber,
  type SmartAccountSpendingLimitPeriod,
} from "./spending-limits";

type VaultMessage = {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: PublicKey[];
  instructions: Array<{
    programIdIndex: number;
    accountIndexes: Uint8Array;
    data: Uint8Array;
  }>;
};

type TransactionPayloadDetailsLike = {
  accountIndex: number;
  message: VaultMessage;
};

type TransactionPayloadLike = Transaction["payload"] & {
  __kind: "TransactionPayload";
  fields: [TransactionPayloadDetailsLike];
};

function dedupeLookupTableAccounts(
  lookupTableAccounts: readonly AddressLookupTableAccount[]
) {
  const unique = new Map<string, AddressLookupTableAccount>();

  for (const account of lookupTableAccounts) {
    unique.set(account.key.toBase58(), account);
  }

  return [...unique.values()];
}

function mergePreparedOperations(args: {
  operation: string;
  payer: PublicKey;
  programId: PublicKey;
  operations: ReadonlyArray<PreparedLoyalSmartAccountsOperation<string>>;
}): PreparedLoyalSmartAccountsOperation<string> {
  return freezePreparedOperation({
    operation: args.operation,
    payer: args.payer,
    programId: args.programId,
    requiresConfirmation: args.operations.some(
      (operation) => operation.requiresConfirmation
    ),
    instructions: args.operations.flatMap(
      (operation) => operation.instructions
    ),
    lookupTableAccounts: dedupeLookupTableAccounts(
      args.operations.flatMap(
        (operation) => operation.lookupTableAccounts ?? []
      )
    ),
  });
}

function toProposalStatus(statusKind: string): SmartAccountProposalStatus {
  switch (statusKind.toLowerCase()) {
    case "draft":
      return "draft";
    case "active":
      return "active";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "executing":
      return "executing";
    case "executed":
      return "executed";
    case "cancelled":
      return "cancelled";
    default:
      return "active";
  }
}

function getWritableFlags(
  message: VaultMessage,
  accountIndex: number
): boolean {
  if (accountIndex < message.numWritableSigners) {
    return true;
  }

  if (accountIndex < message.numSigners) {
    return false;
  }

  return accountIndex - message.numSigners < message.numWritableNonSigners;
}

function compileVaultInstructions(message: VaultMessage) {
  return message.instructions.map((instruction) => {
    const programId = message.accountKeys[instruction.programIdIndex];
    const keys = Array.from(instruction.accountIndexes).map(
      (accountIndex: number) => ({
        pubkey: message.accountKeys[accountIndex],
        isSigner: accountIndex < message.numSigners,
        isWritable: getWritableFlags(message, accountIndex),
      })
    );

    return {
      programId,
      keys,
      data: Buffer.from(instruction.data),
    };
  });
}

function formatProposalTokenAmount(amountRaw: bigint, decimals: number): string {
  if (decimals === 0) {
    return amountRaw.toString();
  }

  const base = BigInt(10) ** BigInt(decimals);
  const whole = amountRaw / base;
  const fraction = amountRaw % base;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  const paddedFraction = fraction.toString().padStart(decimals, "0");
  return `${whole.toString()}.${paddedFraction.replace(/0+$/, "")}`;
}

function findAssetMetadata(
  assetIndex: Map<string, PortfolioPosition>,
  mint: string | null
) {
  if (!mint) {
    return null;
  }

  return assetIndex.get(mint) ?? null;
}

function summarizeUnknownInstruction(args: {
  programId: PublicKey | null;
  instructionCount: number;
}): SmartAccountProposalSummary {
  return {
    kind: "unknown",
    title: "Transaction",
    subtitle: args.programId
      ? `Program ${args.programId.toBase58()}`
      : "Unknown instruction payload",
    symbol: null,
    amountUi: null,
    amountRaw: null,
    mint: null,
    decimals: null,
    destination: null,
    programId: args.programId?.toBase58() ?? null,
    instructionCount: args.instructionCount,
  };
}

function summarizeSolTransferInstruction(args: {
  instruction: ReturnType<typeof compileVaultInstructions>[number];
  instructionCount: number;
}): SmartAccountProposalSummary | null {
  try {
    const decoded = SystemInstruction.decodeTransfer({
      programId: args.instruction.programId,
      keys: args.instruction.keys,
      data: args.instruction.data,
    });

    return {
      kind: "sol_transfer",
      title: "Send",
      subtitle: `to ${decoded.toPubkey.toBase58()}`,
      symbol: "SOL",
      amountUi: formatProposalTokenAmount(BigInt(decoded.lamports), 9),
      amountRaw: BigInt(decoded.lamports).toString(),
      mint: null,
      decimals: 9,
      destination: decoded.toPubkey.toBase58(),
      programId: args.instruction.programId.toBase58(),
      instructionCount: args.instructionCount,
    };
  } catch {
    return null;
  }
}

function summarizeSplTransferInstruction(args: {
  instruction: ReturnType<typeof compileVaultInstructions>[number];
  instructionCount: number;
  assetIndex: Map<string, PortfolioPosition>;
}): SmartAccountProposalSummary | null {
  try {
    const decoded = decodeTransferCheckedInstruction(
      {
        programId: args.instruction.programId,
        keys: args.instruction.keys,
        data: args.instruction.data,
      },
      args.instruction.programId
    );
    const mint = decoded.keys.mint.pubkey.toBase58();
    const asset = findAssetMetadata(args.assetIndex, mint);

    return {
      kind: "spl_transfer",
      title: "Send",
      subtitle: `to ${decoded.keys.destination.pubkey.toBase58()}`,
      symbol: asset?.asset.symbol ?? null,
      amountUi: formatProposalTokenAmount(
        BigInt(decoded.data.amount.toString()),
        decoded.data.decimals
      ),
      amountRaw: decoded.data.amount.toString(),
      mint,
      decimals: decoded.data.decimals,
      destination: decoded.keys.destination.pubkey.toBase58(),
      programId: args.instruction.programId.toBase58(),
      instructionCount: args.instructionCount,
    };
  } catch {
    return null;
  }
}

function summarizeSettingsTransaction(
  settingsTransaction: SettingsTransaction
): SmartAccountProposalSummary {
  const actionKinds = settingsTransaction.actions.map(
    (action) => action.__kind
  );
  const title =
    actionKinds.length === 1
      ? actionKinds[0].replace(/([a-z])([A-Z])/g, "$1 $2")
      : "Settings changes";

  return {
    kind: "settings_change",
    title,
    subtitle:
      actionKinds.length === 0 ? "No settings actions" : actionKinds.join(", "),
    symbol: null,
    amountUi: null,
    amountRaw: null,
    mint: null,
    decimals: null,
    destination: null,
    programId: null,
    instructionCount: actionKinds.length,
  };
}

function summarizeTransactionPayload(args: {
  payload: Transaction["payload"];
  assetIndex: Map<string, PortfolioPosition>;
}): {
  summary: SmartAccountProposalSummary;
  accountIndex: number | null;
} {
  if (args.payload.__kind !== "TransactionPayload") {
    return {
      accountIndex: null,
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  const details = (args.payload as TransactionPayloadLike).fields[0];
  const instructions = compileVaultInstructions(details.message);

  for (const instruction of instructions) {
    if (instruction.programId.equals(SystemProgram.programId)) {
      const summary = summarizeSolTransferInstruction({
        instruction,
        instructionCount: instructions.length,
      });

      if (summary) {
        return {
          accountIndex: details.accountIndex,
          summary,
        };
      }
    }

    if (isSupportedTokenProgram(instruction.programId)) {
      const summary = summarizeSplTransferInstruction({
        instruction,
        instructionCount: instructions.length,
        assetIndex: args.assetIndex,
      });

      if (summary) {
        return {
          accountIndex: details.accountIndex,
          summary,
        };
      }
    }
  }

  const firstInstruction = instructions[0] ?? null;

  if (!firstInstruction) {
    return {
      accountIndex: details.accountIndex,
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  return {
    accountIndex: details.accountIndex,
    summary: summarizeUnknownInstruction({
      programId: firstInstruction.programId,
      instructionCount: instructions.length,
    }),
  };
}

function createProposalFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(proposalDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function createTransactionFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(transactionDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function createSettingsTransactionFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(settingsTransactionDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function createPolicyFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(policyDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function deserializeProposalAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [proposal] = Proposal.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    proposal,
  };
}

function deserializePolicyAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [policy] = Policy.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    policy,
  };
}

function toSignerPermissions(
  permissions: SmartAccountSigner["permissions"]
): SmartAccountSignerPermission[] {
  const nextPermissions: SmartAccountSignerPermission[] = [];

  if (Permissions.has(permissions, Permission.Initiate)) {
    nextPermissions.push("initiate");
  }

  if (Permissions.has(permissions, Permission.Vote)) {
    nextPermissions.push("vote");
  }

  if (Permissions.has(permissions, Permission.Execute)) {
    nextPermissions.push("execute");
  }

  return nextPermissions;
}

function toSignerSnapshot(args: {
  signer: SmartAccountSigner;
  scope: SmartAccountSignerSnapshot["scope"];
  consensusPda: PublicKey;
  threshold: number;
  timeLock: number;
  policyPda?: PublicKey | null;
  policySeed?: string | null;
}): SmartAccountSignerSnapshot {
  const permissions = toSignerPermissions(args.signer.permissions);

  return {
    address: args.signer.key.toBase58(),
    scope: args.scope,
    consensusAddress: args.consensusPda.toBase58(),
    permissions,
    permissionMask: args.signer.permissions.mask,
    canInitiate: permissions.includes("initiate"),
    canVote: permissions.includes("vote"),
    canExecute: permissions.includes("execute"),
    threshold: args.threshold,
    timeLock: args.timeLock,
    policyAddress: args.policyPda?.toBase58() ?? null,
    policySeed: args.policySeed ?? null,
  };
}

function deserializeTransactionAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [transaction] = Transaction.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    transaction,
  };
}

function deserializeSettingsTransactionAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [settingsTransaction] = SettingsTransaction.fromAccountInfo(
    args.account
  );
  return {
    address: args.pubkey,
    settingsTransaction,
  };
}

function toAssetIndex(vaults: readonly SmartAccountVaultSnapshot[]) {
  const index = new Map<string, PortfolioPosition>();

  for (const vault of vaults) {
    for (const position of vault.portfolio.positions) {
      index.set(position.asset.mint, position);
    }
  }

  return index;
}

function requireWalletDataClient(
  walletDataClient: SolanaWalletDataClient | undefined
): SolanaWalletDataClient {
  if (!walletDataClient) {
    throw new Error(
      "A SolanaWalletDataClient is required for vault portfolio and activity queries."
    );
  }

  return walletDataClient;
}

function toConsensusTransactionKey(args: {
  consensusPda: PublicKey;
  transactionIndex: string;
}) {
  return `${args.consensusPda.toBase58()}:${args.transactionIndex}`;
}

function dedupePublicKeys(keys: readonly PublicKey[]): PublicKey[] {
  const unique = new Map<string, PublicKey>();

  for (const key of keys) {
    unique.set(key.toBase58(), key);
  }

  return [...unique.values()];
}

function toWritableAccountMetas(keys: readonly PublicKey[]): AccountMeta[] {
  return keys.map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));
}

function toGeneratedPolicyPeriod(
  period: SmartAccountSpendingLimitPeriod
): generated.PeriodV2 {
  switch (period) {
    case "one_time":
      return { __kind: "OneTime" };
    case "day":
      return { __kind: "Daily" };
    case "week":
      return { __kind: "Weekly" };
    case "month":
      return { __kind: "Monthly" };
    case "custom":
      throw new Error("Custom spending-limit periods require a duration.");
  }
}

function toSpendingLimitPolicyPeriod(
  period: generated.PeriodV2
): {
  period: SmartAccountSpendingLimitPeriod;
  periodSeconds: number | null;
} {
  const daySeconds = 24 * 60 * 60;

  switch (period.__kind) {
    case "OneTime":
      return { period: "one_time", periodSeconds: null };
    case "Daily":
      return { period: "day", periodSeconds: daySeconds };
    case "Weekly":
      return { period: "week", periodSeconds: 7 * daySeconds };
    case "Monthly":
      return { period: "month", periodSeconds: 30 * daySeconds };
    case "Custom": {
      const seconds = Number(toBigInt(period.fields[0]));

      if (seconds === daySeconds) {
        return { period: "day", periodSeconds: seconds };
      }

      if (seconds === 7 * daySeconds) {
        return { period: "week", periodSeconds: seconds };
      }

      if (seconds === 30 * daySeconds) {
        return { period: "month", periodSeconds: seconds };
      }

      return {
        period: "custom",
        periodSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      };
    }
  }
}

function toBn(value: bigint): BN {
  return new BN(value.toString());
}

function toNullableExpiration(expiration: bigint): number | null {
  const maxI64 = BigInt("9223372036854775807");

  if (expiration >= maxI64) {
    return null;
  }

  const value = Number(expiration);
  return Number.isFinite(value) ? value : null;
}

function resolveSpendingLimitAsset(args: {
  mint: string;
  assetIndex: Map<string, PortfolioPosition>;
}) {
  if (args.mint === SOL_SPENDING_LIMIT_MINT) {
    const nativeSolPosition =
      args.assetIndex.get(SOL_SPENDING_LIMIT_MINT) ??
      args.assetIndex.get(NATIVE_SOL_MINT);

    return {
      decimals: 9,
      priceUsd: nativeSolPosition?.priceUsd ?? null,
      symbol: "SOL",
    };
  }

  const position = args.assetIndex.get(args.mint);

  return {
    decimals: position?.asset.decimals ?? 0,
    priceUsd: position?.priceUsd ?? null,
    symbol: position?.asset.symbol ?? "TOKEN",
  };
}

function toUsdValue(args: {
  amountRaw: bigint;
  decimals: number;
  priceUsd: number | null;
}): number | null {
  const amount = tokenAmountToNumber(args.amountRaw, args.decimals);

  if (
    amount === null ||
    typeof args.priceUsd !== "number" ||
    !Number.isFinite(args.priceUsd)
  ) {
    return null;
  }

  return amount * args.priceUsd;
}

function toNullableTimestamp(
  timestamp: Parameters<typeof toBigInt>[0] | null
): number | null {
  if (timestamp == null) {
    return null;
  }

  const value = Number(toBigInt(timestamp));
  return Number.isFinite(value) ? value : null;
}

function resolveNextPolicySeed(settings: {
  policySeed: Parameters<typeof toBigInt>[0] | null;
}) {
  const currentPolicySeed =
    settings.policySeed == null ? BigInt(0) : toBigInt(settings.policySeed);
  const nextPolicySeed = currentPolicySeed + BigInt(1);

  if (nextPolicySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Policy seed is too large for this client.");
  }

  return {
    bigint: nextPolicySeed,
    number: Number(nextPolicySeed),
  };
}

function createPolicySigner(signer: PublicKey): SmartAccountSigner {
  return {
    key: signer,
    permissions: {
      mask: Permission.Initiate | Permission.Vote | Permission.Execute,
    },
  };
}

type SpendingLimitPolicyCreationPayload = Extract<
  generated.PolicyCreationPayload,
  { __kind: "SpendingLimit" }
>["fields"][0];

function toPolicyExpiration(
  expiration: number | null | undefined,
  fallback: SpendingLimitPolicyCreationPayload["timeConstraints"]["expiration"]
): SpendingLimitPolicyCreationPayload["timeConstraints"]["expiration"] {
  if (expiration === undefined) {
    return fallback;
  }

  return expiration === null ? null : new BN(expiration.toString());
}

function resolveUpdatedMaxPerUse(args: {
  amount: bigint;
  base?: SpendingLimitPolicyCreationPayload;
}): SpendingLimitPolicyCreationPayload["quantityConstraints"]["maxPerUse"] {
  if (!args.base) {
    return toBn(args.amount);
  }

  const existingMaxPerPeriod = toBigInt(
    args.base.quantityConstraints.maxPerPeriod
  );
  const existingMaxPerUse = toBigInt(args.base.quantityConstraints.maxPerUse);

  if (
    existingMaxPerUse === existingMaxPerPeriod ||
    existingMaxPerUse > args.amount
  ) {
    return toBn(args.amount);
  }

  return args.base.quantityConstraints.maxPerUse;
}

function resolveUpdatedUsageState(args: {
  amount: bigint;
  base?: SpendingLimitPolicyCreationPayload;
}): SpendingLimitPolicyCreationPayload["usageState"] {
  if (!args.base?.usageState) {
    return null;
  }

  const existingRemaining = toBigInt(args.base.usageState.remainingInPeriod);

  return {
    lastReset: args.base.usageState.lastReset,
    remainingInPeriod:
      existingRemaining > args.amount
        ? toBn(args.amount)
        : args.base.usageState.remainingInPeriod,
  };
}

function createSpendingLimitPolicyCreationPayload(args: {
  accountIndex?: number;
  amount: bigint;
  base?: SpendingLimitPolicyCreationPayload;
  destinations?: PublicKey[];
  expiration?: number | null;
  mint?: PublicKey;
  period?: SmartAccountSpendingLimitPeriod;
}): generated.PolicyCreationPayload {
  const period =
    args.period === undefined
      ? args.base?.timeConstraints.period ?? toGeneratedPolicyPeriod("month")
      : toGeneratedPolicyPeriod(args.period);

  return {
    __kind: "SpendingLimit",
    fields: [
      {
        mint: args.mint ?? args.base?.mint ?? PublicKey.default,
        sourceAccountIndex:
          args.accountIndex ?? args.base?.sourceAccountIndex ?? 0,
        destinations: args.destinations ?? args.base?.destinations ?? [],
        timeConstraints: {
          start: args.base?.timeConstraints.start ?? 0,
          expiration: toPolicyExpiration(
            args.expiration,
            args.base?.timeConstraints.expiration ?? null
          ),
          period,
          accumulateUnused: args.base?.timeConstraints.accumulateUnused ?? false,
        },
        quantityConstraints: {
          maxPerPeriod: toBn(args.amount),
          maxPerUse: resolveUpdatedMaxPerUse({
            amount: args.amount,
            base: args.base,
          }),
          enforceExactQuantity:
            args.base?.quantityConstraints.enforceExactQuantity ?? false,
        },
        usageState: resolveUpdatedUsageState({
          amount: args.amount,
          base: args.base,
        }),
      },
    ],
  };
}

function toSpendingLimitPolicyCreationBase(
  policy: Policy
): SpendingLimitPolicyCreationPayload {
  if (policy.policyState.__kind !== "SpendingLimit") {
    throw new Error("Existing policy is not a spending-limit policy.");
  }

  const spendingLimitPolicy = policy.policyState.fields[0];
  const spendingLimit = spendingLimitPolicy.spendingLimit;

  return {
    mint: spendingLimit.mint,
    sourceAccountIndex: spendingLimitPolicy.sourceAccountIndex,
    destinations: spendingLimitPolicy.destinations,
    timeConstraints: spendingLimit.timeConstraints,
    quantityConstraints: spendingLimit.quantityConstraints,
    usageState: spendingLimit.usage,
  };
}

function toSpendingLimitPolicySnapshot(args: {
  address: PublicKey;
  assetIndex: Map<string, PortfolioPosition>;
  now: number;
  policy: Policy;
}): SmartAccountSpendingLimitSnapshot | null {
  if (args.policy.policyState.__kind !== "SpendingLimit") {
    return null;
  }

  const spendingLimitPolicy = args.policy.policyState.fields[0];
  const spendingLimit = spendingLimitPolicy.spendingLimit;
  const amount = toBigInt(spendingLimit.quantityConstraints.maxPerPeriod);
  const maxPerUse = toBigInt(spendingLimit.quantityConstraints.maxPerUse);
  const remainingAmount = toBigInt(spendingLimit.usage.remainingInPeriod);
  const lastReset = Number(toBigInt(spendingLimit.usage.lastReset));
  const expiration = toNullableTimestamp(
    spendingLimit.timeConstraints.expiration
  );
  const periodDetails = toSpendingLimitPolicyPeriod(
    spendingLimit.timeConstraints.period
  );
  const effectiveRemainingAmount =
    getEffectiveSpendingLimitRemainingAmount({
      accumulateUnused: spendingLimit.timeConstraints.accumulateUnused,
      amount,
      lastReset,
      now: args.now,
      period: periodDetails.period,
      periodSeconds: periodDetails.periodSeconds,
      remainingAmount,
    });
  const mint = spendingLimit.mint.toBase58();
  const asset = resolveSpendingLimitAsset({
    mint,
    assetIndex: args.assetIndex,
  });

  return {
    address: args.address.toBase58(),
    settingsPda: args.policy.settings.toBase58(),
    seed: toBigInt(args.policy.seed).toString(),
    accountIndex: spendingLimitPolicy.sourceAccountIndex,
    mint,
    symbol: asset.symbol,
    decimals: asset.decimals,
    amountRaw: amount.toString(),
    remainingAmountRaw: remainingAmount.toString(),
    effectiveRemainingAmountRaw: effectiveRemainingAmount.toString(),
    maxPerUseRaw: maxPerUse.toString(),
    amountUi: formatTokenAmount(amount, asset.decimals),
    remainingAmountUi: formatTokenAmount(
      effectiveRemainingAmount,
      asset.decimals
    ),
    amountUsd: toUsdValue({
      amountRaw: amount,
      decimals: asset.decimals,
      priceUsd: asset.priceUsd,
    }),
    remainingAmountUsd: toUsdValue({
      amountRaw: effectiveRemainingAmount,
      decimals: asset.decimals,
      priceUsd: asset.priceUsd,
    }),
    period: periodDetails.period,
    periodSeconds: periodDetails.periodSeconds,
    periodLabel: toSpendingLimitPeriodLabel(
      periodDetails.period,
      periodDetails.periodSeconds
    ),
    accumulateUnused: spendingLimit.timeConstraints.accumulateUnused,
    lastReset,
    nextReset: getSpendingLimitNextReset({
      lastReset,
      now: args.now,
      period: periodDetails.period,
      periodSeconds: periodDetails.periodSeconds,
    }),
    expiration,
    isExpired: expiration !== null && expiration <= args.now,
    signers: args.policy.signers.map((signer) => signer.key.toBase58()),
    destinations: spendingLimitPolicy.destinations.map((destination) =>
      destination.toBase58()
    ),
  };
}

function getSettingsTransactionExecutionAccounts(args: {
  settingsPda: PublicKey;
  settingsTransaction: SettingsTransaction;
  programId: PublicKey;
}): {
  spendingLimits: PublicKey[];
  policies: PublicKey[];
} {
  const spendingLimits: PublicKey[] = [];
  const policies: PublicKey[] = [];

  for (const action of args.settingsTransaction.actions) {
    switch (action.__kind) {
      case "AddSpendingLimit":
        spendingLimits.push(
          pda.getSpendingLimitPda({
            programId: args.programId,
            settingsPda: args.settingsPda,
            seed: action.seed,
          })[0]
        );
        break;
      case "RemoveSpendingLimit":
        spendingLimits.push(action.spendingLimit);
        break;
      case "PolicyCreate":
        policies.push(
          pda.getPolicyPda({
            programId: args.programId,
            settingsPda: args.settingsPda,
            policySeed: toBigInt(action.seed) as unknown as number,
          })[0]
        );
        break;
      case "PolicyUpdate":
      case "PolicyRemove":
        policies.push(action.policy);
        break;
    }
  }

  return {
    spendingLimits: dedupePublicKeys(spendingLimits),
    policies: dedupePublicKeys(policies),
  };
}

export type SmartAccountVaultsClient = ReturnType<
  typeof createSmartAccountVaultsClient
>;

export function createSmartAccountVaultsClient(
  config: SmartAccountVaultsClientConfig
) {
  const smartAccountsClient: LoyalSmartAccountsClient =
    createLoyalSmartAccountsClient({
      connection: config.connection,
      programId: config.programId,
      defaultCommitment: "confirmed",
    });
  const walletDataClient = config.walletDataClient;

  async function fetchVault(args: {
    settingsPda: PublicKey;
    accountIndex?: number;
    activityLimit?: number;
  }): Promise<SmartAccountVaultSnapshot> {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const vaultAddress = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const dataClient = requireWalletDataClient(walletDataClient);
    const [lamports, portfolio, activity] = await Promise.all([
      config.connection.getBalance(vaultAddress, "confirmed"),
      dataClient.getPortfolio(vaultAddress),
      dataClient.getActivity(vaultAddress, {
        limit: args.activityLimit ?? 25,
      }),
    ]);

    return {
      accountIndex,
      address: vaultAddress.toBase58(),
      lamports,
      portfolio,
      activity,
      signers: [],
      spendingLimits: [],
    };
  }

  async function listVaults(args: {
    settingsPda: PublicKey;
    accountUtilization?: number;
    activityLimit?: number;
  }): Promise<SmartAccountVaultSnapshot[]> {
    const settings =
      args.accountUtilization === undefined
        ? await smartAccountsClient.smartAccounts.queries.fetchSettings(
            args.settingsPda
          )
        : null;
    const highestAccountIndex =
      args.accountUtilization ?? settings?.accountUtilization ?? 0;
    const accountIndexes = Array.from(
      { length: Math.max(highestAccountIndex + 1, 1) },
      (_, index) => index
    );

    return Promise.all(
      accountIndexes.map((accountIndex) =>
        fetchVault({
          settingsPda: args.settingsPda,
          accountIndex,
          activityLimit: args.activityLimit,
        })
      )
    );
  }

  async function listPolicies(args: {
    settingsPda: PublicKey;
  }): Promise<SmartAccountPolicySnapshot[]> {
    const policyAccounts = await config.connection.getProgramAccounts(
      smartAccountsClient.programId,
      {
        commitment: "confirmed",
        filters: createPolicyFilters(args.settingsPda),
      }
    );

    return policyAccounts
      .map((account) => deserializePolicyAccount(account))
      .map((entry) => {
        const seed = toBigInt(entry.policy.seed).toString();
        const signers = entry.policy.signers.map((signer) =>
          toSignerSnapshot({
            signer,
            scope: "policy",
            consensusPda: entry.address,
            threshold: entry.policy.threshold,
            timeLock: entry.policy.timeLock,
            policyPda: entry.address,
            policySeed: seed,
          })
        );
        const policyState =
          (entry.policy.policyState as { __kind?: string }).__kind ?? "unknown";

        return {
          address: entry.address.toBase58(),
          settingsPda: entry.policy.settings.toBase58(),
          seed,
          threshold: entry.policy.threshold,
          timeLock: entry.policy.timeLock,
          transactionIndex: toBigInt(entry.policy.transactionIndex).toString(),
          staleTransactionIndex: toBigInt(
            entry.policy.staleTransactionIndex
          ).toString(),
          state: policyState,
          signers,
        } satisfies SmartAccountPolicySnapshot;
      })
      .sort((left, right) => (BigInt(left.seed) > BigInt(right.seed) ? 1 : -1));
  }

  async function listSpendingLimitPolicies(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    now?: number;
  }): Promise<SmartAccountSpendingLimitSnapshot[]> {
    const policyAccounts = await config.connection.getProgramAccounts(
      smartAccountsClient.programId,
      {
        commitment: "confirmed",
        filters: createPolicyFilters(args.settingsPda),
      }
    );
    const assetIndex = args.assetIndex ?? new Map<string, PortfolioPosition>();
    const now = args.now ?? Math.floor(Date.now() / 1000);

    return policyAccounts
      .map((account) => deserializePolicyAccount(account))
      .map((entry) =>
        toSpendingLimitPolicySnapshot({
          address: entry.address,
          assetIndex,
          now,
          policy: entry.policy,
        })
      )
      .filter((entry): entry is SmartAccountSpendingLimitSnapshot => entry !== null)
      .sort((left, right) => left.address.localeCompare(right.address));
  }

  async function listProposals(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    policies?: SmartAccountPolicySnapshot[];
  }): Promise<SmartAccountProposalSnapshot[]> {
    const policies = args.policies ?? (await listPolicies(args));
    const policyConsensusPdas = policies.map(
      (policy) => new PublicKey(policy.address)
    );
    const consensusPdas = dedupePublicKeys([
      args.settingsPda,
      ...policyConsensusPdas,
    ]);
    const [
      proposalAccountGroups,
      transactionAccountGroups,
      settingsTransactionAccounts,
    ] = await Promise.all([
      Promise.all(
        consensusPdas.map((consensusPda) =>
          config.connection.getProgramAccounts(smartAccountsClient.programId, {
            commitment: "confirmed",
            filters: createProposalFilters(consensusPda),
          })
        )
      ),
      Promise.all(
        consensusPdas.map((consensusPda) =>
          config.connection.getProgramAccounts(smartAccountsClient.programId, {
            commitment: "confirmed",
            filters: createTransactionFilters(consensusPda),
          })
        )
      ),
      config.connection.getProgramAccounts(smartAccountsClient.programId, {
        commitment: "confirmed",
        filters: createSettingsTransactionFilters(args.settingsPda),
      }),
    ]);
    const proposalAccounts = proposalAccountGroups.flat();
    const transactionAccounts = transactionAccountGroups.flat();
    const transactionsByKey = new Map(
      transactionAccounts.map((account) => {
        const deserialized = deserializeTransactionAccount(account);
        const transactionIndex = toBigInt(
          deserialized.transaction.index
        ).toString();
        return [
          toConsensusTransactionKey({
            consensusPda: deserialized.transaction.consensusAccount,
            transactionIndex,
          }),
          deserialized,
        ];
      })
    );
    const settingsTransactionsByKey = new Map(
      settingsTransactionAccounts.map((account) => {
        const deserialized = deserializeSettingsTransactionAccount(account);
        const transactionIndex = toBigInt(
          deserialized.settingsTransaction.index
        ).toString();
        return [
          toConsensusTransactionKey({
            consensusPda: deserialized.settingsTransaction.settings,
            transactionIndex,
          }),
          deserialized,
        ];
      })
    );
    const assetIndex = args.assetIndex ?? new Map<string, PortfolioPosition>();

    return proposalAccounts
      .map((account) => deserializeProposalAccount(account))
      .map((entry) => {
        const transactionIndex = toBigInt(
          entry.proposal.transactionIndex
        ).toString();
        const consensusPda = entry.proposal.settings;
        const transactionKey = toConsensusTransactionKey({
          consensusPda,
          transactionIndex,
        });
        const transaction = transactionsByKey.get(transactionKey) ?? null;
        const settingsTransaction =
          settingsTransactionsByKey.get(transactionKey) ?? null;
        let payloadType: SmartAccountProposalPayloadType = "unknown";
        let transactionAddress: string | null = null;
        let creator: string | null = null;
        let payloadSummary: {
          summary: SmartAccountProposalSummary;
          accountIndex: number | null;
        } = {
          accountIndex: null,
          summary: summarizeUnknownInstruction({
            programId: null,
            instructionCount: 0,
          }),
        };

        if (transaction) {
          payloadType =
            transaction.transaction.payload.__kind === "PolicyPayload"
              ? "policy_transaction"
              : "transaction";
          transactionAddress = transaction.address.toBase58();
          creator = transaction.transaction.creator.toBase58();
          payloadSummary = summarizeTransactionPayload({
            payload: transaction.transaction.payload,
            assetIndex,
          });
        } else if (settingsTransaction) {
          payloadType = "settings_transaction";
          transactionAddress = settingsTransaction.address.toBase58();
          creator = settingsTransaction.settingsTransaction.creator.toBase58();
          payloadSummary = {
            accountIndex: null,
            summary: summarizeSettingsTransaction(
              settingsTransaction.settingsTransaction
            ),
          };
        }

        return {
          proposalAddress: entry.address.toBase58(),
          transactionAddress,
          consensusAddress: consensusPda.toBase58(),
          transactionIndex,
          payloadType,
          status: toProposalStatus(entry.proposal.status.__kind),
          approvals: entry.proposal.approved.map((address) =>
            address.toBase58()
          ),
          rejections: entry.proposal.rejected.map((address) =>
            address.toBase58()
          ),
          cancellations: entry.proposal.cancelled.map((address) =>
            address.toBase58()
          ),
          creator,
          accountIndex: payloadSummary.accountIndex,
          summary: payloadSummary.summary,
        } satisfies SmartAccountProposalSnapshot;
      })
      .sort((left, right) =>
        BigInt(right.transactionIndex) > BigInt(left.transactionIndex) ? 1 : -1
      );
  }

  async function fetchOverview(args: {
    settingsPda: PublicKey;
    activityLimit?: number;
  }): Promise<SmartAccountOverview> {
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const vaults = await listVaults({
      settingsPda: args.settingsPda,
      accountUtilization: settings.accountUtilization,
      activityLimit: args.activityLimit,
    });
    const policies = await listPolicies({
      settingsPda: args.settingsPda,
    });
    const assetIndex = toAssetIndex(vaults);
    const spendingLimits = await listSpendingLimitPolicies({
      settingsPda: args.settingsPda,
      assetIndex,
    });
    const signers = settings.signers.map((signer) =>
      toSignerSnapshot({
        signer,
        scope: "settings",
        consensusPda: args.settingsPda,
        threshold: settings.threshold,
        timeLock: settings.timeLock,
      })
    );
    const vaultSigners = [
      ...signers,
      ...policies.flatMap((policy) => policy.signers),
    ];
    const vaultsWithSigners = vaults.map((vault) => ({
      ...vault,
      signers: vaultSigners,
      spendingLimits: spendingLimits.filter(
        (spendingLimit) => spendingLimit.accountIndex === vault.accountIndex
      ),
    }));
    const proposals = await listProposals({
      settingsPda: args.settingsPda,
      assetIndex,
      policies,
    });

    return {
      programId: smartAccountsClient.programId.toBase58(),
      settingsPda: args.settingsPda.toBase58(),
      threshold: settings.threshold,
      timeLock: settings.timeLock,
      staleTransactionIndex: toBigInt(
        settings.staleTransactionIndex
      ).toString(),
      canonicalVaultAddress:
        vaults[0]?.address ??
        pda
          .getSmartAccountPda({
            programId: smartAccountsClient.programId,
            settingsPda: args.settingsPda,
            accountIndex: 0,
          })[0]
          .toBase58(),
      signers,
      policies,
      spendingLimits,
      vaults: vaultsWithSigners,
      proposals,
      fetchedAt: Date.now(),
    };
  }

  async function prepareSolTransferProposal(
    args: SmartAccountTransferProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultSolTransferMessage({
      connection: config.connection,
      vaultPda,
      destination: args.destination,
      amountLamports: args.amountLamports,
    });
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposeSolTransfer",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function prepareSplTransferProposal(
    args: SmartAccountTokenTransferProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultSplTransferMessage({
      connection: config.connection,
      vaultPda,
      mint: args.mint,
      destinationOwner: args.destinationOwner,
      amount: args.amount,
      decimals: args.decimals,
      destinationTokenAccount: args.destinationTokenAccount,
      tokenProgramId: args.tokenProgramId,
      createDestinationAta: args.createDestinationAta,
    });
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposeSplTransfer",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function prepareCustomInstructionProposal(
    args: SmartAccountCustomInstructionProposalInput
  ) {
    if (args.instructions.length === 0) {
      throw new Error(
        "Custom instruction proposal requires at least one instruction."
      );
    }

    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultCustomInstructionMessage({
      connection: config.connection,
      vaultPda,
      instructions: args.instructions,
    });
    const addressLookupTableAccounts = dedupeLookupTableAccounts(
      args.addressLookupTableAccounts ?? []
    );
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        addressLookupTableAccounts,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposeCustomInstructions",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function preparePolicyCustomInstructionProposal(
    args: SmartAccountPolicyCustomInstructionProposalInput
  ) {
    if (args.instructions.length === 0) {
      throw new Error(
        "Policy custom instruction proposal requires at least one instruction."
      );
    }

    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const policy = await smartAccountsClient.policies.queries.fetchPolicy(
      args.policyPda
    );
    const settingsPda = policy.settings;
    const transactionIndex = toBigInt(policy.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultCustomInstructionMessage({
      connection: config.connection,
      vaultPda,
      instructions: args.instructions,
    });
    const addressLookupTableAccounts = dedupeLookupTableAccounts(
      args.addressLookupTableAccounts ?? []
    );
    const { transactionMessageBytes } =
      transactionMessageToMultisigTransactionMessageBytes({
        message: transactionMessage,
        addressLookupTableAccounts,
        smartAccountPda: vaultPda,
      });
    const instructionConstraintIndices =
      args.instructionConstraintIndices ??
      new Uint8Array(args.instructions.map(() => 0));
    if (instructionConstraintIndices.length !== args.instructions.length) {
      throw new Error(
        "instructionConstraintIndices length must match instructions length."
      );
    }
    const policyPayload: generated.PolicyPayload = {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices,
          transactionPayload: {
            __kind: "AsyncTransaction",
            fields: [
              {
                accountIndex,
                ephemeralSigners: 0,
                transactionMessage: transactionMessageBytes,
                memo: args.memo ?? null,
              },
            ],
          },
        },
      ],
    };
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.policies.prepare.createTransaction({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        policy: args.policyPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        policyPayload,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.policyPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposePolicyCustomInstructions",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function prepareSpendingLimitSettingsChange(args: {
    actions: SettingsAction[];
    creator: PublicKey;
    feePayer: PublicKey;
    memo?: string;
    operation: string;
    policies: PublicKey[];
    settingsPda: PublicKey;
    spendingLimits: PublicKey[];
  }): Promise<SmartAccountPreparedSettingsChange> {
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);

    if (settings.threshold <= 1) {
      return {
        transactionIndex,
        prepared:
          await smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
            {
              feePayer: args.feePayer,
              settingsPda: args.settingsPda,
              signers: [args.creator],
              actions: args.actions,
              memo: args.memo,
              remainingAccounts: toWritableAccountMetas([
                ...args.spendingLimits,
                ...args.policies,
              ]),
            } as never
          ),
      };
    }

    const preparedOperations = await Promise.all([
      smartAccountsClient.features.smartAccounts.prepare.createSettingsTransaction(
        {
          feePayer: args.feePayer,
          rentPayer: args.feePayer,
          settingsPda: args.settingsPda,
          transactionIndex,
          creator: args.creator,
          actions: args.actions,
          memo: args.memo,
        } as never
      ),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
      smartAccountsClient.features.proposals.prepare.approve({
        feePayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        signer: args.creator,
      } as never),
    ]);

    return {
      transactionIndex,
      prepared: mergePreparedOperations({
        operation: args.operation,
        payer: args.feePayer,
        programId: smartAccountsClient.programId,
        operations: preparedOperations,
      }),
    };
  }

  async function prepareSetSpendingLimitPolicy(
    args: SmartAccountSetSpendingLimitProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const existingPolicy = args.existingSpendingLimitPolicy
      ? await smartAccountsClient.policies.queries.fetchPolicy(
          args.existingSpendingLimitPolicy
        )
      : null;
    const actions: SettingsAction[] = [];
    const policies: PublicKey[] = [];

    if (existingPolicy && args.existingSpendingLimitPolicy) {
      if (existingPolicy.policyState.__kind !== "SpendingLimit") {
        throw new Error("Existing policy is not a spending-limit policy.");
      }

      if (!existingPolicy.settings.equals(args.settingsPda)) {
        throw new Error("Existing spending-limit policy belongs to another vault.");
      }

      const policyUpdatePayload = createSpendingLimitPolicyCreationPayload({
        accountIndex: args.accountIndex,
        amount: args.amount,
        base: toSpendingLimitPolicyCreationBase(existingPolicy),
        destinations: args.destinations,
        expiration: args.expiration,
        mint: args.mint,
        period: args.period,
      });

      actions.push({
        __kind: "PolicyUpdate",
        policy: args.existingSpendingLimitPolicy,
        signers: existingPolicy.signers.length
          ? existingPolicy.signers
          : [createPolicySigner(args.signer)],
        threshold: existingPolicy.threshold || 1,
        timeLock: existingPolicy.timeLock,
        policyUpdatePayload,
        expirationArgs: null,
      });
      policies.push(args.existingSpendingLimitPolicy);
    } else {
      const policyCreationPayload = createSpendingLimitPolicyCreationPayload({
        accountIndex: args.accountIndex,
        amount: args.amount,
        destinations: args.destinations,
        expiration: args.expiration,
        mint: args.mint,
        period: args.period,
      });
      const settings =
        await smartAccountsClient.smartAccounts.queries.fetchSettings(
          args.settingsPda
        );
      const nextPolicySeed = resolveNextPolicySeed(settings);
      const newPolicyPda = pda.getPolicyPda({
        programId: smartAccountsClient.programId,
        settingsPda: args.settingsPda,
        policySeed: nextPolicySeed.number,
      })[0];

      actions.push({
        __kind: "PolicyCreate",
        seed: toBn(nextPolicySeed.bigint),
        policyCreationPayload,
        signers: [createPolicySigner(args.signer)],
        threshold: 1,
        timeLock: 0,
        startTimestamp: null,
        expirationArgs: null,
      });
      policies.push(newPolicyPda);
    }

    return prepareSpendingLimitSettingsChange({
      actions,
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: existingPolicy
        ? "updateSpendingLimitPolicy"
        : "createSpendingLimitPolicy",
      policies,
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareRemoveSpendingLimitPolicy(
    args: SmartAccountRemoveSpendingLimitProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    return prepareSpendingLimitSettingsChange({
      actions: [
        {
          __kind: "PolicyRemove",
          policy: args.spendingLimitPolicy,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "removeSpendingLimitPolicy",
      policies: [args.spendingLimitPolicy],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareUseSolSpendingLimitPolicy(
    args: SmartAccountUseSpendingLimitInput
  ): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    if (args.amountLamports <= BigInt(0)) {
      throw new Error("Spending-limit transfer amount must be greater than 0.");
    }

    if (args.amountLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        "Spending-limit transfer amount is too large for this client."
      );
    }

    const policy = await smartAccountsClient.policies.queries.fetchPolicy(
      args.spendingLimitPolicy
    );
    const policyState = policy.policyState;

    if (!policy.settings.equals(args.settingsPda)) {
      throw new Error("Spending-limit policy does not belong to this vault.");
    }

    if (
      policyState.__kind !== "SpendingLimit" ||
      !policyState.fields[0].spendingLimit.mint.equals(PublicKey.default)
    ) {
      throw new Error("A SOL spending-limit policy is required for top-up.");
    }

    const accountIndex = policyState.fields[0].sourceAccountIndex;
    const sourceSmartAccountPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const policyPayload: generated.PolicyPayload = {
      __kind: "SpendingLimit",
      fields: [
        {
          amount: toBn(args.amountLamports),
          destination: args.destination,
          decimals: 9,
        },
      ],
    };
    const instructionAccounts: AccountMeta[] = [
      {
        pubkey: args.signer,
        isSigner: true,
        isWritable: false,
      },
    ];

    if (policy.expiration?.__kind === "SettingsState") {
      instructionAccounts.push({
        pubkey: args.settingsPda,
        isSigner: false,
        isWritable: false,
      });
    }

    instructionAccounts.push(
      {
        pubkey: sourceSmartAccountPda,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: args.destination,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      }
    );

    return smartAccountsClient.features.execution.prepare.executePolicyPayloadSync({
      feePayer: args.feePayer,
      policy: args.spendingLimitPolicy,
      accountIndex,
      numSigners: 1,
      policyPayload,
      instruction_accounts: instructionAccounts,
      memo: args.memo,
    } as never);
  }

  function prepareApproveProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
    memo?: string;
  }) {
    return smartAccountsClient.features.proposals.prepare.approve({
      ...args,
      programId: smartAccountsClient.programId,
    } as never);
  }

  function prepareRejectProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
    memo?: string;
  }) {
    return smartAccountsClient.features.proposals.prepare.reject({
      ...args,
      programId: smartAccountsClient.programId,
    } as never);
  }

  function prepareExecuteProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }) {
    return smartAccountsClient.features.execution.prepare.executeTransaction({
      ...args,
      connection: config.connection,
      programId: smartAccountsClient.programId,
    } as never);
  }

  async function prepareExecuteSettingsProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }) {
    const transactionPda = pda.getTransactionPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      transactionIndex: args.transactionIndex,
    })[0];
    const settingsTransaction =
      await smartAccountsClient.execution.queries.fetchSettingsTransaction(
        transactionPda
      );
    const executionAccounts = getSettingsTransactionExecutionAccounts({
      settingsPda: args.settingsPda,
      settingsTransaction,
      programId: smartAccountsClient.programId,
    });

    return smartAccountsClient.features.execution.prepare.executeSettingsTransaction(
      {
        ...args,
        rentPayer: args.feePayer,
        spendingLimits: executionAccounts.spendingLimits.length
          ? executionAccounts.spendingLimits
          : undefined,
        policies: executionAccounts.policies.length
          ? executionAccounts.policies
          : undefined,
        programId: smartAccountsClient.programId,
      } as never
    );
  }

  return {
    connection: config.connection,
    programId: smartAccountsClient.programId,
    sdk: smartAccountsClient,
    fetchVault,
    listVaults,
    listSpendingLimitPolicies,
    listSpendingLimits: listSpendingLimitPolicies,
    listProposals,
    fetchOverview,
    prepareSolTransferProposal,
    prepareSplTransferProposal,
    prepareCustomInstructionProposal,
    preparePolicyCustomInstructionProposal,
    prepareSetSpendingLimitPolicy,
    prepareSetSpendingLimitProposal: prepareSetSpendingLimitPolicy,
    prepareRemoveSpendingLimitPolicy,
    prepareRemoveSpendingLimitProposal: prepareRemoveSpendingLimitPolicy,
    prepareUseSolSpendingLimitPolicy,
    prepareUseSolSpendingLimit: prepareUseSolSpendingLimitPolicy,
    prepareApproveProposal,
    prepareRejectProposal,
    prepareExecuteProposal,
    prepareExecuteSettingsProposal,
  };
}
