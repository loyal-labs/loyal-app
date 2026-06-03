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
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
} from "@loyal/actions";
import { executePolicyTransaction as buildExecutePolicyTransactionInstruction } from "@loyal-labs/loyal-smart-accounts-core/internal";
import {
  accountsForTransactionExecute,
  Policy,
  Permission,
  Permissions,
  Proposal,
  SettingsTransaction,
  Transaction,
  freezePreparedOperation,
  instructionsToSynchronousTransactionDetailsV2,
  policyDiscriminator,
  proposalDiscriminator,
  settingsTransactionDiscriminator,
  toBigInt,
  transactionMessageBeet,
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
import { decodeSolanaInstruction } from "@loyal-labs/solana-instruction-decoder";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  SystemInstruction,
  TransactionInstruction,
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
  SmartAccountOverviewBase,
  SmartAccountAddSignerProposalInput,
  SmartAccountClosePoliciesProposalInput,
  SmartAccountClosePoliciesSyncInput,
  SmartAccountClosePolicyProposalInput,
  SmartAccountClosePolicySyncInput,
  SmartAccountCustomInstructionProposalInput,
  SmartAccountEarnUsdcDepositInput,
  SmartAccountEarnUsdcYieldRoutingPolicyInput,
  SmartAccountEarnUsdcWithdrawInput,
  SmartAccountPolicyOverview,
  SmartAccountPolicySnapshot,
  SmartAccountPolicyCustomInstructionProposalInput,
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
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
  SmartAccountRemoveSignerProposalInput,
  SmartAccountUpdateSignerPermissionsInput,
  SmartAccountTokenTransferProposalInput,
  SmartAccountTransferProposalInput,
  SmartAccountUseSpendingLimitInput,
  SmartAccountVaultSnapshot,
  SmartAccountVaultBaseSnapshot,
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
    accountIndexes: Uint8Array | number[];
    data: Uint8Array | number[];
  }>;
  addressTableLookups?: Array<{
    accountKey: PublicKey;
    writableIndexes: Uint8Array | number[];
    readonlyIndexes: Uint8Array | number[];
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

type PolicyPayloadLike = Transaction["payload"] & {
  __kind: "PolicyPayload";
  fields: [{ payload: generated.PolicyPayload }];
};

type AsyncPolicyTransactionPayloadLike = {
  accountIndex: number;
  transactionMessage: Uint8Array;
};

const EARN_DEPOSIT_VAULT_INDEX = 1 as const;
const EARN_DEPOSIT_POLICY_SEED = BigInt(1);
const EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES = [0, 1] as const;
const EARN_DEPOSIT_USDC_DECIMALS = 6;
const KAMINO_DEVNET_USDC_RESERVE_LIQUIDITY_SUPPLY = new PublicKey(
  "Bh45cPkpfRvz9hAs23ye5TowsGbhbh4BXT4AGww8JfES"
);
const KAMINO_DEVNET_USDC_RESERVE_COLLATERAL_MINT = new PublicKey(
  "8GoBXfEq3aTiWTxEP2tAaygJMx3LhG764iN5e6gqaLA"
);
const KAMINO_DEPOSIT_INSTRUCTIONS_URL =
  "https://api.kamino.finance/ktx/klend/deposit-instructions";
const KAMINO_WITHDRAW_INSTRUCTIONS_URL =
  "https://api.kamino.finance/ktx/klend/withdraw-instructions";

type KaminoDepositInstructionResponse = {
  instructions?: Array<{
    accounts?: Array<{
      address?: unknown;
      role?: unknown;
    }>;
    data?: unknown;
    programAddress?: unknown;
  }>;
};

type KaminoInstructionResponse = KaminoDepositInstructionResponse;

type KaminoEarnTarget = ReturnType<typeof getKaminoUsdcEarnTargetForCluster> & {
  reserveCollateralMint?: PublicKey;
  reserveLiquiditySupply?: PublicKey;
};

function resolveKaminoEarnTarget(cluster: LoyalCluster): KaminoEarnTarget {
  const target = getKaminoUsdcEarnTargetForCluster(cluster);

  if (cluster === LoyalCluster.Devnet) {
    return {
      ...target,
      reserveCollateralMint: KAMINO_DEVNET_USDC_RESERVE_COLLATERAL_MINT,
      reserveLiquiditySupply: KAMINO_DEVNET_USDC_RESERVE_LIQUIDITY_SUPPLY,
    };
  }

  return target;
}

function getLendingMarketAuthority(args: {
  market: PublicKey;
  lendProgramId: PublicKey;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), args.market.toBuffer()],
    args.lendProgramId
  )[0];
}

function encodeU64InstructionData(
  discriminator: readonly number[],
  amountRaw: bigint
): Buffer {
  if (amountRaw < BigInt(0) || amountRaw > BigInt("18446744073709551615")) {
    throw new Error("Kamino instruction amount must fit in u64.");
  }

  const data = new Uint8Array(16);
  data.set(discriminator, 0);
  new DataView(data.buffer).setBigUint64(8, amountRaw, true);
  return Buffer.from(data);
}

function requireLocalKaminoTargetAccounts(target: KaminoEarnTarget): {
  reserveCollateralMint: PublicKey;
  reserveLiquiditySupply: PublicKey;
} {
  if (!target.reserveCollateralMint || !target.reserveLiquiditySupply) {
    throw new Error("Local Kamino instruction target is incomplete.");
  }

  return {
    reserveCollateralMint: target.reserveCollateralMint,
    reserveLiquiditySupply: target.reserveLiquiditySupply,
  };
}

function createLocalKaminoDepositInstruction(args: {
  amountRaw: bigint;
  target: KaminoEarnTarget;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
  vaultCollateralAta: PublicKey;
}): TransactionInstruction {
  const { reserveCollateralMint, reserveLiquiditySupply } =
    requireLocalKaminoTargetAccounts(args.target);
  const lendingMarketAuthority = getLendingMarketAuthority({
    market: args.target.market,
    lendProgramId: args.target.lendProgramId,
  });

  return new TransactionInstruction({
    programId: args.target.lendProgramId,
    keys: [
      { pubkey: args.vaultPda, isSigner: true, isWritable: true },
      { pubkey: args.target.reserve, isSigner: false, isWritable: true },
      { pubkey: args.target.market, isSigner: false, isWritable: false },
      { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: args.target.liquidityMint, isSigner: false, isWritable: false },
      { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
      { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
      { pubkey: args.vaultUsdcAta, isSigner: false, isWritable: true },
      { pubkey: args.vaultCollateralAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: encodeU64InstructionData(
      args.target.depositDiscriminator,
      args.amountRaw
    ),
  });
}

function createLocalKaminoWithdrawInstruction(args: {
  amountRaw: bigint;
  target: KaminoEarnTarget;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
  vaultCollateralAta: PublicKey;
}): TransactionInstruction {
  const { reserveCollateralMint, reserveLiquiditySupply } =
    requireLocalKaminoTargetAccounts(args.target);
  const lendingMarketAuthority = getLendingMarketAuthority({
    market: args.target.market,
    lendProgramId: args.target.lendProgramId,
  });

  return new TransactionInstruction({
    programId: args.target.lendProgramId,
    keys: [
      { pubkey: args.vaultPda, isSigner: true, isWritable: true },
      { pubkey: args.target.market, isSigner: false, isWritable: false },
      { pubkey: args.target.reserve, isSigner: false, isWritable: true },
      { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: args.target.liquidityMint, isSigner: false, isWritable: false },
      { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
      { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
      { pubkey: args.vaultCollateralAta, isSigner: false, isWritable: true },
      { pubkey: args.vaultUsdcAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: encodeU64InstructionData(
      args.target.withdrawDiscriminator,
      args.amountRaw
    ),
  });
}

function dataSliceEquals(
  value: readonly number[]
): generated.DataConstraint {
  return {
    dataOffset: toBn(BigInt(0)),
    dataValue: { __kind: "U8Slice", fields: [Uint8Array.from(value)] },
    operator: generated.DataOperator.Equals,
  };
}

function accountDataBytesEqual(args: {
  offset: bigint;
  value: Uint8Array;
}): generated.DataConstraint {
  return {
    dataOffset: toBn(args.offset),
    dataValue: { __kind: "U8Slice", fields: [args.value] },
    operator: generated.DataOperator.Equals,
  };
}

function pubkeyAccountConstraint(
  accountIndex: number,
  pubkeys: PublicKey[],
  owner: PublicKey | null = null
): generated.AccountConstraint {
  return {
    accountIndex,
    accountConstraint: { __kind: "Pubkey", fields: [pubkeys] },
    owner,
  };
}

function tokenAuthorityAccountConstraint(
  accountIndex: number,
  authority: PublicKey
): generated.AccountConstraint {
  return {
    accountIndex,
    accountConstraint: {
      __kind: "AccountData",
      fields: [
        [
          accountDataBytesEqual({
            offset: BigInt(32),
            value: authority.toBytes(),
          }),
        ],
      ],
    },
    owner: TOKEN_PROGRAM_ID,
  };
}

function createEarnProgramInteractionPolicyCreationPayload(args: {
  target: KaminoEarnTarget;
  vaultPda: PublicKey;
}): generated.PolicyCreationPayload {
  const withdrawConstraint: generated.InstructionConstraint = {
    programId: args.target.lendProgramId,
    accountConstraints: [
      pubkeyAccountConstraint(0, [args.vaultPda]),
      pubkeyAccountConstraint(1, [args.target.market]),
      pubkeyAccountConstraint(4, [args.target.liquidityMint], TOKEN_PROGRAM_ID),
      tokenAuthorityAccountConstraint(8, args.vaultPda),
      pubkeyAccountConstraint(10, [TOKEN_PROGRAM_ID]),
    ],
    dataConstraints: [
      dataSliceEquals(args.target.withdrawDiscriminator),
    ],
  };
  const depositConstraint: generated.InstructionConstraint = {
    programId: args.target.lendProgramId,
    accountConstraints: [
      pubkeyAccountConstraint(0, [args.vaultPda]),
      pubkeyAccountConstraint(2, [args.target.market]),
      pubkeyAccountConstraint(4, [args.target.liquidityMint], TOKEN_PROGRAM_ID),
      tokenAuthorityAccountConstraint(8, args.vaultPda),
      pubkeyAccountConstraint(10, [TOKEN_PROGRAM_ID]),
    ],
    dataConstraints: [
      dataSliceEquals(args.target.depositDiscriminator),
    ],
  };

  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        instructionsConstraints: [withdrawConstraint, depositConstraint],
        preHook: null,
        postHook: null,
        spendingLimits: [],
      },
    ],
  };
}

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

function toGeneratedTransactionMessage(
  message: VaultMessage
): generated.SmartAccountTransactionMessage {
  return {
    numSigners: message.numSigners,
    numWritableSigners: message.numWritableSigners,
    numWritableNonSigners: message.numWritableNonSigners,
    accountKeys: message.accountKeys,
    instructions: message.instructions.map((instruction) => ({
      programIdIndex: instruction.programIdIndex,
      accountIndexes: Uint8Array.from(instruction.accountIndexes),
      data: Uint8Array.from(instruction.data),
    })),
    addressTableLookups: (message.addressTableLookups ?? []).map((lookup) => ({
      accountKey: lookup.accountKey,
      writableIndexes: Uint8Array.from(lookup.writableIndexes),
      readonlyIndexes: Uint8Array.from(lookup.readonlyIndexes),
    })),
  };
}

function formatRawTokenAmountForApi(
  amountRaw: bigint,
  decimals: number
): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = amountRaw / base;
  const fraction = amountRaw % base;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  return `${whole.toString()}.${fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")}`;
}

function parseKaminoInstructionRole(role: unknown): {
  isSigner: boolean;
  isWritable: boolean;
} {
  const normalized = typeof role === "string" ? role.toUpperCase() : "";

  return {
    isSigner: normalized.includes("SIGNER"),
    isWritable: normalized.includes("WRITABLE"),
  };
}

function readKaminoDepositInstruction(
  payload: KaminoInstructionResponse,
  lendProgramId: PublicKey,
  label = "deposit"
): TransactionInstruction {
  const instruction = payload.instructions?.find(
    (entry) =>
      entry.programAddress === lendProgramId.toBase58() &&
      typeof entry.data === "string" &&
      Array.isArray(entry.accounts)
  );

  if (!instruction || typeof instruction.programAddress !== "string") {
    throw new Error(`Kamino did not return a ${label} instruction.`);
  }

  return {
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => {
      if (typeof account.address !== "string") {
        throw new Error(
          `Kamino ${label} instruction account is missing an address.`
        );
      }
      const role = parseKaminoInstructionRole(account.role);
      return {
        pubkey: new PublicKey(account.address),
        isSigner: role.isSigner,
        isWritable: role.isWritable,
      };
    }),
    data: Buffer.from(instruction.data as string, "base64"),
  };
}

async function fetchKaminoDepositInstruction(args: {
  amountRaw: bigint;
  lendProgramId: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  wallet: PublicKey;
}): Promise<TransactionInstruction> {
  const response = await fetch(KAMINO_DEPOSIT_INSTRUCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: args.wallet.toBase58(),
      market: args.market.toBase58(),
      reserve: args.reserve.toBase58(),
      amount: formatRawTokenAmountForApi(
        args.amountRaw,
        EARN_DEPOSIT_USDC_DECIMALS
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Kamino deposit instruction request failed with status ${response.status}.`
    );
  }

  return readKaminoDepositInstruction(
    (await response.json()) as KaminoInstructionResponse,
    args.lendProgramId,
    "deposit"
  );
}

async function fetchKaminoWithdrawInstruction(args: {
  amountRaw: bigint;
  lendProgramId: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  wallet: PublicKey;
}): Promise<TransactionInstruction> {
  const response = await fetch(KAMINO_WITHDRAW_INSTRUCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: args.wallet.toBase58(),
      market: args.market.toBase58(),
      reserve: args.reserve.toBase58(),
      amount: formatRawTokenAmountForApi(
        args.amountRaw,
        EARN_DEPOSIT_USDC_DECIMALS
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Kamino withdraw instruction request failed with status ${response.status}.`
    );
  }

  return readKaminoDepositInstruction(
    (await response.json()) as KaminoInstructionResponse,
    args.lendProgramId,
    "withdraw"
  );
}

function requireKaminoAccount(
  instruction: TransactionInstruction,
  index: number,
  label: string
): PublicKey {
  const account = instruction.keys[index]?.pubkey;
  if (!account) {
    throw new Error(`Kamino withdraw instruction is missing ${label}.`);
  }
  return account;
}

function assertKaminoAccountEquals(args: {
  actual: PublicKey;
  expected: PublicKey;
  label: string;
}) {
  if (!args.actual.equals(args.expected)) {
    throw new Error(
      `Kamino withdraw instruction has an unexpected ${args.label}.`
    );
  }
}

function validateKaminoWithdrawInstruction(args: {
  instruction: TransactionInstruction;
  lendProgramId: PublicKey;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  liquidityMint: PublicKey;
}): { vaultCollateralAta: PublicKey; reserveCollateralMint: PublicKey } {
  const { instruction } = args;
  assertKaminoAccountEquals({
    actual: instruction.programId,
    expected: args.lendProgramId,
    label: "program",
  });
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, 0, "vault"),
    expected: args.vaultPda,
    label: "vault",
  });
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, 1, "market"),
    expected: args.market,
    label: "market",
  });
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, 2, "reserve"),
    expected: args.reserve,
    label: "reserve",
  });
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, 4, "liquidity mint"),
    expected: args.liquidityMint,
    label: "liquidity mint",
  });
  const reserveCollateralMint = requireKaminoAccount(
    instruction,
    5,
    "reserve collateral mint"
  );
  const vaultCollateralAta = getAssociatedTokenAddressSync(
    reserveCollateralMint,
    args.vaultPda,
    true,
    TOKEN_PROGRAM_ID
  );
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, 7, "vault collateral account"),
    expected: vaultCollateralAta,
    label: "vault collateral account",
  });
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, 8, "vault USDC account"),
    expected: args.vaultUsdcAta,
    label: "vault USDC account",
  });
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, 10, "liquidity token program"),
    expected: TOKEN_PROGRAM_ID,
    label: "liquidity token program",
  });
  return { reserveCollateralMint, vaultCollateralAta };
}

function makeSignerWritable(
  instruction: TransactionInstruction,
  signer: PublicKey
): TransactionInstruction {
  return {
    ...instruction,
    keys: instruction.keys.map((key) =>
      key.pubkey.equals(signer) && key.isSigner
        ? { ...key, isWritable: true }
        : key
    ),
  };
}

function formatProposalTokenAmount(
  amountRaw: bigint,
  decimals: number
): string {
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
  policy: SmartAccountPolicySnapshot | null;
}): {
  summary: SmartAccountProposalSummary;
  accountIndex: number | null;
  decodedInstructions: ReturnType<typeof decodeSolanaInstruction>[];
} {
  if (args.payload.__kind === "PolicyPayload") {
    return summarizePolicyPayload({
      assetIndex: args.assetIndex,
      payload: (args.payload as PolicyPayloadLike).fields[0].payload,
      policy: args.policy,
    });
  }

  if (args.payload.__kind !== "TransactionPayload") {
    return {
      accountIndex: null,
      decodedInstructions: [],
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  const details = (args.payload as TransactionPayloadLike).fields[0];
  return summarizeVaultMessage({
    accountIndex: details.accountIndex,
    assetIndex: args.assetIndex,
    message: details.message,
  });
}

function summarizeVaultMessage(args: {
  message: VaultMessage;
  accountIndex: number;
  assetIndex: Map<string, PortfolioPosition>;
}): {
  summary: SmartAccountProposalSummary;
  accountIndex: number | null;
  decodedInstructions: ReturnType<typeof decodeSolanaInstruction>[];
} {
  const instructions = compileVaultInstructions(args.message);
  const decodedInstructions = instructions.map((instruction) =>
    decodeSolanaInstruction({
      programId: instruction.programId,
      keys: instruction.keys,
      data: instruction.data,
    })
  );

  for (const instruction of instructions) {
    if (instruction.programId.equals(SystemProgram.programId)) {
      const summary = summarizeSolTransferInstruction({
        instruction,
        instructionCount: instructions.length,
      });

      if (summary) {
        return {
          accountIndex: args.accountIndex,
          decodedInstructions,
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
          accountIndex: args.accountIndex,
          decodedInstructions,
          summary,
        };
      }
    }
  }

  const firstInstruction = instructions[0] ?? null;

  if (!firstInstruction) {
    return {
      accountIndex: args.accountIndex,
      decodedInstructions,
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  return {
    accountIndex: args.accountIndex,
    decodedInstructions,
    summary: summarizeUnknownInstruction({
      programId: firstInstruction.programId,
      instructionCount: instructions.length,
    }),
  };
}

function summarizePolicyPayload(args: {
  payload: generated.PolicyPayload;
  policy: SmartAccountPolicySnapshot | null;
  assetIndex: Map<string, PortfolioPosition>;
}): {
  summary: SmartAccountProposalSummary;
  accountIndex: number | null;
  decodedInstructions: ReturnType<typeof decodeSolanaInstruction>[];
} {
  if (args.payload.__kind === "SpendingLimit") {
    const payload = args.payload.fields[0];
    const mint = args.policy?.mint ?? null;
    const asset =
      mint === null
        ? {
            decimals: payload.decimals,
            symbol: null,
          }
        : resolveSpendingLimitAsset({
            assetIndex: args.assetIndex,
            mint,
          });
    const kind =
      mint === SOL_SPENDING_LIMIT_MINT ? "sol_transfer" : "spl_transfer";

    return {
      accountIndex: args.policy?.accountIndex ?? null,
      decodedInstructions: [],
      summary: {
        kind,
        title: "Send",
        subtitle: `to ${payload.destination.toBase58()}`,
        symbol: asset.symbol,
        amountUi: formatProposalTokenAmount(
          toBigInt(payload.amount),
          payload.decimals
        ),
        amountRaw: toBigInt(payload.amount).toString(),
        mint,
        decimals: payload.decimals,
        destination: payload.destination.toBase58(),
        programId: null,
        instructionCount: 1,
      },
    };
  }

  if (args.payload.__kind === "ProgramInteraction") {
    const payload = args.payload.fields[0].transactionPayload;

    if (payload.__kind === "AsyncTransaction") {
      const details = payload.fields[0] as AsyncPolicyTransactionPayloadLike;
      const [message] = transactionMessageBeet.deserialize(
        Buffer.from(details.transactionMessage),
        0
      );

      return summarizeVaultMessage({
        accountIndex: details.accountIndex,
        assetIndex: args.assetIndex,
        message,
      });
    }
  }

  return {
    accountIndex: args.policy?.accountIndex ?? null,
    decodedInstructions: [],
    summary: summarizeUnknownInstruction({
      programId: null,
      instructionCount: 0,
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
    lamports: null,
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

function accountMatchesDiscriminator(
  account: AccountInfo<Buffer>,
  discriminator: readonly number[]
): boolean {
  return Buffer.from(account.data)
    .subarray(0, discriminator.length)
    .equals(Buffer.from(discriminator));
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

function createEmptyActivityPage() {
  return {
    activities: [],
  };
}

function nowMs() {
  return globalThis.performance?.now() ?? Date.now();
}

async function logTimedReadStep<T>(
  label: string,
  details: Record<string, unknown>,
  load: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>
): Promise<T> {
  const startedAt = nowMs();

  try {
    const result = await load();
    console.info(`[smart-account-vaults] ${label}`, {
      ...details,
      ...(summarize?.(result) ?? {}),
      durationMs: Number((nowMs() - startedAt).toFixed(2)),
    });
    return result;
  } catch (error) {
    console.info(`[smart-account-vaults] ${label} failed`, {
      ...details,
      durationMs: Number((nowMs() - startedAt).toFixed(2)),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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

function toSpendingLimitPolicyPeriod(period: generated.PeriodV2): {
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

function toProposalStatusTimestamp(status: {
  __kind: string;
  timestamp?: Parameters<typeof toBigInt>[0];
}): number | null {
  if (!("timestamp" in status)) {
    return null;
  }

  return toNullableTimestamp(status.timestamp ?? null);
}

function compareProposalSnapshotsByRecency(
  left: SmartAccountProposalSnapshot,
  right: SmartAccountProposalSnapshot
) {
  const timestampDelta =
    (right.statusTimestamp ?? 0) - (left.statusTimestamp ?? 0);

  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  const leftIndex = BigInt(left.transactionIndex);
  const rightIndex = BigInt(right.transactionIndex);

  if (leftIndex !== rightIndex) {
    return rightIndex > leftIndex ? 1 : -1;
  }

  return left.proposalAddress.localeCompare(right.proposalAddress);
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

function toPermissionFlags(
  permissions: SmartAccountSignerPermission[]
): Permission[] {
  const flags: Permission[] = [];
  if (permissions.includes("initiate")) {
    flags.push(Permission.Initiate);
  }
  if (permissions.includes("vote")) {
    flags.push(Permission.Vote);
  }
  if (permissions.includes("execute")) {
    flags.push(Permission.Execute);
  }
  return flags;
}

function withPolicySignerPermissions(
  signers: SmartAccountSigner[],
  signer: PublicKey,
  permissions: SmartAccountSignerPermission[]
): SmartAccountSigner[] {
  const flags = toPermissionFlags(permissions);
  if (flags.length === 0) {
    throw new Error("Signer must keep at least one permission.");
  }
  const newMask = flags.reduce<number>((acc, flag) => acc | flag, 0);

  const existingSigner = signers.find((entry) => entry.key.equals(signer));
  if (existingSigner) {
    const mergedMask = existingSigner.permissions.mask | newMask;
    if (mergedMask === existingSigner.permissions.mask) {
      throw new Error("Signer already has the requested permissions.");
    }

    return [
      { ...existingSigner, permissions: { mask: mergedMask } },
      ...signers.filter((entry) => !entry.key.equals(signer)),
    ];
  }

  return [
    { key: signer, permissions: Permissions.fromPermissions(flags) },
    ...signers.filter((entry) => !entry.key.equals(signer)),
  ];
}

function withoutPolicySigner(
  signers: SmartAccountSigner[],
  signer: PublicKey
): SmartAccountSigner[] {
  const nextSigners = signers.filter((entry) => !entry.key.equals(signer));

  if (nextSigners.length === signers.length) {
    throw new Error("Signer is not attached to this policy.");
  }

  return nextSigners;
}

function dedupeSignerSnapshots(
  signers: SmartAccountSignerSnapshot[]
): SmartAccountSignerSnapshot[] {
  const uniqueSigners = new Map<string, SmartAccountSignerSnapshot>();

  for (const signer of signers) {
    if (!uniqueSigners.has(signer.address)) {
      uniqueSigners.set(signer.address, signer);
    }
  }

  return Array.from(uniqueSigners.values());
}

async function fetchSignerLamports(args: {
  connection: Connection;
  signers: SmartAccountSignerSnapshot[];
}): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  const uniqueAddresses = [
    ...new Set(args.signers.map((signer) => signer.address)),
  ];
  const chunkSize = 100;

  for (let index = 0; index < uniqueAddresses.length; index += chunkSize) {
    const addressChunk = uniqueAddresses.slice(index, index + chunkSize);
    const publicKeys = addressChunk.map((address) => new PublicKey(address));
    const accountInfos = await args.connection.getMultipleAccountsInfo(
      publicKeys,
      "confirmed"
    );

    addressChunk.forEach((address, addressIndex) => {
      balances.set(address, accountInfos[addressIndex]?.lamports ?? 0);
    });
  }

  return balances;
}

function withSignerLamports(
  signers: SmartAccountSignerSnapshot[],
  lamportsByAddress: Map<string, number>
): SmartAccountSignerSnapshot[] {
  return signers.map((signer) => ({
    ...signer,
    lamports: lamportsByAddress.get(signer.address) ?? signer.lamports ?? 0,
  }));
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
          accumulateUnused:
            args.base?.timeConstraints.accumulateUnused ?? false,
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
  const effectiveRemainingAmount = getEffectiveSpendingLimitRemainingAmount({
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

type DeserializedPolicyAccount = ReturnType<typeof deserializePolicyAccount>;

function toPolicySnapshot(
  entry: DeserializedPolicyAccount
): SmartAccountPolicySnapshot {
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
  const rawPolicyState = entry.policy.policyState;
  const policyState = rawPolicyState.__kind ?? "unknown";
  const accountIndex =
    rawPolicyState.__kind === "SpendingLimit"
      ? rawPolicyState.fields[0].sourceAccountIndex
      : rawPolicyState.__kind === "ProgramInteraction"
      ? rawPolicyState.fields[0].accountIndex
      : null;
  const mint =
    rawPolicyState.__kind === "SpendingLimit"
      ? rawPolicyState.fields[0].spendingLimit.mint.toBase58()
      : null;

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
    accountIndex,
    mint,
    signers,
  };
}

function attachOverviewDecorations(args: {
  vaults: SmartAccountVaultSnapshot[];
  signers: SmartAccountSignerSnapshot[];
  policies: SmartAccountPolicySnapshot[];
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
}) {
  const spendingLimitAccountIndexes = new Map(
    args.spendingLimits.map((spendingLimit) => [
      spendingLimit.address,
      spendingLimit.accountIndex,
    ])
  );

  return args.vaults.map((vault) => ({
    ...vault,
    signers: dedupeSignerSnapshots([
      ...args.signers,
      ...args.policies
        .filter(
          (policy) =>
            spendingLimitAccountIndexes.get(policy.address) ===
            vault.accountIndex
        )
        .flatMap((policy) => policy.signers),
    ]),
    spendingLimits: args.spendingLimits.filter(
      (spendingLimit) => spendingLimit.accountIndex === vault.accountIndex
    ),
  }));
}

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
    lamports?: number;
  }): Promise<SmartAccountVaultSnapshot> {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const vaultAddress = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const dataClient = requireWalletDataClient(walletDataClient);
    const [lamports, portfolio, activity] = await Promise.all([
      args.lamports ?? config.connection.getBalance(vaultAddress, "confirmed"),
      dataClient.getPortfolio(vaultAddress),
      args.activityLimit === 0
        ? Promise.resolve(createEmptyActivityPage())
        : dataClient.getActivity(vaultAddress, {
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
    const vaultAddresses = accountIndexes.map(
      (accountIndex) =>
        pda.getSmartAccountPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.settingsPda,
          accountIndex,
        })[0]
    );
    const accountInfos = await config.connection.getMultipleAccountsInfo(
      vaultAddresses,
      "confirmed"
    );

    return Promise.all(
      accountIndexes.map((accountIndex, index) =>
        fetchVault({
          settingsPda: args.settingsPda,
          accountIndex,
          activityLimit: args.activityLimit,
          lamports: accountInfos[index]?.lamports ?? 0,
        })
      )
    );
  }

  async function listVaultBaseSnapshots(args: {
    settingsPda: PublicKey;
    accountUtilization: number;
  }): Promise<SmartAccountVaultBaseSnapshot[]> {
    const accountIndexes = Array.from(
      { length: Math.max(args.accountUtilization + 1, 1) },
      (_, index) => index
    );

    return accountIndexes.map((accountIndex) => ({
      accountIndex,
      address: pda
        .getSmartAccountPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.settingsPda,
          accountIndex,
        })[0]
        .toBase58(),
    }));
  }

  async function fetchPolicyAccounts(args: {
    settingsPda: PublicKey;
  }): Promise<DeserializedPolicyAccount[]> {
    const policyAccounts = await config.connection.getProgramAccounts(
      smartAccountsClient.programId,
      {
        commitment: "confirmed",
        filters: createPolicyFilters(args.settingsPda),
      }
    );

    return policyAccounts.map((account) => deserializePolicyAccount(account));
  }

  async function listPolicies(args: {
    settingsPda: PublicKey;
  }): Promise<SmartAccountPolicySnapshot[]> {
    const policyAccounts = await fetchPolicyAccounts(args);

    return policyAccounts
      .map((entry) => toPolicySnapshot(entry))
      .sort((left, right) => (BigInt(left.seed) > BigInt(right.seed) ? 1 : -1));
  }

  async function listSpendingLimitPolicies(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    now?: number;
  }): Promise<SmartAccountSpendingLimitSnapshot[]> {
    const policyAccounts = await fetchPolicyAccounts(args);
    const assetIndex = args.assetIndex ?? new Map<string, PortfolioPosition>();
    const now = args.now ?? Math.floor(Date.now() / 1000);

    return policyAccounts
      .map((entry) =>
        toSpendingLimitPolicySnapshot({
          address: entry.address,
          assetIndex,
          now,
          policy: entry.policy,
        })
      )
      .filter(
        (entry): entry is SmartAccountSpendingLimitSnapshot => entry !== null
      )
      .sort((left, right) => left.address.localeCompare(right.address));
  }

  async function fetchDerivedProposalAccounts(args: {
    consensusPda: PublicKey;
    fromTransactionIndex: bigint;
    toTransactionIndex: bigint;
    settingsPda: PublicKey;
  }): Promise<{
    proposalAccounts: { pubkey: PublicKey; account: AccountInfo<Buffer> }[];
    transactionAccounts: { pubkey: PublicKey; account: AccountInfo<Buffer> }[];
    settingsTransactionAccounts: {
      pubkey: PublicKey;
      account: AccountInfo<Buffer>;
    }[];
  }> {
    const fromTransactionIndex =
      args.fromTransactionIndex < BigInt(1)
        ? BigInt(1)
        : args.fromTransactionIndex;

    if (args.toTransactionIndex < fromTransactionIndex) {
      console.info("[smart-account-vaults] proposals.derived-skip-empty", {
        settingsPda: args.settingsPda.toBase58(),
        consensusPda: args.consensusPda.toBase58(),
        fromTransactionIndex: fromTransactionIndex.toString(),
        toTransactionIndex: args.toTransactionIndex.toString(),
      });
      return {
        proposalAccounts: [],
        transactionAccounts: [],
        settingsTransactionAccounts: [],
      };
    }

    const transactionIndexes: bigint[] = [];
    for (
      let transactionIndex = fromTransactionIndex;
      transactionIndex <= args.toTransactionIndex;
      transactionIndex += BigInt(1)
    ) {
      transactionIndexes.push(transactionIndex);
    }

    const proposalPdas = transactionIndexes.map(
      (transactionIndex) =>
        pda.getProposalPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.consensusPda,
          transactionIndex,
        })[0]
    );
    const transactionPdas = transactionIndexes.map(
      (transactionIndex) =>
        pda.getTransactionPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.consensusPda,
          transactionIndex,
        })[0]
    );
    const [proposalInfos, transactionInfos] = await Promise.all([
      logTimedReadStep(
        "proposals.derived-proposal-accounts",
        {
          settingsPda: args.settingsPda.toBase58(),
          consensusPda: args.consensusPda.toBase58(),
          fromTransactionIndex: fromTransactionIndex.toString(),
          toTransactionIndex: args.toTransactionIndex.toString(),
          accountCount: proposalPdas.length,
        },
        () =>
          config.connection.getMultipleAccountsInfo(proposalPdas, "confirmed"),
        (result) => ({
          foundCount: result.filter((account) => account !== null).length,
        })
      ),
      logTimedReadStep(
        "proposals.derived-transaction-accounts",
        {
          settingsPda: args.settingsPda.toBase58(),
          consensusPda: args.consensusPda.toBase58(),
          fromTransactionIndex: fromTransactionIndex.toString(),
          toTransactionIndex: args.toTransactionIndex.toString(),
          accountCount: transactionPdas.length,
        },
        () =>
          config.connection.getMultipleAccountsInfo(
            transactionPdas,
            "confirmed"
          ),
        (result) => ({
          foundCount: result.filter((account) => account !== null).length,
        })
      ),
    ]);
    const proposalAccounts = proposalInfos.flatMap((account, index) =>
      account && accountMatchesDiscriminator(account, proposalDiscriminator)
        ? [{ pubkey: proposalPdas[index]!, account }]
        : []
    );
    const transactionAccounts: {
      pubkey: PublicKey;
      account: AccountInfo<Buffer>;
    }[] = [];
    const settingsTransactionAccounts: {
      pubkey: PublicKey;
      account: AccountInfo<Buffer>;
    }[] = [];

    transactionInfos.forEach((account, index) => {
      if (!account) {
        return;
      }

      if (accountMatchesDiscriminator(account, transactionDiscriminator)) {
        transactionAccounts.push({ pubkey: transactionPdas[index]!, account });
        return;
      }

      if (
        accountMatchesDiscriminator(account, settingsTransactionDiscriminator)
      ) {
        settingsTransactionAccounts.push({
          pubkey: transactionPdas[index]!,
          account,
        });
      }
    });

    console.info("[smart-account-vaults] proposals.derived-done", {
      settingsPda: args.settingsPda.toBase58(),
      consensusPda: args.consensusPda.toBase58(),
      transactionIndexCount: transactionIndexes.length,
      proposalAccountCount: proposalAccounts.length,
      transactionAccountCount: transactionAccounts.length,
      settingsTransactionAccountCount: settingsTransactionAccounts.length,
    });

    return {
      proposalAccounts,
      transactionAccounts,
      settingsTransactionAccounts,
    };
  }

  async function listProposals(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    policies?:
      | SmartAccountPolicySnapshot[]
      | Promise<SmartAccountPolicySnapshot[]>;
  }): Promise<SmartAccountProposalSnapshot[]> {
    const settingsPdaText = args.settingsPda.toBase58();
    const startedAt = nowMs();
    console.info("[smart-account-vaults] proposals.start", {
      settingsPda: settingsPdaText,
      hasPoliciesInput: Boolean(args.policies),
      policiesInputCount: Array.isArray(args.policies)
        ? args.policies.length
        : null,
    });
    const [settings, policies] = await Promise.all([
      logTimedReadStep(
        "proposals.settings-fetch",
        { settingsPda: settingsPdaText },
        () =>
          smartAccountsClient.smartAccounts.queries.fetchSettings(
            args.settingsPda
          ),
        (result) => ({
          transactionIndex: toBigInt(result.transactionIndex).toString(),
          staleTransactionIndex: toBigInt(
            result.staleTransactionIndex
          ).toString(),
        })
      ),
      args.policies
        ? Promise.resolve(args.policies)
        : logTimedReadStep(
            "proposals.policy-scan",
            { settingsPda: settingsPdaText },
            () => listPolicies(args),
            (result) => ({ policyCount: result.length })
          ),
    ]);
    console.info("[smart-account-vaults] proposals.policy-consensus", {
      settingsPda: settingsPdaText,
      policyCount: policies.length,
    });
    const rootDerivedAccounts = await fetchDerivedProposalAccounts({
      settingsPda: args.settingsPda,
      consensusPda: args.settingsPda,
      fromTransactionIndex:
        toBigInt(settings.staleTransactionIndex) + BigInt(1),
      toTransactionIndex: toBigInt(settings.transactionIndex),
    });
    const policyDerivedAccountGroups = await Promise.all(
      policies.map((policy) =>
        fetchDerivedProposalAccounts({
          settingsPda: args.settingsPda,
          consensusPda: new PublicKey(policy.address),
          fromTransactionIndex:
            BigInt(policy.staleTransactionIndex) + BigInt(1),
          toTransactionIndex: BigInt(policy.transactionIndex),
        })
      )
    );
    const proposalAccounts = [
      rootDerivedAccounts.proposalAccounts,
      ...policyDerivedAccountGroups.map((group) => group.proposalAccounts),
    ].flat();
    const transactionAccounts = [
      rootDerivedAccounts.transactionAccounts,
      ...policyDerivedAccountGroups.map((group) => group.transactionAccounts),
    ].flat();
    const settingsTransactionAccounts = [
      rootDerivedAccounts.settingsTransactionAccounts,
      ...policyDerivedAccountGroups.map(
        (group) => group.settingsTransactionAccounts
      ),
    ].flat();
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
    const policiesByAddress = new Map(
      policies.map((policy) => [policy.address, policy])
    );
    const assetIndex = args.assetIndex ?? new Map<string, PortfolioPosition>();

    const proposals = proposalAccounts
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
          decodedInstructions: ReturnType<typeof decodeSolanaInstruction>[];
        } = {
          accountIndex: null,
          decodedInstructions: [],
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
            policy: policiesByAddress.get(consensusPda.toBase58()) ?? null,
          });
        } else if (settingsTransaction) {
          payloadType = "settings_transaction";
          transactionAddress = settingsTransaction.address.toBase58();
          creator = settingsTransaction.settingsTransaction.creator.toBase58();
          payloadSummary = {
            accountIndex: null,
            decodedInstructions: [],
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
          statusTimestamp: toProposalStatusTimestamp(entry.proposal.status),
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
          decodedInstructions: payloadSummary.decodedInstructions,
        } satisfies SmartAccountProposalSnapshot;
      })
      .sort(compareProposalSnapshotsByRecency);

    console.info("[smart-account-vaults] proposals.done", {
      settingsPda: settingsPdaText,
      policyCount: policies.length,
      proposalAccountCount: proposalAccounts.length,
      transactionAccountCount: transactionAccounts.length,
      settingsTransactionAccountCount: settingsTransactionAccounts.length,
      returnedProposalCount: proposals.length,
      durationMs: Number((nowMs() - startedAt).toFixed(2)),
    });

    return proposals;
  }

  async function fetchOverviewBase(args: {
    settingsPda: PublicKey;
  }): Promise<SmartAccountOverviewBase> {
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const vaults = await listVaultBaseSnapshots({
      settingsPda: args.settingsPda,
      accountUtilization: settings.accountUtilization,
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
      accountUtilization: settings.accountUtilization,
      signers,
      vaults,
      fetchedAt: Date.now(),
    };
  }

  async function fetchVaultSnapshots(args: {
    settingsPda: PublicKey;
    accountUtilization?: number;
    activityLimit?: number;
  }): Promise<SmartAccountVaultSnapshot[]> {
    return listVaults({
      settingsPda: args.settingsPda,
      accountUtilization: args.accountUtilization,
      activityLimit: args.activityLimit ?? 0,
    });
  }

  async function fetchPolicyOverview(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    rootSigners?: SmartAccountSignerSnapshot[];
    settings?: {
      signers: SmartAccountSigner[];
      threshold: number;
      timeLock: number;
      transactionIndex?: bigint;
    };
  }): Promise<SmartAccountPolicyOverview> {
    const settingsPdaText = args.settingsPda.toBase58();
    const startedAt = nowMs();
    console.info("[smart-account-vaults] policies.start", {
      settingsPda: settingsPdaText,
      hasRootSignersInput: Boolean(args.rootSigners),
      rootSignersInputCount: args.rootSigners?.length ?? null,
    });
    try {
      const settings =
        args.settings ??
        (args.rootSigners
          ? null
          : await logTimedReadStep(
              "policies.settings-fetch",
              { settingsPda: settingsPdaText },
              () =>
                smartAccountsClient.smartAccounts.queries.fetchSettings(
                  args.settingsPda
                ),
              (result) => ({
                signerCount: result.signers.length,
                threshold: result.threshold,
                transactionIndex: toBigInt(result.transactionIndex).toString(),
              })
            ));
      const settingsTransactionIndex =
        settings?.transactionIndex === undefined
          ? undefined
          : typeof settings.transactionIndex === "bigint"
          ? settings.transactionIndex
          : toBigInt(settings.transactionIndex);
      const shouldScanPolicies =
        settingsTransactionIndex === undefined ||
        settingsTransactionIndex > BigInt(0);
      const policyAccounts = shouldScanPolicies
        ? await logTimedReadStep(
            "policies.policy-account-scan",
            { settingsPda: settingsPdaText },
            () => fetchPolicyAccounts({ settingsPda: args.settingsPda }),
            (result) => ({ accountCount: result.length })
          )
        : [];

      if (!shouldScanPolicies) {
        console.info("[smart-account-vaults] policies.policy-account-skip", {
          settingsPda: settingsPdaText,
          transactionIndex: settingsTransactionIndex?.toString() ?? null,
          reason: "no-settings-transactions",
        });
      }
      const rootSigners =
        args.rootSigners ??
        (settings?.signers ?? []).map((signer) =>
          toSignerSnapshot({
            signer,
            scope: "settings",
            consensusPda: args.settingsPda,
            threshold: settings?.threshold ?? 0,
            timeLock: settings?.timeLock ?? 0,
          })
        );
      const policies = policyAccounts
        .map((entry) => toPolicySnapshot(entry))
        .sort((left, right) =>
          BigInt(left.seed) > BigInt(right.seed) ? 1 : -1
        );
      const assetIndex =
        args.assetIndex ?? new Map<string, PortfolioPosition>();
      const now = Math.floor(Date.now() / 1000);
      const spendingLimits = policyAccounts
        .map((entry) =>
          toSpendingLimitPolicySnapshot({
            address: entry.address,
            assetIndex,
            now,
            policy: entry.policy,
          })
        )
        .filter(
          (entry): entry is SmartAccountSpendingLimitSnapshot => entry !== null
        )
        .sort((left, right) => left.address.localeCompare(right.address));
      const signerLamportInputs = [
        ...rootSigners,
        ...policies.flatMap((policy) => policy.signers),
      ];
      const shouldFetchSignerLamports =
        policies.length > 0 && signerLamportInputs.length > 0;
      const signerLamports = !shouldFetchSignerLamports
        ? new Map<string, number>()
        : await logTimedReadStep(
            "policies.signer-lamports",
            {
              settingsPda: settingsPdaText,
              signerCount: signerLamportInputs.length,
              uniqueSignerCount: new Set(
                signerLamportInputs.map((signer) => signer.address)
              ).size,
            },
            () =>
              fetchSignerLamports({
                connection: config.connection,
                signers: signerLamportInputs,
              }),
            (result) => ({ balanceCount: result.size })
          );
      if (!shouldFetchSignerLamports) {
        console.info("[smart-account-vaults] policies.signer-lamports-skip", {
          settingsPda: settingsPdaText,
          policyCount: policies.length,
          signerCount: signerLamportInputs.length,
        });
      }
      const signers = shouldFetchSignerLamports
        ? withSignerLamports(rootSigners, signerLamports)
        : rootSigners;
      const policiesWithSignerLamports = policies.map((policy) => ({
        ...policy,
        signers: withSignerLamports(policy.signers, signerLamports),
      }));

      return {
        signers,
        policies: policiesWithSignerLamports,
        spendingLimits,
      };
    } finally {
      console.info("[smart-account-vaults] policies.done", {
        settingsPda: settingsPdaText,
        durationMs: Number((nowMs() - startedAt).toFixed(2)),
      });
    }
  }

  async function fetchProposalSnapshots(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    policies?:
      | SmartAccountPolicySnapshot[]
      | Promise<SmartAccountPolicySnapshot[]>;
  }): Promise<SmartAccountProposalSnapshot[]> {
    return listProposals(args);
  }

  async function fetchOverview(args: {
    settingsPda: PublicKey;
    activityLimit?: number;
  }): Promise<SmartAccountOverview> {
    const base = await fetchOverviewBase({ settingsPda: args.settingsPda });
    const vaults = await fetchVaultSnapshots({
      settingsPda: args.settingsPda,
      accountUtilization: base.accountUtilization,
      activityLimit: args.activityLimit,
    });
    const assetIndex = toAssetIndex(vaults);
    const policyOverview = await fetchPolicyOverview({
      settingsPda: args.settingsPda,
      assetIndex,
      rootSigners: base.signers,
    });
    const vaultsWithSigners = attachOverviewDecorations({
      vaults,
      signers: policyOverview.signers,
      policies: policyOverview.policies,
      spendingLimits: policyOverview.spendingLimits,
    });
    const proposals = await fetchProposalSnapshots({
      settingsPda: args.settingsPda,
      assetIndex,
      policies: policyOverview.policies,
    });
    const {
      accountUtilization: _accountUtilization,
      vaults: _baseVaults,
      ...baseOverview
    } = base;

    return {
      ...baseOverview,
      signers: policyOverview.signers,
      policies: policyOverview.policies,
      spendingLimits: policyOverview.spendingLimits,
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

  async function prepareSettingsChange(args: {
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

  async function listRawPolicies(args: { settingsPda: PublicKey }) {
    const policyAccounts = await config.connection.getProgramAccounts(
      smartAccountsClient.programId,
      {
        commitment: "confirmed",
        filters: createPolicyFilters(args.settingsPda),
      }
    );

    return policyAccounts
      .map((account) => deserializePolicyAccount(account))
      .filter((entry) => entry.policy.settings.equals(args.settingsPda))
      .sort((left, right) =>
        toBigInt(left.policy.seed) > toBigInt(right.policy.seed) ? 1 : -1
      );
  }

  type ResolvedEarnYieldRoutingPolicy = {
    account: PublicKey;
    operation?: PreparedLoyalSmartAccountsOperation<string>;
    seed: bigint;
  };

  async function resolveEarnYieldRoutingPolicyForCreation(args: {
    cluster: LoyalCluster;
    feePayer: PublicKey;
    settingsPda: PublicKey;
    signer: PublicKey;
    vaultPda: PublicKey;
    memo?: string;
  }): Promise<ResolvedEarnYieldRoutingPolicy> {
    const nextPolicySeed =
      typeof config.connection.getAccountInfo === "function"
        ? resolveNextPolicySeed(
            await smartAccountsClient.smartAccounts.queries.fetchSettings(
              args.settingsPda
            )
          )
        : {
            bigint: EARN_DEPOSIT_POLICY_SEED,
            number: Number(EARN_DEPOSIT_POLICY_SEED),
          };
    const policyAccount = pda.getPolicyPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      policySeed: nextPolicySeed.number,
    })[0];
    const earnTarget = resolveKaminoEarnTarget(args.cluster);
    const operation =
      await smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
        {
          feePayer: args.feePayer,
          settingsPda: args.settingsPda,
          signers: [args.signer],
          actions: [
            {
              __kind: "PolicyCreate",
              seed: toBn(nextPolicySeed.bigint),
              policyCreationPayload:
                createEarnProgramInteractionPolicyCreationPayload({
                  target: earnTarget,
                  vaultPda: args.vaultPda,
                }),
              signers: [createPolicySigner(args.signer)],
              threshold: 1,
              timeLock: 0,
              startTimestamp: null,
              expirationArgs: null,
            },
          ],
          memo: args.memo,
          remainingAccounts: [
            { pubkey: policyAccount, isWritable: true, isSigner: false },
          ],
        } as never
      );

    return {
      account: policyAccount,
      operation,
      seed: nextPolicySeed.bigint,
    };
  }

  async function resolveEarnYieldRoutingPolicyForExecution(args: {
    settingsPda: PublicKey;
  }): Promise<ResolvedEarnYieldRoutingPolicy> {
    if (typeof config.connection.getProgramAccounts !== "function") {
      return {
        account: pda.getPolicyPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.settingsPda,
          policySeed: Number(EARN_DEPOSIT_POLICY_SEED),
        })[0],
        seed: EARN_DEPOSIT_POLICY_SEED,
      };
    }

    const policies = await listRawPolicies({ settingsPda: args.settingsPda });
    const earnPolicy = policies
      .filter((entry) => {
        const state = entry.policy.policyState;
        return (
          state.__kind === "ProgramInteraction" &&
          state.fields[0].accountIndex === EARN_DEPOSIT_VAULT_INDEX
        );
      })
      .sort((left, right) =>
        toBigInt(left.policy.seed) > toBigInt(right.policy.seed) ? -1 : 1
      )[0];

    if (!earnPolicy) {
      throw new Error("Earn yield-routing policy is not initialized.");
    }

    return {
      account: earnPolicy.address,
      seed: toBigInt(earnPolicy.policy.seed),
    };
  }

  async function resolveAgentPolicy(args: SmartAccountAddSignerProposalInput) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);

    if (args.policyPda) {
      const policy = await smartAccountsClient.policies.queries.fetchPolicy(
        args.policyPda
      );
      if (!policy.settings.equals(args.settingsPda)) {
        throw new Error("Agent policy belongs to another vault.");
      }
      if (policy.policyState.__kind !== "SpendingLimit") {
        throw new Error("Agent policy must be a spending-limit policy.");
      }
      if (policy.policyState.fields[0].sourceAccountIndex !== accountIndex) {
        throw new Error("Agent policy targets another vault account.");
      }

      return {
        address: args.policyPda,
        policy,
      };
    }

    // Default behavior: each signer gets its own SpendingLimit policy so
    // spending limits are independent per signer. Callers that want to
    // append a signer to an existing policy must pass `policyPda` explicitly.
    return null;
  }

  async function resolveAgentPolicyForRemoval(
    args: SmartAccountRemoveSignerProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);

    if (args.policyPda) {
      const policy = await smartAccountsClient.policies.queries.fetchPolicy(
        args.policyPda
      );
      if (!policy.settings.equals(args.settingsPda)) {
        throw new Error("Agent policy belongs to another vault.");
      }
      if (policy.policyState.__kind !== "SpendingLimit") {
        throw new Error("Agent policy must be a spending-limit policy.");
      }
      if (policy.policyState.fields[0].sourceAccountIndex !== accountIndex) {
        throw new Error("Agent policy targets another vault account.");
      }
      if (!policy.signers.some((signer) => signer.key.equals(args.signer))) {
        throw new Error("Signer is not attached to this policy.");
      }

      return {
        address: args.policyPda,
        policy,
      };
    }

    const policies = await listRawPolicies({ settingsPda: args.settingsPda });
    const candidates = policies.filter(
      (entry) =>
        entry.policy.policyState.__kind === "SpendingLimit" &&
        entry.policy.policyState.fields[0].sourceAccountIndex ===
          accountIndex &&
        entry.policy.signers.some((signer) => signer.key.equals(args.signer))
    );

    if (candidates.length === 0) {
      throw new Error("Signer is not connected to this vault.");
    }

    return candidates[0];
  }

  async function prepareAddInitiateSigner(
    args: SmartAccountAddSignerProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const requestedPermissions = args.permissions ?? ["initiate"];
    const policyEntry = await resolveAgentPolicy(args);

    if (policyEntry) {
      const policyCreationBase = toSpendingLimitPolicyCreationBase(
        policyEntry.policy
      );

      return prepareSettingsChange({
        actions: [
          {
            __kind: "PolicyUpdate",
            policy: policyEntry.address,
            signers: withPolicySignerPermissions(
              policyEntry.policy.signers,
              args.signer,
              requestedPermissions
            ),
            threshold: policyEntry.policy.threshold || 1,
            timeLock: policyEntry.policy.timeLock,
            policyUpdatePayload: createSpendingLimitPolicyCreationPayload({
              amount: toBigInt(
                policyCreationBase.quantityConstraints.maxPerPeriod
              ),
              base: policyCreationBase,
            }),
            expirationArgs: null,
          },
        ],
        creator: args.creator,
        feePayer: args.feePayer,
        memo: args.memo,
        operation: "addInitiatePolicySigner",
        policies: [policyEntry.address],
        settingsPda: args.settingsPda,
        spendingLimits: [],
      });
    }

    // No SpendingLimit policy exists for this vault yet (fresh vault). Bundle a
    // PolicyCreate with the new signer so they can be authorized before the
    // owner configures actual spend limits. Defaults to a zero-amount monthly
    // SOL policy that the owner can edit later via the spending-limit flow.
    const flags = toPermissionFlags(requestedPermissions);
    if (flags.length === 0) {
      throw new Error("Signer must have at least one permission.");
    }
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const policyCreationPayload = createSpendingLimitPolicyCreationPayload({
      accountIndex,
      amount: BigInt(0),
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

    return prepareSettingsChange({
      actions: [
        {
          __kind: "PolicyCreate",
          seed: toBn(nextPolicySeed.bigint),
          policyCreationPayload,
          signers: [
            {
              key: args.signer,
              permissions: Permissions.fromPermissions(flags),
            },
          ],
          threshold: 1,
          timeLock: 0,
          startTimestamp: null,
          expirationArgs: null,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "createSpendingLimitPolicyForSigner",
      policies: [newPolicyPda],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareUpdatePolicySignerPermissions(
    args: SmartAccountUpdateSignerPermissionsInput & {
      policyPda?: PublicKey | null;
      accountIndex?: number;
    }
  ): Promise<SmartAccountPreparedSettingsChange> {
    const flags: Permission[] = [];
    if (args.permissions.includes("initiate")) {
      flags.push(Permission.Initiate);
    }
    if (args.permissions.includes("vote")) {
      flags.push(Permission.Vote);
    }
    if (args.permissions.includes("execute")) {
      flags.push(Permission.Execute);
    }

    if (flags.length === 0) {
      throw new Error("Signer must keep at least one permission.");
    }

    const policyEntry = await resolveAgentPolicyForRemoval({
      settingsPda: args.settingsPda,
      creator: args.creator,
      feePayer: args.feePayer,
      signer: args.signer,
      policyPda: args.policyPda ?? null,
      accountIndex: args.accountIndex,
      memo: args.memo,
    });

    const nextPermissions = Permissions.fromPermissions(flags);
    const nextSigners = policyEntry.policy.signers.map((entry) =>
      entry.key.equals(args.signer)
        ? { ...entry, permissions: nextPermissions }
        : entry
    );

    const policyCreationBase = toSpendingLimitPolicyCreationBase(
      policyEntry.policy
    );

    return prepareSettingsChange({
      actions: [
        {
          __kind: "PolicyUpdate",
          policy: policyEntry.address,
          signers: nextSigners,
          threshold: policyEntry.policy.threshold || 1,
          timeLock: policyEntry.policy.timeLock,
          policyUpdatePayload: createSpendingLimitPolicyCreationPayload({
            amount: toBigInt(
              policyCreationBase.quantityConstraints.maxPerPeriod
            ),
            base: policyCreationBase,
          }),
          expirationArgs: null,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "updatePolicySignerPermissions",
      policies: [policyEntry.address],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareUpdateSignerPermissions(
    args: SmartAccountUpdateSignerPermissionsInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const flags: Permission[] = [];
    if (args.permissions.includes("initiate")) {
      flags.push(Permission.Initiate);
    }
    if (args.permissions.includes("vote")) {
      flags.push(Permission.Vote);
    }
    if (args.permissions.includes("execute")) {
      flags.push(Permission.Execute);
    }

    if (flags.length === 0) {
      throw new Error("Signer must keep at least one permission.");
    }

    return prepareSettingsChange({
      actions: [
        { __kind: "RemoveSigner", oldSigner: args.signer },
        {
          __kind: "AddSigner",
          newSigner: {
            key: args.signer,
            permissions: Permissions.fromPermissions(flags),
          },
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "updateSignerPermissions",
      policies: [],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareRemoveInitiateSigner(
    args: SmartAccountRemoveSignerProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const policyEntry = await resolveAgentPolicyForRemoval(args);
    const nextSigners = withoutPolicySigner(
      policyEntry.policy.signers,
      args.signer
    );

    if (nextSigners.length === 0) {
      return prepareSettingsChange({
        actions: [
          {
            __kind: "PolicyRemove",
            policy: policyEntry.address,
          },
        ],
        creator: args.creator,
        feePayer: args.feePayer,
        memo: args.memo,
        operation: "removeInitiatePolicySigner",
        policies: [policyEntry.address],
        settingsPda: args.settingsPda,
        spendingLimits: [],
      });
    }

    const policyCreationBase = toSpendingLimitPolicyCreationBase(
      policyEntry.policy
    );

    return prepareSettingsChange({
      actions: [
        {
          __kind: "PolicyUpdate",
          policy: policyEntry.address,
          signers: nextSigners,
          threshold: Math.max(
            1,
            Math.min(policyEntry.policy.threshold || 1, nextSigners.length)
          ),
          timeLock: policyEntry.policy.timeLock,
          policyUpdatePayload: createSpendingLimitPolicyCreationPayload({
            amount: toBigInt(
              policyCreationBase.quantityConstraints.maxPerPeriod
            ),
            base: policyCreationBase,
          }),
          expirationArgs: null,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "removeInitiatePolicySigner",
      policies: [policyEntry.address],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
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
        throw new Error(
          "Existing spending-limit policy belongs to another vault."
        );
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

    return prepareSettingsChange({
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
    return prepareSettingsChange({
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

  async function prepareEarnUsdcDeposit(
    args: SmartAccountEarnUsdcDepositInput
  ): Promise<SmartAccountPreparedEarnUsdcDeposit> {
    if (args.amountRaw <= BigInt(0)) {
      throw new Error("Earn deposit amount must be greater than 0.");
    }

    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const earnTarget = resolveKaminoEarnTarget(cluster);
    const usdcMint = earnTarget.liquidityMint;
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const vaultCollateralAta = earnTarget.reserveCollateralMint
      ? getAssociatedTokenAddressSync(
          earnTarget.reserveCollateralMint,
          vaultPda,
          true,
          TOKEN_PROGRAM_ID
        )
      : null;
    const shouldInitializeYieldRoutingPolicy =
      args.initializeYieldRoutingPolicy ?? true;
    const policyInitialization = shouldInitializeYieldRoutingPolicy
      ? "create"
      : "reuse";
    const earnPolicy = shouldInitializeYieldRoutingPolicy
      ? await resolveEarnYieldRoutingPolicyForCreation({
          cluster,
          feePayer: args.feePayer,
          settingsPda: args.settingsPda,
          signer: args.walletAddress,
          vaultPda,
          memo: args.memo,
        })
      : await resolveEarnYieldRoutingPolicyForExecution({
          settingsPda: args.settingsPda,
        });
    const policyAccount = earnPolicy.account;
    const kaminoDepositInstruction =
      cluster === LoyalCluster.Devnet
        ? createLocalKaminoDepositInstruction({
            amountRaw: args.amountRaw,
            target: earnTarget,
            vaultPda,
            vaultUsdcAta,
            vaultCollateralAta: vaultCollateralAta!,
          })
        : await fetchKaminoDepositInstruction({
            amountRaw: args.amountRaw,
            lendProgramId: earnTarget.lendProgramId,
            market: earnTarget.market,
            reserve: earnTarget.reserve,
            wallet: vaultPda,
          });
    const compiledKaminoPayload = instructionsToSynchronousTransactionDetailsV2(
      {
        vaultPda,
        members: [args.walletAddress],
        transaction_instructions: [kaminoDepositInstruction],
      }
    );
    const policyPayload: generated.PolicyPayload = {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices: Uint8Array.from(
            [EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES[1]]
          ),
          transactionPayload: {
            __kind: "SyncTransaction",
            fields: [
              {
                accountIndex: EARN_DEPOSIT_VAULT_INDEX,
                instructions: compiledKaminoPayload.instructions,
              },
            ],
          },
        },
      ],
    };
    const policyInitializationOperation = earnPolicy.operation ?? null;
    const policyExecution =
      await smartAccountsClient.features.execution.prepare.executePolicyPayloadSync(
        {
          feePayer: args.feePayer,
          policy: policyAccount,
          accountIndex: EARN_DEPOSIT_VAULT_INDEX,
          numSigners: 1,
          policyPayload,
          instruction_accounts: compiledKaminoPayload.accounts,
          memo: args.memo,
        } as never
      );
    const policyOperations = [
      ...(policyInitializationOperation ? [policyInitializationOperation] : []),
      policyExecution,
    ];
    const prepared = freezePreparedOperation({
      operation: "earnUsdcDeposit",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      requiresConfirmation: true,
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          args.feePayer,
          vaultUsdcAta,
          vaultPda,
          usdcMint,
          TOKEN_PROGRAM_ID
        ),
        createTransferCheckedInstruction(
          walletUsdcAta,
          usdcMint,
          vaultUsdcAta,
          args.walletAddress,
          args.amountRaw,
          EARN_DEPOSIT_USDC_DECIMALS,
          [],
          TOKEN_PROGRAM_ID
        ),
        ...policyOperations.flatMap((operation) => operation.instructions),
      ],
      lookupTableAccounts: dedupeLookupTableAccounts(
        policyOperations.flatMap(
          (operation) => operation.lookupTableAccounts ?? []
        )
      ),
    });

    return {
      prepared,
      policy: {
        account: policyAccount,
        id: earnPolicy.seed,
        seed: earnPolicy.seed,
        sameMintInstructionConstraintIndexes:
          EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES,
      },
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
        usdcAta: vaultUsdcAta,
      },
      targetReserve: {
        reserve: earnTarget.reserve,
        market: earnTarget.market,
        liquidityMint: usdcMint,
        supplyApyBps: null,
      },
      persistence: {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        settings: args.settingsPda.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyId: earnPolicy.seed.toString(),
        policyAccount: policyAccount.toBase58(),
        policySeed: earnPolicy.seed.toString(),
        targetReserve: earnTarget.reserve.toBase58(),
        market: earnTarget.market.toBase58(),
        liquidityMint: usdcMint.toBase58(),
        depositMint: usdcMint.toBase58(),
        principalAmountRaw: args.amountRaw.toString(),
        policyInitialization,
        targetSupplyApyBps: null,
      },
    };
  }

  async function prepareEarnUsdcYieldRoutingPolicy(
    args: SmartAccountEarnUsdcYieldRoutingPolicyInput
  ): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const earnTarget = resolveKaminoEarnTarget(cluster);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const nextPolicySeed = resolveNextPolicySeed(settings);
    const policyAccount = pda.getPolicyPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      policySeed: nextPolicySeed.number,
    })[0];

    return smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
      {
        feePayer: args.feePayer,
        settingsPda: args.settingsPda,
        signers: [args.signer],
        actions: [
          {
            __kind: "PolicyCreate",
            seed: toBn(nextPolicySeed.bigint),
            policyCreationPayload:
              createEarnProgramInteractionPolicyCreationPayload({
                target: earnTarget,
                vaultPda,
              }),
            signers: [createPolicySigner(args.signer)],
            threshold: 1,
            timeLock: 0,
            startTimestamp: null,
            expirationArgs: null,
          },
        ],
        memo: args.memo,
        remainingAccounts: [
          { pubkey: policyAccount, isWritable: true, isSigner: false },
        ],
      } as never
    );
  }

  async function prepareEarnUsdcWithdraw(
    args: SmartAccountEarnUsdcWithdrawInput
  ): Promise<SmartAccountPreparedEarnUsdcWithdraw> {
    if (args.amountRaw <= BigInt(0)) {
      throw new Error("Earn withdraw amount must be greater than 0.");
    }

    if (args.mode !== "partial" && args.mode !== "full") {
      throw new Error("Earn withdraw mode must be partial or full.");
    }

    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const earnTarget = resolveKaminoEarnTarget(cluster);
    const usdcMint = earnTarget.liquidityMint;
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const localVaultCollateralAta = earnTarget.reserveCollateralMint
      ? getAssociatedTokenAddressSync(
          earnTarget.reserveCollateralMint,
          vaultPda,
          true,
          TOKEN_PROGRAM_ID
        )
      : null;
    const earnPolicy = await resolveEarnYieldRoutingPolicyForExecution({
      settingsPda: args.settingsPda,
    });
    const policyAccount = earnPolicy.account;
    const kaminoWithdrawInstruction =
      cluster === LoyalCluster.Devnet
        ? createLocalKaminoWithdrawInstruction({
            amountRaw: args.amountRaw,
            target: earnTarget,
            vaultPda,
            vaultUsdcAta,
            vaultCollateralAta: localVaultCollateralAta!,
          })
        : await fetchKaminoWithdrawInstruction({
            amountRaw: args.amountRaw,
            lendProgramId: earnTarget.lendProgramId,
            market: earnTarget.market,
            reserve: earnTarget.reserve,
            wallet: vaultPda,
          });
    const { vaultCollateralAta } = validateKaminoWithdrawInstruction({
      instruction: kaminoWithdrawInstruction,
      lendProgramId: earnTarget.lendProgramId,
      vaultPda,
      vaultUsdcAta,
      market: earnTarget.market,
      reserve: earnTarget.reserve,
      liquidityMint: usdcMint,
    });
    const compiledKaminoPayload = instructionsToSynchronousTransactionDetailsV2(
      {
        vaultPda,
        members: [args.walletAddress],
        transaction_instructions: [kaminoWithdrawInstruction],
      }
    );
    const policyPayload: generated.PolicyPayload = {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices: Uint8Array.from([
            EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES[0],
          ]),
          transactionPayload: {
            __kind: "SyncTransaction",
            fields: [
              {
                accountIndex: EARN_DEPOSIT_VAULT_INDEX,
                instructions: compiledKaminoPayload.instructions,
              },
            ],
          },
        },
      ],
    };
    const policyExecution =
      await smartAccountsClient.features.execution.prepare.executePolicyPayloadSync(
        {
          feePayer: args.feePayer,
          policy: policyAccount,
          accountIndex: EARN_DEPOSIT_VAULT_INDEX,
          numSigners: 1,
          policyPayload,
          instruction_accounts: compiledKaminoPayload.accounts,
          memo: args.memo,
        } as never
      );
    const vaultInstructions: TransactionInstruction[] = [
      makeSignerWritable(
        createTransferCheckedInstruction(
          vaultUsdcAta,
          usdcMint,
          walletUsdcAta,
          vaultPda,
          args.amountRaw,
          EARN_DEPOSIT_USDC_DECIMALS,
          [],
          TOKEN_PROGRAM_ID
        ),
        vaultPda
      ),
    ];

    const compiledVaultPayload = instructionsToSynchronousTransactionDetailsV2({
      vaultPda,
      members: [args.walletAddress],
      transaction_instructions: vaultInstructions,
    });
    const vaultTransfer =
      await smartAccountsClient.features.execution.prepare.executeTransactionSyncV2(
        {
          feePayer: args.feePayer,
          settingsPda: args.settingsPda,
          accountIndex: EARN_DEPOSIT_VAULT_INDEX,
          numSigners: 1,
          instructions: compiledVaultPayload.instructions,
          instruction_accounts: compiledVaultPayload.accounts,
        } as never
      );
    const operations: PreparedLoyalSmartAccountsOperation<string>[] = [
      policyExecution,
      vaultTransfer,
    ];

    if (args.mode === "full") {
      operations.push(
        await prepareCloseYieldRoutingPoliciesSync({
          settingsPda: args.settingsPda,
          feePayer: args.feePayer,
          signers: [args.walletAddress],
          policies: [policyAccount],
          memo: args.memo,
        })
      );
    }

    const prepared = freezePreparedOperation({
      operation: "earnUsdcWithdraw",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      requiresConfirmation: true,
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          args.feePayer,
          walletUsdcAta,
          args.walletAddress,
          usdcMint,
          TOKEN_PROGRAM_ID
        ),
        ...operations.flatMap((operation) => operation.instructions),
      ],
      lookupTableAccounts: dedupeLookupTableAccounts(
        operations.flatMap((operation) => operation.lookupTableAccounts ?? [])
      ),
    });

    return {
      prepared,
      mode: args.mode,
      amountRaw: args.amountRaw,
      policy: {
        account: policyAccount,
        id: earnPolicy.seed,
        seed: earnPolicy.seed,
        withdrawInstructionConstraintIndex: 0,
        sameMintInstructionConstraintIndexes:
          EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES,
      },
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
        usdcAta: vaultUsdcAta,
        collateralAta: vaultCollateralAta,
      },
      targetReserve: {
        reserve: earnTarget.reserve,
        market: earnTarget.market,
        liquidityMint: usdcMint,
      },
      persistence: {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        settings: args.settingsPda.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyId: earnPolicy.seed.toString(),
        policyAccount: policyAccount.toBase58(),
        policySeed: earnPolicy.seed.toString(),
        targetReserve: earnTarget.reserve.toBase58(),
        market: earnTarget.market.toBase58(),
        liquidityMint: usdcMint.toBase58(),
        withdrawnAmountRaw: args.amountRaw.toString(),
        mode: args.mode,
      },
    };
  }

  async function prepareClosePolicies(
    args: SmartAccountClosePoliciesProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const policies = await resolvePoliciesForClose({
      policies: args.policies,
      settingsPda: args.settingsPda,
    });

    return prepareSettingsChange({
      actions: policies.map((policy) => ({
        __kind: "PolicyRemove",
        policy,
      })),
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "closePolicies",
      policies,
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareClosePoliciesSync(
    args: SmartAccountClosePoliciesSyncInput
  ): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    if (args.signers.length === 0) {
      throw new Error("At least one signer is required.");
    }

    const policies = await resolvePoliciesForClose({
      policies: args.policies,
      settingsPda: args.settingsPda,
    });

    return smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
      {
        feePayer: args.feePayer,
        settingsPda: args.settingsPda,
        signers: dedupePublicKeys(args.signers),
        actions: policies.map((policy) => ({
          __kind: "PolicyRemove",
          policy,
        })),
        memo: args.memo,
        remainingAccounts: toWritableAccountMetas(policies),
      } as never
    );
  }

  async function prepareCloseYieldRoutingPolicies(
    args: SmartAccountClosePoliciesProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const policies = await resolveYieldRoutingPoliciesForClose({
      policies: args.policies,
      settingsPda: args.settingsPda,
    });

    return prepareSettingsChange({
      actions: policies.map((policy) => ({
        __kind: "PolicyRemove",
        policy,
      })),
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "closeYieldRoutingPolicies",
      policies,
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareCloseYieldRoutingPoliciesSync(
    args: SmartAccountClosePoliciesSyncInput
  ): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    if (args.signers.length === 0) {
      throw new Error("At least one signer is required.");
    }

    const policies = await resolveYieldRoutingPoliciesForClose({
      policies: args.policies,
      settingsPda: args.settingsPda,
    });

    return smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
      {
        feePayer: args.feePayer,
        settingsPda: args.settingsPda,
        signers: dedupePublicKeys(args.signers),
        actions: policies.map((policy) => ({
          __kind: "PolicyRemove",
          policy,
        })),
        memo: args.memo,
        remainingAccounts: toWritableAccountMetas(policies),
      } as never
    );
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

    return smartAccountsClient.features.execution.prepare.executePolicyPayloadSync(
      {
        feePayer: args.feePayer,
        policy: args.spendingLimitPolicy,
        accountIndex,
        numSigners: 1,
        policyPayload,
        instruction_accounts: instructionAccounts,
        memo: args.memo,
      } as never
    );
  }

  async function resolveMintTokenProgramId(
    mint: PublicKey
  ): Promise<PublicKey> {
    const mintAccount = await config.connection.getAccountInfo(
      mint,
      "confirmed"
    );

    if (!mintAccount) {
      throw new Error(`Token mint account ${mint.toBase58()} was not found.`);
    }

    if (
      mintAccount.owner.equals(TOKEN_PROGRAM_ID) ||
      mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)
    ) {
      return mintAccount.owner;
    }

    throw new Error(
      `Token mint account ${mint.toBase58()} is not owned by a supported token program.`
    );
  }

  async function getSpendingLimitPolicyExecutionAccounts(args: {
    policy: Policy;
    policyPayload: generated.PolicyPayload & { __kind: "SpendingLimit" };
  }): Promise<{
    accountMetas: AccountMeta[];
    lookupTableAccounts: AddressLookupTableAccount[];
  }> {
    const policyState = args.policy.policyState;

    if (policyState.__kind !== "SpendingLimit") {
      throw new Error(
        "Stored policy transaction is not a spending-limit policy."
      );
    }

    const payload = args.policyPayload.fields[0];
    const spendingLimitPolicy = policyState.fields[0];
    const sourceSmartAccountPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.policy.settings,
      accountIndex: spendingLimitPolicy.sourceAccountIndex,
    })[0];
    const accountMetas: AccountMeta[] = [];

    if (args.policy.expiration?.__kind === "SettingsState") {
      accountMetas.push({
        pubkey: args.policy.settings,
        isSigner: false,
        isWritable: false,
      });
    }

    if (spendingLimitPolicy.spendingLimit.mint.equals(PublicKey.default)) {
      accountMetas.push(
        {
          pubkey: sourceSmartAccountPda,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: payload.destination,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        }
      );

      return {
        accountMetas,
        lookupTableAccounts: [],
      };
    }

    const mint = spendingLimitPolicy.spendingLimit.mint;
    const tokenProgramId = await resolveMintTokenProgramId(mint);
    const sourceTokenAccount = getAssociatedTokenAddressSync(
      mint,
      sourceSmartAccountPda,
      true,
      tokenProgramId
    );
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      mint,
      payload.destination,
      true,
      tokenProgramId
    );

    accountMetas.push(
      {
        pubkey: sourceSmartAccountPda,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: payload.destination,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: mint,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: sourceTokenAccount,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: destinationTokenAccount,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: tokenProgramId,
        isSigner: false,
        isWritable: false,
      }
    );

    return {
      accountMetas,
      lookupTableAccounts: [],
    };
  }

  async function getProgramInteractionPolicyExecutionAccounts(args: {
    policy: Policy;
    policyPayload: generated.PolicyPayload & { __kind: "ProgramInteraction" };
    transactionPda: PublicKey;
  }): Promise<{
    accountMetas: AccountMeta[];
    lookupTableAccounts: AddressLookupTableAccount[];
  }> {
    const transactionPayload = args.policyPayload.fields[0].transactionPayload;

    if (transactionPayload.__kind !== "AsyncTransaction") {
      throw new Error(
        "Only async program-interaction policy transactions can be executed from a stored proposal."
      );
    }

    const details = transactionPayload.fields[0];
    const [message] = transactionMessageBeet.deserialize(
      Buffer.from(details.transactionMessage),
      0
    );
    const sourceSmartAccountPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.policy.settings,
      accountIndex: details.accountIndex,
    })[0];
    const executionAccounts = await accountsForTransactionExecute({
      connection: config.connection,
      message: toGeneratedTransactionMessage(message),
      ephemeralSignerBumps: Array.from(
        { length: details.ephemeralSigners },
        () => 0
      ),
      smartAccountPda: sourceSmartAccountPda,
      transactionPda: args.transactionPda,
      programId: smartAccountsClient.programId,
    });

    if (args.policy.expiration?.__kind === "SettingsState") {
      executionAccounts.accountMetas.unshift({
        pubkey: args.policy.settings,
        isSigner: false,
        isWritable: false,
      });
    }

    return executionAccounts;
  }

  async function resolvePoliciesForClose(args: {
    policies: PublicKey[];
    settingsPda: PublicKey;
  }): Promise<PublicKey[]> {
    const policies = dedupePublicKeys(args.policies);

    if (policies.length === 0) {
      throw new Error("At least one policy is required.");
    }

    const policyAccounts = await Promise.all(
      policies.map((policyPda) =>
        smartAccountsClient.policies.queries.fetchPolicy(policyPda)
      )
    );

    for (const policy of policyAccounts) {
      if (!policy.settings.equals(args.settingsPda)) {
        throw new Error("Policy belongs to another vault.");
      }
    }

    return policies;
  }

  async function resolveYieldRoutingPoliciesForClose(args: {
    policies: PublicKey[];
    settingsPda: PublicKey;
  }): Promise<PublicKey[]> {
    const policies = await resolvePoliciesForClose(args);
    const policyAccounts = await Promise.all(
      policies.map((policyPda) =>
        smartAccountsClient.policies.queries.fetchPolicy(policyPda)
      )
    );

    for (const policy of policyAccounts) {
      if (policy.policyState.__kind !== "ProgramInteraction") {
        throw new Error(
          "Yield routing cleanup only accepts program-interaction policies."
        );
      }
    }

    return policies;
  }

  async function getPolicyTransactionExecutionAccounts(args: {
    policy: Policy;
    policyPayload: generated.PolicyPayload;
    transactionPda: PublicKey;
  }): Promise<{
    accountMetas: AccountMeta[];
    lookupTableAccounts: AddressLookupTableAccount[];
  }> {
    if (args.policyPayload.__kind === "SpendingLimit") {
      return getSpendingLimitPolicyExecutionAccounts({
        policy: args.policy,
        policyPayload: args.policyPayload,
      });
    }

    if (args.policyPayload.__kind === "ProgramInteraction") {
      return getProgramInteractionPolicyExecutionAccounts({
        policy: args.policy,
        policyPayload: args.policyPayload,
        transactionPda: args.transactionPda,
      });
    }

    throw new Error(
      `Policy payload ${args.policyPayload.__kind} cannot be executed from the wallet sidebar.`
    );
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

  async function prepareExecutePolicyProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    const transactionPda = pda.getTransactionPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      transactionIndex: args.transactionIndex,
    })[0];
    const transaction =
      await smartAccountsClient.execution.queries.fetchTransaction(
        transactionPda
      );

    if (transaction.payload.__kind !== "PolicyPayload") {
      throw new Error("Stored transaction is not a policy transaction.");
    }

    const policy = await smartAccountsClient.policies.queries.fetchPolicy(
      args.settingsPda
    );
    const policyPayload = (transaction.payload as PolicyPayloadLike).fields[0]
      .payload;
    const executionAccounts = await getPolicyTransactionExecutionAccounts({
      policy,
      policyPayload,
      transactionPda,
    });
    const instruction = buildExecutePolicyTransactionInstruction({
      feePayer: args.feePayer,
      policy: args.settingsPda,
      transactionIndex: args.transactionIndex,
      signer: args.signer,
      anchorRemainingAccounts: executionAccounts.accountMetas,
      programId: smartAccountsClient.programId,
    });

    return freezePreparedOperation({
      operation: "executePolicyTransaction",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      requiresConfirmation: true,
      instructions: [instruction],
      lookupTableAccounts: executionAccounts.lookupTableAccounts,
    });
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
    fetchOverviewBase,
    fetchVaultSnapshots,
    fetchPolicyOverview,
    fetchProposalSnapshots,
    fetchOverview,
    prepareSolTransferProposal,
    prepareSplTransferProposal,
    prepareCustomInstructionProposal,
    preparePolicyCustomInstructionProposal,
    prepareAddInitiateSigner,
    prepareRemoveInitiateSigner,
    prepareUpdateSignerPermissions,
    prepareUpdatePolicySignerPermissions,
    prepareSetSpendingLimitPolicy,
    prepareSetSpendingLimitProposal: prepareSetSpendingLimitPolicy,
    prepareRemoveSpendingLimitPolicy,
    prepareRemoveSpendingLimitProposal: prepareRemoveSpendingLimitPolicy,
    prepareEarnUsdcYieldRoutingPolicy,
    prepareEarnUsdcDeposit,
    prepareEarnUsdcWithdraw,
    prepareClosePolicies,
    prepareClosePolicy: (args: SmartAccountClosePolicyProposalInput) =>
      prepareClosePolicies({
        ...args,
        policies: [args.policy],
      }),
    prepareClosePoliciesSync,
    prepareClosePolicySync: (args: SmartAccountClosePolicySyncInput) =>
      prepareClosePoliciesSync({
        ...args,
        policies: [args.policy],
      }),
    prepareCloseYieldRoutingPolicies,
    prepareCloseYieldRoutingPolicy: (
      args: SmartAccountClosePolicyProposalInput
    ) =>
      prepareCloseYieldRoutingPolicies({
        ...args,
        policies: [args.policy],
      }),
    prepareCloseYieldRoutingPoliciesSync,
    prepareCloseYieldRoutingPolicySync: (
      args: SmartAccountClosePolicySyncInput
    ) =>
      prepareCloseYieldRoutingPoliciesSync({
        ...args,
        policies: [args.policy],
      }),
    prepareUseSolSpendingLimitPolicy,
    prepareUseSolSpendingLimit: prepareUseSolSpendingLimitPolicy,
    prepareApproveProposal,
    prepareRejectProposal,
    prepareExecuteProposal,
    prepareExecuteSettingsProposal,
    prepareExecutePolicyProposal,
  };
}
