import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableInstruction,
  AddressLookupTableProgram,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  type AccountMeta,
  type MessageCompiledInstruction,
  type MessageV0,
} from "@solana/web3.js";
import { Buffer } from "buffer";

export type PublicKeyLike = PublicKey | string | { toBase58(): string };

export type SolanaInstructionAccountInput = {
  pubkey: PublicKeyLike;
  isSigner?: boolean;
  isWritable?: boolean;
  label?: string;
};

export type SolanaInstructionInput = {
  programId: PublicKeyLike;
  keys?: readonly SolanaInstructionAccountInput[];
  data?: Uint8Array | number[] | string;
};

export type DecodedSolanaInstructionDetail = {
  label: string;
  value: string;
};

export type DecodedSolanaInstructionAccount = {
  address: string;
  label: string | null;
  isSigner: boolean;
  isWritable: boolean;
};

export type DecodedSolanaInstruction = {
  programId: string;
  programName: string;
  instructionName: string;
  title: string;
  description: string;
  accounts: DecodedSolanaInstructionAccount[];
  details: DecodedSolanaInstructionDetail[];
  rawDataBase64: string;
  rawDataHex: string;
  warnings: string[];
};

export type DecodedSolanaTransaction = {
  version: "legacy" | "v0" | "unknown";
  instructions: DecodedSolanaInstruction[];
  rawTransactionBase64: string;
  error: string | null;
};

export type DecodedMessagePayload = {
  value: string;
  encoding: "utf8" | "hex";
};

const SMART_ACCOUNT_PROGRAM_ID = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
const JUPITER_V6_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const ORCA_WHIRLPOOL_PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const MEMO_LEGACY_PROGRAM_ID = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";
const ED25519_PROGRAM_ID = "Ed25519SigVerify111111111111111111111111111";
const SECP256K1_PROGRAM_ID = "KeccakSecp256k11111111111111111111111111111";

const KNOWN_PROGRAMS: Record<string, string> = {
  [SystemProgram.programId.toBase58()]: "System Program",
  [TOKEN_PROGRAM_ID.toBase58()]: "Token Program",
  [TOKEN_2022_PROGRAM_ID.toBase58()]: "Token-2022 Program",
  [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()]: "Associated Token Program",
  [ComputeBudgetProgram.programId.toBase58()]: "Compute Budget Program",
  [AddressLookupTableProgram.programId.toBase58()]:
    "Address Lookup Table Program",
  [SMART_ACCOUNT_PROGRAM_ID]: "Smart Account Program",
  [JUPITER_V6_PROGRAM_ID]: "Jupiter v6",
  [ORCA_WHIRLPOOL_PROGRAM_ID]: "Orca Whirlpool",
  [MEMO_PROGRAM_ID]: "Memo Program",
  [MEMO_LEGACY_PROGRAM_ID]: "Memo Program",
  [ED25519_PROGRAM_ID]: "Ed25519 Program",
  [SECP256K1_PROGRAM_ID]: "Secp256k1 Program",
};

type SmartAccountInstructionDefinition = {
  discriminator: readonly number[];
  instructionName: string;
  title: string;
  accountLabels?: readonly string[];
};

const VOTE_ACCOUNT_LABELS = [
  "Consensus account",
  "Signer",
  "Proposal",
  "System program",
  "Smart account program",
] as const;

const CREATE_TRANSACTION_LABELS = [
  "Consensus account",
  "Transaction",
  "Creator",
  "Rent payer",
  "System program",
  "Smart account program",
] as const;

const CREATE_PROPOSAL_LABELS = [
  "Consensus account",
  "Proposal",
  "Creator",
  "Rent payer",
  "System program",
  "Smart account program",
] as const;

const SMART_ACCOUNT_INSTRUCTIONS: readonly SmartAccountInstructionDefinition[] =
  [
    {
      discriminator: [90, 186, 203, 234, 70, 185, 191, 21],
      instructionName: "ActivateProposal",
      title: "Activate smart account proposal",
      accountLabels: ["Consensus account", "Signer", "Proposal", "Program"],
    },
    {
      discriminator: [136, 108, 102, 85, 98, 114, 7, 147],
      instructionName: "ApproveProposal",
      title: "Approve smart account proposal",
      accountLabels: VOTE_ACCOUNT_LABELS,
    },
    {
      discriminator: [114, 162, 164, 82, 191, 11, 102, 25],
      instructionName: "RejectProposal",
      title: "Reject smart account proposal",
      accountLabels: VOTE_ACCOUNT_LABELS,
    },
    {
      discriminator: [106, 74, 128, 146, 19, 65, 39, 23],
      instructionName: "CancelProposal",
      title: "Cancel smart account proposal",
      accountLabels: VOTE_ACCOUNT_LABELS,
    },
    {
      discriminator: [231, 173, 49, 91, 235, 24, 68, 19],
      instructionName: "ExecuteTransaction",
      title: "Execute smart account transaction",
      accountLabels: [
        "Consensus account",
        "Proposal",
        "Transaction",
        "Signer",
        "Smart account program",
      ],
    },
    {
      discriminator: [43, 102, 248, 89, 231, 97, 104, 134],
      instructionName: "ExecuteTransactionSync",
      title: "Execute smart account transaction",
      accountLabels: ["Consensus account", "Smart account program"],
    },
    {
      discriminator: [90, 81, 187, 81, 39, 70, 128, 78],
      instructionName: "ExecuteTransactionSyncV2",
      title: "Execute smart account transaction",
      accountLabels: ["Consensus account", "Smart account program"],
    },
    {
      discriminator: [131, 210, 27, 88, 27, 204, 143, 189],
      instructionName: "ExecuteSettingsTransaction",
      title: "Execute smart account settings change",
      accountLabels: [
        "Settings",
        "Signer",
        "Proposal",
        "Transaction",
        "Rent payer",
        "System program",
        "Smart account program",
      ],
    },
    {
      discriminator: [138, 209, 64, 163, 79, 67, 233, 76],
      instructionName: "ExecuteSettingsTransactionSync",
      title: "Execute smart account settings change",
      accountLabels: ["Settings", "Smart account program"],
    },
    {
      discriminator: [132, 116, 68, 174, 216, 160, 198, 22],
      instructionName: "CreateProposal",
      title: "Create smart account proposal",
      accountLabels: CREATE_PROPOSAL_LABELS,
    },
    {
      discriminator: [227, 193, 53, 239, 55, 126, 112, 105],
      instructionName: "CreateTransaction",
      title: "Create smart account transaction",
      accountLabels: CREATE_TRANSACTION_LABELS,
    },
    {
      discriminator: [101, 168, 254, 203, 222, 102, 95, 192],
      instructionName: "CreateSettingsTransaction",
      title: "Create smart account settings transaction",
      accountLabels: [
        "Settings",
        "Transaction",
        "Creator",
        "Rent payer",
        "System program",
        "Smart account program",
      ],
    },
    {
      discriminator: [41, 179, 70, 5, 194, 147, 239, 158],
      instructionName: "UseSpendingLimit",
      title: "Use spending limit",
      accountLabels: [
        "Settings",
        "Signer",
        "Spending limit",
        "Smart account",
        "Destination",
        "System program",
        "Mint",
        "Smart account token account",
        "Destination token account",
        "Token program",
        "Smart account program",
      ],
    },
    {
      discriminator: [197, 102, 253, 231, 77, 84, 50, 17],
      instructionName: "CreateSmartAccount",
      title: "Create smart account",
    },
    {
      discriminator: [80, 198, 228, 154, 7, 234, 99, 56],
      instructionName: "AddSignerAsAuthority",
      title: "Add smart account signer",
    },
    {
      discriminator: [58, 19, 149, 16, 181, 16, 125, 148],
      instructionName: "RemoveSignerAsAuthority",
      title: "Remove smart account signer",
    },
    {
      discriminator: [169, 189, 84, 54, 30, 244, 223, 212],
      instructionName: "AddSpendingLimitAsAuthority",
      title: "Add spending limit policy",
    },
    {
      discriminator: [94, 32, 68, 127, 251, 44, 145, 7],
      instructionName: "RemoveSpendingLimitAsAuthority",
      title: "Remove spending limit policy",
    },
    {
      discriminator: [51, 141, 78, 133, 70, 47, 95, 124],
      instructionName: "ChangeThresholdAsAuthority",
      title: "Change smart account threshold",
    },
    {
      discriminator: [2, 234, 93, 93, 40, 92, 31, 234],
      instructionName: "SetTimeLockAsAuthority",
      title: "Set smart account time lock",
    },
    {
      discriminator: [159, 198, 248, 43, 248, 31, 235, 86],
      instructionName: "CreateBatch",
      title: "Create smart account batch",
    },
    {
      discriminator: [147, 75, 197, 227, 20, 149, 150, 113],
      instructionName: "AddTransactionToBatch",
      title: "Add transaction to batch",
    },
    {
      discriminator: [237, 67, 201, 173, 33, 130, 88, 134],
      instructionName: "ExecuteBatchTransaction",
      title: "Execute batch transaction",
    },
    {
      discriminator: [57, 97, 250, 156, 59, 211, 32, 208],
      instructionName: "CreateTransactionBuffer",
      title: "Create transaction buffer",
    },
    {
      discriminator: [190, 86, 246, 95, 231, 154, 229, 91],
      instructionName: "ExtendTransactionBuffer",
      title: "Extend transaction buffer",
    },
    {
      discriminator: [53, 192, 39, 239, 124, 84, 43, 249],
      instructionName: "CreateTransactionFromBuffer",
      title: "Create transaction from buffer",
    },
  ];

const SMART_ACCOUNT_INSTRUCTIONS_BY_DISCRIMINATOR = new Map(
  SMART_ACCOUNT_INSTRUCTIONS.map((definition) => [
    discriminatorKey(definition.discriminator),
    definition,
  ])
);

function discriminatorKey(bytes: readonly number[]): string {
  return bytes.slice(0, 8).join(",");
}

function normalizeBytes(input: Uint8Array | number[] | string): Buffer {
  if (typeof input === "string") {
    return Buffer.from(input, "base64");
  }

  return Buffer.from(input);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function toAddress(key: PublicKeyLike): string {
  if (typeof key === "string") {
    return key;
  }

  return key.toBase58();
}

function toPublicKey(key: PublicKeyLike): PublicKey {
  return typeof key === "string"
    ? new PublicKey(key)
    : new PublicKey(toAddress(key));
}

function truncateAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function programName(programId: string): string {
  return KNOWN_PROGRAMS[programId] ?? truncateAddress(programId);
}

function formatSol(lamports: number | bigint): string {
  const amount = Number(lamports) / LAMPORTS_PER_SOL;
  return amount.toLocaleString("en-US", {
    maximumFractionDigits: 9,
  });
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) {
    return amount.toString();
  }

  const scale = BigInt(10) ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  const padded = fraction.toString().padStart(decimals, "0");
  return `${whole.toString()}.${padded.replace(/0+$/, "")}`;
}

function readU64LE(bytes: Uint8Array, offset: number): bigint | null {
  if (bytes.length < offset + 8) {
    return null;
  }

  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value += BigInt(bytes[offset + i]) << BigInt(i * 8);
  }

  return value;
}

function withAccountLabels(
  accounts: DecodedSolanaInstructionAccount[],
  labels: readonly string[] | undefined
) {
  if (!labels) {
    return accounts;
  }

  return accounts.map((account, index) => ({
    ...account,
    label: account.label ?? labels[index] ?? null,
  }));
}

function accountAddress(
  accounts: readonly DecodedSolanaInstructionAccount[],
  index: number
): string | null {
  return accounts[index]?.address ?? null;
}

function shortAccount(
  accounts: readonly DecodedSolanaInstructionAccount[],
  index: number
): string {
  const address = accountAddress(accounts, index);
  return address ? truncateAddress(address) : `account ${index}`;
}

function createInstruction(
  input: SolanaInstructionInput
): TransactionInstruction {
  const keys: AccountMeta[] = (input.keys ?? []).map((key) => ({
    pubkey: toPublicKey(key.pubkey),
    isSigner: key.isSigner ?? false,
    isWritable: key.isWritable ?? false,
  }));

  return new TransactionInstruction({
    programId: toPublicKey(input.programId),
    keys,
    data: input.data ? normalizeBytes(input.data) : Buffer.alloc(0),
  });
}

function normalizeAccounts(
  keys: readonly SolanaInstructionAccountInput[] | undefined
): DecodedSolanaInstructionAccount[] {
  return (keys ?? []).map((key) => ({
    address: toAddress(key.pubkey),
    label: key.label ?? null,
    isSigner: key.isSigner ?? false,
    isWritable: key.isWritable ?? false,
  }));
}

function baseInstruction(args: {
  input: SolanaInstructionInput;
  instructionName?: string;
  title?: string;
  description?: string;
  details?: DecodedSolanaInstructionDetail[];
  accounts?: DecodedSolanaInstructionAccount[];
  warnings?: string[];
}): DecodedSolanaInstruction {
  const programId = toAddress(args.input.programId);
  const data = args.input.data
    ? normalizeBytes(args.input.data)
    : Buffer.alloc(0);
  const name = args.instructionName ?? "UnknownInstruction";
  const title = args.title ?? `${programName(programId)} instruction`;

  return {
    programId,
    programName: programName(programId),
    instructionName: name,
    title,
    description: args.description ?? `Instruction to ${programName(programId)}`,
    accounts: args.accounts ?? normalizeAccounts(args.input.keys),
    details: args.details ?? [],
    rawDataBase64: data.toString("base64"),
    rawDataHex: bytesToHex(data),
    warnings: args.warnings ?? [],
  };
}

function decodeSystemInstruction(
  input: SolanaInstructionInput,
  instruction: TransactionInstruction,
  accounts: DecodedSolanaInstructionAccount[]
): DecodedSolanaInstruction | null {
  try {
    const type = SystemInstruction.decodeInstructionType(instruction);

    if (type === "Transfer") {
      const decoded = SystemInstruction.decodeTransfer(instruction);
      const lamports = BigInt(decoded.lamports);
      return baseInstruction({
        input,
        instructionName: "Transfer",
        title: "Transfer SOL",
        description: `Transfer ${formatSol(
          lamports
        )} SOL from ${truncateAddress(
          decoded.fromPubkey.toBase58()
        )} to ${truncateAddress(decoded.toPubkey.toBase58())}`,
        accounts: withAccountLabels(accounts, ["From", "To"]),
        details: [
          { label: "Lamports", value: lamports.toString() },
          { label: "SOL", value: formatSol(lamports) },
          { label: "From", value: decoded.fromPubkey.toBase58() },
          { label: "To", value: decoded.toPubkey.toBase58() },
        ],
      });
    }

    if (type === "Create") {
      const decoded = SystemInstruction.decodeCreateAccount(instruction);
      return baseInstruction({
        input,
        instructionName: "CreateAccount",
        title: "Create account",
        description: `Create ${truncateAddress(
          decoded.newAccountPubkey.toBase58()
        )} with ${formatSol(decoded.lamports)} SOL`,
        accounts: withAccountLabels(accounts, [
          "Funding account",
          "New account",
        ]),
        details: [
          { label: "Funding account", value: decoded.fromPubkey.toBase58() },
          { label: "New account", value: decoded.newAccountPubkey.toBase58() },
          { label: "Lamports", value: decoded.lamports.toString() },
          { label: "Space", value: decoded.space.toString() },
          { label: "Owner", value: decoded.programId.toBase58() },
        ],
      });
    }

    if (type === "TransferWithSeed") {
      const decoded = SystemInstruction.decodeTransferWithSeed(instruction);
      const lamports = BigInt(decoded.lamports);
      return baseInstruction({
        input,
        instructionName: "TransferWithSeed",
        title: "Transfer SOL with seed",
        description: `Transfer ${formatSol(lamports)} SOL to ${truncateAddress(
          decoded.toPubkey.toBase58()
        )}`,
        accounts: withAccountLabels(accounts, ["From", "Base", "To"]),
        details: [
          { label: "Lamports", value: lamports.toString() },
          { label: "SOL", value: formatSol(lamports) },
          { label: "From", value: decoded.fromPubkey.toBase58() },
          { label: "Base", value: decoded.basePubkey.toBase58() },
          { label: "To", value: decoded.toPubkey.toBase58() },
          { label: "Seed", value: decoded.seed },
          { label: "Owner", value: decoded.programId.toBase58() },
        ],
      });
    }

    return baseInstruction({
      input,
      instructionName: type,
      title: `System: ${type}`,
      description: `System Program ${type} instruction`,
      accounts,
    });
  } catch (error) {
    return baseInstruction({
      input,
      instructionName: "SystemInstruction",
      title: "System Program instruction",
      accounts,
      warnings: [
        error instanceof Error
          ? error.message
          : "Failed to decode System instruction",
      ],
    });
  }
}

function decodeComputeBudgetInstruction(
  input: SolanaInstructionInput,
  instruction: TransactionInstruction,
  accounts: DecodedSolanaInstructionAccount[]
): DecodedSolanaInstruction | null {
  try {
    const type = ComputeBudgetInstruction.decodeInstructionType(instruction);

    if (type === "SetComputeUnitLimit") {
      const decoded =
        ComputeBudgetInstruction.decodeSetComputeUnitLimit(instruction);
      return baseInstruction({
        input,
        instructionName: type,
        title: "Set compute unit limit",
        description: `Limit transaction compute to ${decoded.units.toLocaleString(
          "en-US"
        )} units`,
        accounts,
        details: [{ label: "Units", value: decoded.units.toString() }],
      });
    }

    if (type === "SetComputeUnitPrice") {
      const decoded =
        ComputeBudgetInstruction.decodeSetComputeUnitPrice(instruction);
      return baseInstruction({
        input,
        instructionName: type,
        title: "Set compute unit price",
        description: `Set priority fee to ${decoded.microLamports.toString()} micro-lamports per compute unit`,
        accounts,
        details: [
          {
            label: "Micro-lamports per compute unit",
            value: decoded.microLamports.toString(),
          },
        ],
      });
    }

    if (type === "RequestHeapFrame") {
      const decoded =
        ComputeBudgetInstruction.decodeRequestHeapFrame(instruction);
      return baseInstruction({
        input,
        instructionName: type,
        title: "Request heap frame",
        description: `Request ${decoded.bytes.toLocaleString(
          "en-US"
        )} bytes of heap`,
        accounts,
        details: [{ label: "Bytes", value: decoded.bytes.toString() }],
      });
    }

    return baseInstruction({
      input,
      instructionName: type,
      title: `Compute Budget: ${type}`,
      description: `Compute Budget ${type} instruction`,
      accounts,
    });
  } catch (error) {
    return baseInstruction({
      input,
      instructionName: "ComputeBudgetInstruction",
      title: "Compute Budget instruction",
      accounts,
      warnings: [
        error instanceof Error
          ? error.message
          : "Failed to decode Compute Budget instruction",
      ],
    });
  }
}

function decodeAddressLookupTableInstruction(
  input: SolanaInstructionInput,
  instruction: TransactionInstruction,
  accounts: DecodedSolanaInstructionAccount[]
): DecodedSolanaInstruction | null {
  try {
    const type =
      AddressLookupTableInstruction.decodeInstructionType(instruction);
    return baseInstruction({
      input,
      instructionName: type,
      title: `Address lookup table: ${type}`,
      description: `Address lookup table ${type} instruction`,
      accounts,
    });
  } catch (error) {
    return baseInstruction({
      input,
      instructionName: "AddressLookupTableInstruction",
      title: "Address lookup table instruction",
      accounts,
      warnings: [
        error instanceof Error
          ? error.message
          : "Failed to decode address lookup table instruction",
      ],
    });
  }
}

function decodeAssociatedTokenInstruction(
  input: SolanaInstructionInput,
  accounts: DecodedSolanaInstructionAccount[]
): DecodedSolanaInstruction {
  const data = input.data ? normalizeBytes(input.data) : Buffer.alloc(0);
  const tag = data[0] ?? 0;
  const title =
    data.length === 0 || tag === 0
      ? "Create associated token account"
      : tag === 1
      ? "Create associated token account if needed"
      : tag === 2
      ? "Recover nested associated token account"
      : "Associated token account instruction";

  const labels =
    tag === 2
      ? [
          "Nested token account",
          "Nested mint",
          "Destination token account",
          "Owner token account",
          "Owner mint",
          "Owner",
          "Token program",
        ]
      : [
          "Payer",
          "Associated token account",
          "Owner",
          "Mint",
          "System program",
          "Token program",
        ];

  return baseInstruction({
    input,
    instructionName:
      tag === 1 ? "CreateIdempotent" : tag === 2 ? "RecoverNested" : "Create",
    title,
    description:
      tag === 1
        ? `Create ${shortAccount(accounts, 1)} for owner ${shortAccount(
            accounts,
            2
          )} if it does not exist`
        : `Create ${shortAccount(accounts, 1)} for owner ${shortAccount(
            accounts,
            2
          )}`,
    accounts: withAccountLabels(accounts, labels),
  });
}

function decodeSplTokenInstruction(
  input: SolanaInstructionInput,
  accounts: DecodedSolanaInstructionAccount[]
): DecodedSolanaInstruction | null {
  const data = input.data ? normalizeBytes(input.data) : Buffer.alloc(0);
  const tag = data[0];

  if (tag === 3) {
    const amount = readU64LE(data, 1);
    return baseInstruction({
      input,
      instructionName: "Transfer",
      title: "Transfer tokens",
      description: `Transfer ${
        amount?.toString() ?? "unknown"
      } raw tokens from ${shortAccount(accounts, 0)} to ${shortAccount(
        accounts,
        1
      )}`,
      accounts: withAccountLabels(accounts, ["Source", "Destination", "Owner"]),
      details: amount
        ? [{ label: "Raw amount", value: amount.toString() }]
        : [],
    });
  }

  if (tag === 12) {
    const amount = readU64LE(data, 1);
    const decimals = data[9];
    return baseInstruction({
      input,
      instructionName: "TransferChecked",
      title: "Transfer tokens",
      description:
        amount === null || decimals === undefined
          ? `Transfer checked tokens from ${shortAccount(
              accounts,
              0
            )} to ${shortAccount(accounts, 2)}`
          : `Transfer ${formatTokenAmount(
              amount,
              decimals
            )} tokens from ${shortAccount(accounts, 0)} to ${shortAccount(
              accounts,
              2
            )}`,
      accounts: withAccountLabels(accounts, [
        "Source",
        "Mint",
        "Destination",
        "Owner",
      ]),
      details:
        amount === null || decimals === undefined
          ? []
          : [
              { label: "Amount", value: formatTokenAmount(amount, decimals) },
              { label: "Raw amount", value: amount.toString() },
              { label: "Decimals", value: decimals.toString() },
              { label: "Mint", value: accountAddress(accounts, 1) ?? "" },
            ],
    });
  }

  if (tag === 4 || tag === 13) {
    const amount = readU64LE(data, 1);
    const decimals = tag === 13 ? data[9] : null;
    const description =
      amount === null
        ? `Approve token delegate ${shortAccount(accounts, 1)}`
        : decimals === null || decimals === undefined
        ? `Approve ${shortAccount(
            accounts,
            1
          )} to spend ${amount.toString()} raw tokens`
        : `Approve ${shortAccount(accounts, 2)} to spend ${formatTokenAmount(
            amount,
            decimals
          )} tokens`;

    return baseInstruction({
      input,
      instructionName: tag === 13 ? "ApproveChecked" : "Approve",
      title: "Approve token delegate",
      description,
      accounts: withAccountLabels(
        accounts,
        tag === 13
          ? ["Account", "Mint", "Delegate", "Owner"]
          : ["Account", "Delegate", "Owner"]
      ),
      details: amount
        ? [{ label: "Raw amount", value: amount.toString() }]
        : [],
    });
  }

  if (tag === 7 || tag === 14) {
    const amount = readU64LE(data, 1);
    const decimals = tag === 14 ? data[9] : null;
    return baseInstruction({
      input,
      instructionName: tag === 14 ? "MintToChecked" : "MintTo",
      title: "Mint tokens",
      description:
        amount === null
          ? `Mint tokens to ${shortAccount(accounts, tag === 14 ? 2 : 1)}`
          : `Mint ${
              decimals === null || decimals === undefined
                ? `${amount.toString()} raw`
                : formatTokenAmount(amount, decimals)
            } tokens to ${shortAccount(accounts, tag === 14 ? 2 : 1)}`,
      accounts: withAccountLabels(
        accounts,
        tag === 14
          ? ["Mint", "Destination", "Authority"]
          : ["Mint", "Destination", "Authority"]
      ),
      details: amount
        ? [{ label: "Raw amount", value: amount.toString() }]
        : [],
    });
  }

  if (tag === 8 || tag === 15) {
    const amount = readU64LE(data, 1);
    const decimals = tag === 15 ? data[9] : null;
    return baseInstruction({
      input,
      instructionName: tag === 15 ? "BurnChecked" : "Burn",
      title: "Burn tokens",
      description:
        amount === null
          ? `Burn tokens from ${shortAccount(accounts, 0)}`
          : `Burn ${
              decimals === null || decimals === undefined
                ? `${amount.toString()} raw`
                : formatTokenAmount(amount, decimals)
            } tokens from ${shortAccount(accounts, 0)}`,
      accounts: withAccountLabels(accounts, ["Account", "Mint", "Owner"]),
      details: amount
        ? [{ label: "Raw amount", value: amount.toString() }]
        : [],
    });
  }

  if (tag === 9) {
    return baseInstruction({
      input,
      instructionName: "CloseAccount",
      title: "Close token account",
      description: `Close ${shortAccount(
        accounts,
        0
      )} and send rent to ${shortAccount(accounts, 1)}`,
      accounts: withAccountLabels(accounts, [
        "Account",
        "Destination",
        "Authority",
      ]),
    });
  }

  if (tag === 17) {
    return baseInstruction({
      input,
      instructionName: "SyncNative",
      title: "Sync wrapped SOL",
      description: `Sync wrapped SOL token account ${shortAccount(
        accounts,
        0
      )}`,
      accounts: withAccountLabels(accounts, ["Wrapped SOL account"]),
    });
  }

  return baseInstruction({
    input,
    instructionName: "TokenInstruction",
    title: "Token instruction",
    description: `${programName(toAddress(input.programId))} instruction ${
      tag ?? "unknown"
    }`,
    accounts,
  });
}

function decodeMemoInstruction(
  input: SolanaInstructionInput,
  accounts: DecodedSolanaInstructionAccount[]
): DecodedSolanaInstruction {
  const decoded = decodeMessagePayload(
    input.data ? normalizeBytes(input.data) : Buffer.alloc(0)
  );
  return baseInstruction({
    input,
    instructionName: "Memo",
    title: "Memo",
    description: decoded.value,
    accounts,
    details: [{ label: "Memo", value: decoded.value }],
  });
}

function decodeSmartAccountInstruction(
  input: SolanaInstructionInput,
  accounts: DecodedSolanaInstructionAccount[]
): DecodedSolanaInstruction | null {
  const data = input.data ? normalizeBytes(input.data) : Buffer.alloc(0);
  const definition = SMART_ACCOUNT_INSTRUCTIONS_BY_DISCRIMINATOR.get(
    discriminatorKey(Array.from(data.slice(0, 8)))
  );

  if (!definition) {
    return null;
  }

  const labeledAccounts = withAccountLabels(accounts, definition.accountLabels);
  const details: DecodedSolanaInstructionDetail[] = [
    { label: "Instruction", value: definition.instructionName },
  ];

  if (definition.instructionName === "UseSpendingLimit") {
    const amount = readU64LE(data, 8);
    const decimals = data[16];
    if (amount !== null && decimals !== undefined) {
      details.push(
        { label: "Amount", value: formatTokenAmount(amount, decimals) },
        { label: "Raw amount", value: amount.toString() },
        { label: "Decimals", value: decimals.toString() }
      );
    }
  }

  if (
    definition.instructionName === "ExecuteTransactionSync" ||
    definition.instructionName === "ExecuteTransactionSyncV2"
  ) {
    const accountIndex = data[8];
    const signerCount = data[9];
    if (accountIndex !== undefined) {
      details.push({ label: "Vault index", value: accountIndex.toString() });
    }
    if (signerCount !== undefined) {
      details.push({ label: "Signer count", value: signerCount.toString() });
    }
  }

  return baseInstruction({
    input,
    instructionName: definition.instructionName,
    title: definition.title,
    description: smartAccountDescription(definition, labeledAccounts, data),
    accounts: labeledAccounts,
    details,
  });
}

function smartAccountDescription(
  definition: SmartAccountInstructionDefinition,
  accounts: readonly DecodedSolanaInstructionAccount[],
  data: Uint8Array
): string {
  if (definition.instructionName === "ApproveProposal") {
    return `Approve proposal ${shortAccount(
      accounts,
      2
    )} as signer ${shortAccount(accounts, 1)}`;
  }

  if (definition.instructionName === "RejectProposal") {
    return `Reject proposal ${shortAccount(
      accounts,
      2
    )} as signer ${shortAccount(accounts, 1)}`;
  }

  if (definition.instructionName === "CancelProposal") {
    return `Cancel proposal ${shortAccount(
      accounts,
      2
    )} as signer ${shortAccount(accounts, 1)}`;
  }

  if (definition.instructionName === "ExecuteTransaction") {
    return `Execute transaction ${shortAccount(
      accounts,
      2
    )} for proposal ${shortAccount(accounts, 1)}`;
  }

  if (definition.instructionName === "ExecuteSettingsTransaction") {
    return `Execute settings transaction ${shortAccount(
      accounts,
      3
    )} for proposal ${shortAccount(accounts, 2)}`;
  }

  if (definition.instructionName === "UseSpendingLimit") {
    const amount = readU64LE(data, 8);
    const decimals = data[16];
    const formattedAmount =
      amount !== null && decimals !== undefined
        ? formatTokenAmount(amount, decimals)
        : "tokens";
    return `Use spending limit to send ${formattedAmount} to ${shortAccount(
      accounts,
      4
    )}`;
  }

  return definition.title;
}

function decodeFallbackInstruction(
  input: SolanaInstructionInput,
  accounts: DecodedSolanaInstructionAccount[]
): DecodedSolanaInstruction {
  const programId = toAddress(input.programId);
  const knownProgramName = programName(programId);
  const title = KNOWN_PROGRAMS[programId]
    ? `${knownProgramName} instruction`
    : "Unknown program instruction";

  return baseInstruction({
    input,
    instructionName: "UnknownInstruction",
    title,
    description: KNOWN_PROGRAMS[programId]
      ? `${knownProgramName} instruction`
      : `Instruction to ${truncateAddress(programId)}`,
    accounts,
  });
}

export function decodeSolanaInstruction(
  input: SolanaInstructionInput
): DecodedSolanaInstruction {
  const programId = toAddress(input.programId);
  const accounts = normalizeAccounts(input.keys);
  const instruction = createInstruction(input);

  if (programId === SystemProgram.programId.toBase58()) {
    return (
      decodeSystemInstruction(input, instruction, accounts) ??
      decodeFallbackInstruction(input, accounts)
    );
  }

  if (programId === ComputeBudgetProgram.programId.toBase58()) {
    return (
      decodeComputeBudgetInstruction(input, instruction, accounts) ??
      decodeFallbackInstruction(input, accounts)
    );
  }

  if (programId === AddressLookupTableProgram.programId.toBase58()) {
    return (
      decodeAddressLookupTableInstruction(input, instruction, accounts) ??
      decodeFallbackInstruction(input, accounts)
    );
  }

  if (programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
    return decodeAssociatedTokenInstruction(input, accounts);
  }

  if (
    programId === TOKEN_PROGRAM_ID.toBase58() ||
    programId === TOKEN_2022_PROGRAM_ID.toBase58()
  ) {
    return (
      decodeSplTokenInstruction(input, accounts) ??
      decodeFallbackInstruction(input, accounts)
    );
  }

  if (programId === MEMO_PROGRAM_ID || programId === MEMO_LEGACY_PROGRAM_ID) {
    return decodeMemoInstruction(input, accounts);
  }

  if (programId === SMART_ACCOUNT_PROGRAM_ID) {
    return (
      decodeSmartAccountInstruction(input, accounts) ??
      decodeFallbackInstruction(input, accounts)
    );
  }

  return decodeFallbackInstruction(input, accounts);
}

function decodeCompiledInstruction(args: {
  message: MessageV0;
  instruction: MessageCompiledInstruction;
}): DecodedSolanaInstruction {
  const accountKeys = args.message.getAccountKeys();
  const programId = accountKeys.get(args.instruction.programIdIndex);

  if (!programId) {
    return baseInstruction({
      input: {
        programId: `Unknown account #${args.instruction.programIdIndex}`,
        data: args.instruction.data,
      },
      instructionName: "UnresolvedInstruction",
      title: "Unresolved instruction",
      description:
        "Instruction program is loaded from an address lookup table that was not included with the transaction.",
      warnings: [
        "Address lookup table accounts are required for full decoding.",
      ],
    });
  }

  const keys = args.instruction.accountKeyIndexes.flatMap(
    (accountIndex): SolanaInstructionAccountInput[] => {
      const pubkey = accountKeys.get(accountIndex);
      if (!pubkey) {
        return [];
      }

      return [
        {
          pubkey,
          isSigner: args.message.isAccountSigner(accountIndex),
          isWritable: args.message.isAccountWritable(accountIndex),
        },
      ];
    }
  );

  const decoded = decodeSolanaInstruction({
    programId,
    keys,
    data: args.instruction.data,
  });

  if (keys.length !== args.instruction.accountKeyIndexes.length) {
    return {
      ...decoded,
      warnings: [
        ...decoded.warnings,
        "Some accounts are loaded from address lookup tables and could not be resolved.",
      ],
    };
  }

  return decoded;
}

export function decodeSolanaTransaction(
  input: Uint8Array | number[] | string
): DecodedSolanaTransaction {
  const bytes = normalizeBytes(input);
  const rawTransactionBase64 = bytes.toString("base64");

  try {
    const transaction = VersionedTransaction.deserialize(bytes);
    if (transaction.version !== 0) {
      throw new Error("Only v0 versioned transactions are decoded here.");
    }
    const message = transaction.message as MessageV0;

    return {
      version: "v0",
      rawTransactionBase64,
      error: null,
      instructions: message.compiledInstructions.map((instruction) =>
        decodeCompiledInstruction({
          message,
          instruction,
        })
      ),
    };
  } catch {
    // Fall through to legacy transaction decoding.
  }

  try {
    const transaction = Transaction.from(bytes);
    return {
      version: "legacy",
      rawTransactionBase64,
      error: null,
      instructions: transaction.instructions.map((instruction) =>
        decodeSolanaInstruction({
          programId: instruction.programId,
          keys: instruction.keys,
          data: instruction.data,
        })
      ),
    };
  } catch (error) {
    return {
      version: "unknown",
      rawTransactionBase64,
      instructions: [],
      error:
        error instanceof Error
          ? error.message
          : "Failed to decode Solana transaction",
    };
  }
}

export function decodeMessagePayload(
  input: Uint8Array | number[] | string
): DecodedMessagePayload {
  const bytes = normalizeBytes(input);

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/^[\x20-\x7E\n\r\t]+$/.test(text)) {
      return { value: text, encoding: "utf8" };
    }
  } catch {
    // Fall back to hex below.
  }

  return { value: bytesToHex(bytes), encoding: "hex" };
}
