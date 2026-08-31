import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  PROGRAM_ADDRESS,
  generated,
  pda,
} from "../packages/loyal-smart-accounts/src/index.ts";
import {
  Settings,
  freezePreparedOperation,
  settingsDiscriminator,
  toBigInt,
} from "../packages/loyal-smart-accounts-core/src/index.ts";
import { createLoyalSmartAccountsClient } from "../packages/loyal-smart-accounts/src/client.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";

const USDC_MINT_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

const KLEND_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR = Uint8Array.from([
  169, 201, 30, 126, 6, 205, 102, 68,
]);
const KAMINO_DEPOSIT_INSTRUCTIONS = [
  {
    name: "depositReserveLiquidity",
    discriminator: KLEND_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR,
  },
  {
    name: "depositReserveLiquidityAndObligationCollateral",
    discriminator: Uint8Array.from([129, 199, 4, 2, 222, 39, 26, 46]),
  },
  {
    name: "depositReserveLiquidityAndObligationCollateralV2",
    discriminator: Uint8Array.from([216, 224, 191, 27, 204, 151, 102, 175]),
  },
] as const;
const USDC_DECIMALS = 6;

type KaminoDepositInstructionDefinition =
  (typeof KAMINO_DEPOSIT_INSTRUCTIONS)[number];

type ParsedArgs = {
  settingsPda: PublicKey | null;
  userAddress: PublicKey | null;
  signerKeypairPath: string;
  feePayerKeypairPath: string | null;
  agent: PublicKey;
  templateInstructionsFile: string;
  templateInstructionIndex: number | null;
  sourceTokenAccountIndex: number | null;
  accountIndex: number;
  rpcUrl: string;
  programId: PublicKey;
  policySeed: number | null;
  usdcMint: PublicKey;
  klendProgramId: PublicKey;
  thresholdAtomic: bigint;
  thresholdOperator: generated.DataOperator;
  approve: boolean;
  execute: boolean;
  memo?: string;
};

function printHelpAndExit(): never {
  console.log(`Usage:
  bun run scripts/create-kamino-lending-policy.ts (--settings-pda <PUBKEY> | --user <PUBKEY>) --agent <PUBKEY> --template-instructions-file <PATH> --keypair <USER_KEYPAIR> [options]

Required:
  --agent <PUBKEY>                     Agent key allowed to propose/vote/execute policy txs
  --template-instructions-file <PATH>  Kamino KTX deposit-instructions JSON, or generic instruction JSON
  --keypair <PATH>                     Current Settings signer keypair. For users with zero SOL, pair with --fee-payer-keypair.

Account selector:
  --settings-pda <PUBKEY>              Smart-account Settings PDA
  --user <PUBKEY>                      User wallet address; resolves Settings PDA on-chain

Sponsorship:
  --fee-payer-keypair <PATH>           Sponsor/rent payer keypair. Defaults to --keypair.

Policy:
  --policy-seed <NUMBER>               Override next policy seed. Defaults to Settings.policySeed + 1.
  --vault-index <NUMBER>               Vault account index. Default: 0.
  --source-token-account-index <N>     Instruction account index for the vault USDC ATA.
                                       Defaults to auto-detecting the vault USDC ATA in the template instruction.
  --threshold-usdc <DECIMAL>           Source ATA must be > this amount. Default: 500.
  --threshold-operator <OP>            gt, gte, greater-than, or greater-than-or-equal. Default: gt.
  --threshold-inclusive                Alias for --threshold-operator gte.
  --usdc-mint <PUBKEY>                 Default: mainnet USDC unless SOLANA_ENV/NEXT_PUBLIC_SOLANA_ENV is devnet.
  --klend-program-id <PUBKEY>          Default: ${KLEND_PROGRAM_ID.toBase58()}
  --template-instruction-index <N>     Instruction from the template file to constrain.
                                       Defaults to auto-detecting a supported KLend deposit instruction.
  --memo <TEXT>                        Optional memo on the settings transaction.
  --approve                            Also approve with --keypair.
  --execute                            Also execute after approval. Implies --approve.

Routing:
  --rpc-url <URL>                      Override RPC endpoint
  --program-id <PUBKEY>                Override Smart Account program id
`);
  process.exit(0);
}

function resolvePath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  if (filePath === "~") {
    return os.homedir();
  }

  return filePath;
}

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(
    fs.readFileSync(resolvePath(filePath), "utf8")
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function parseUiAmountToAtomic(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(
      `Amount ${value} has more than ${decimals} decimal places.`
    );
  }

  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
}

function decodeInstructionData(value: unknown): Uint8Array {
  if (Array.isArray(value)) {
    return Uint8Array.from(value as number[]);
  }

  if (typeof value !== "string") {
    throw new Error("Instruction data must be a string or byte array.");
  }

  if (value.startsWith("hex:")) {
    return Uint8Array.from(Buffer.from(value.slice(4), "hex"));
  }

  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    return Uint8Array.from(Buffer.from(value, "hex"));
  }

  if (value.startsWith("base58:")) {
    return Uint8Array.from(bs58.decode(value.slice(7)));
  }

  return Uint8Array.from(Buffer.from(value, "base64"));
}

function parseInstructionAccount(raw: unknown): AccountMeta {
  if (!raw || typeof raw !== "object") {
    throw new Error("Instruction account must be an object.");
  }

  const account = raw as Record<string, unknown>;
  const address = account.pubkey ?? account.address;
  if (typeof address !== "string") {
    throw new Error("Instruction account is missing pubkey/address.");
  }

  if (
    typeof account.isWritable === "boolean" ||
    typeof account.isSigner === "boolean"
  ) {
    return {
      pubkey: new PublicKey(address),
      isWritable: Boolean(account.isWritable),
      isSigner: Boolean(account.isSigner),
    };
  }

  const role =
    typeof account.role === "string" ? account.role.toUpperCase() : "";
  return {
    pubkey: new PublicKey(address),
    isWritable: role.includes("WRITABLE"),
    isSigner: role.includes("SIGNER") || account.signer != null,
  };
}

function parseInstruction(raw: unknown): TransactionInstruction {
  if (!raw || typeof raw !== "object") {
    throw new Error("Instruction must be an object.");
  }

  const instruction = raw as Record<string, unknown>;
  const programAddress = instruction.programId ?? instruction.programAddress;
  const rawKeys = instruction.keys ?? instruction.accounts;

  if (typeof programAddress !== "string") {
    throw new Error("Instruction is missing programId/programAddress.");
  }

  if (!Array.isArray(rawKeys)) {
    throw new Error("Instruction is missing keys/accounts array.");
  }

  return new TransactionInstruction({
    programId: new PublicKey(programAddress),
    keys: rawKeys.map(parseInstructionAccount),
    data: Buffer.from(decodeInstructionData(instruction.data)),
  });
}

function parseInstructionsDocument(filePath: string): TransactionInstruction[] {
  const raw = JSON.parse(fs.readFileSync(resolvePath(filePath), "utf8"));
  const rawInstructions = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.instructions)
    ? raw.instructions
    : null;

  if (!rawInstructions) {
    throw new Error(
      "Instructions file must be an array or an object with an instructions array."
    );
  }

  return rawInstructions.map(parseInstruction);
}

function resolveDefaultRpcUrl(): string {
  if (process.env.RPC_URL) {
    return process.env.RPC_URL;
  }

  if (process.env.PROVIDER_ENDPOINT) {
    return process.env.PROVIDER_ENDPOINT;
  }

  const solanaEnv = resolveSolanaEnv(
    process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV
  );
  return getSolanaEndpoints(solanaEnv).rpcEndpoint;
}

function resolveDefaultProgramId(): PublicKey {
  const solanaEnv = resolveSolanaEnv(
    process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV
  );
  const envProgramId =
    process.env[`LOYAL_SMART_ACCOUNTS_PROGRAM_ID_${solanaEnv.toUpperCase()}`] ??
    process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ??
    PROGRAM_ADDRESS;
  return new PublicKey(envProgramId);
}

function resolveDefaultUsdcMint(): PublicKey {
  const solanaEnv = resolveSolanaEnv(
    process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV
  );
  return solanaEnv === "devnet" ? USDC_MINT_DEVNET : USDC_MINT_MAINNET;
}

function requireArg(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  let settingsPda: PublicKey | null = null;
  let userAddress: PublicKey | null = null;
  let signerKeypairPath: string | undefined;
  let feePayerKeypairPath: string | null = null;
  let agent: PublicKey | null = null;
  let templateInstructionsFile: string | undefined;
  let templateInstructionIndex: number | null = null;
  let sourceTokenAccountIndex: number | null = null;
  let accountIndex = 0;
  let rpcUrl = resolveDefaultRpcUrl();
  let programId = resolveDefaultProgramId();
  let policySeed: number | null = null;
  let usdcMint = resolveDefaultUsdcMint();
  let usdcMintProvided = false;
  let klendProgramId = KLEND_PROGRAM_ID;
  let thresholdAtomic = parseUiAmountToAtomic("500", USDC_DECIMALS);
  let thresholdOperator = generated.DataOperator.GreaterThan;
  let approve = false;
  let execute = false;
  let memo: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--settings-pda" && next) {
      settingsPda = new PublicKey(next);
      index += 1;
      continue;
    }

    if ((current === "--user" || current === "--wallet") && next) {
      userAddress = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--keypair" && next) {
      signerKeypairPath = next;
      index += 1;
      continue;
    }

    if (current === "--fee-payer-keypair" && next) {
      feePayerKeypairPath = next;
      index += 1;
      continue;
    }

    if (current === "--agent" && next) {
      agent = new PublicKey(next);
      index += 1;
      continue;
    }

    if (
      (current === "--template-instructions-file" ||
        current === "--instructions-file") &&
      next
    ) {
      templateInstructionsFile = next;
      index += 1;
      continue;
    }

    if (current === "--template-instruction-index" && next) {
      templateInstructionIndex = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (current === "--source-token-account-index" && next) {
      sourceTokenAccountIndex = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (
      (current === "--vault-index" || current === "--account-index") &&
      next
    ) {
      accountIndex = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (current === "--policy-seed" && next) {
      policySeed = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (current === "--usdc-mint" && next) {
      usdcMint = new PublicKey(next);
      usdcMintProvided = true;
      index += 1;
      continue;
    }

    if (current === "--klend-program-id" && next) {
      klendProgramId = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--threshold-usdc" && next) {
      thresholdAtomic = parseUiAmountToAtomic(next, USDC_DECIMALS);
      index += 1;
      continue;
    }

    if (current === "--threshold-operator" && next) {
      thresholdOperator = parseThresholdOperator(next);
      index += 1;
      continue;
    }

    if (current === "--threshold-inclusive") {
      thresholdOperator = generated.DataOperator.GreaterThanOrEqualTo;
      continue;
    }

    if (current === "--memo" && next) {
      memo = next;
      index += 1;
      continue;
    }

    if (current === "--rpc-url" && next) {
      rpcUrl = next;
      index += 1;
      continue;
    }

    if (current === "--program-id" && next) {
      programId = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--approve") {
      approve = true;
      continue;
    }

    if (current === "--execute") {
      execute = true;
      approve = true;
      continue;
    }

    if (current === "--help" || current === "-h") {
      printHelpAndExit();
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  if (!settingsPda && !userAddress) {
    throw new Error("Provide --settings-pda or --user.");
  }

  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error("--vault-index must be a non-negative integer.");
  }

  if (
    templateInstructionIndex !== null &&
    (!Number.isInteger(templateInstructionIndex) ||
      templateInstructionIndex < 0)
  ) {
    throw new Error(
      "--template-instruction-index must be a non-negative integer."
    );
  }

  if (
    sourceTokenAccountIndex !== null &&
    (!Number.isInteger(sourceTokenAccountIndex) || sourceTokenAccountIndex < 0)
  ) {
    throw new Error(
      "--source-token-account-index must be a non-negative integer."
    );
  }

  if (
    policySeed !== null &&
    (!Number.isInteger(policySeed) || policySeed <= 0)
  ) {
    throw new Error("--policy-seed must be a positive integer.");
  }

  if (!usdcMintProvided && rpcUrl.includes("mainnet")) {
    usdcMint = USDC_MINT_MAINNET;
  }

  return {
    settingsPda,
    userAddress,
    signerKeypairPath: requireArg("--keypair", signerKeypairPath),
    feePayerKeypairPath,
    agent: new PublicKey(requireArg("--agent", agent?.toBase58())),
    templateInstructionsFile: requireArg(
      "--template-instructions-file",
      templateInstructionsFile
    ),
    templateInstructionIndex,
    sourceTokenAccountIndex,
    accountIndex,
    rpcUrl,
    programId,
    policySeed,
    usdcMint,
    klendProgramId,
    thresholdAtomic,
    thresholdOperator,
    approve,
    execute,
    memo,
  };
}

function parseThresholdOperator(value: string): generated.DataOperator {
  const normalized = value.trim().toLowerCase();
  if (["gt", "greater-than", "greaterthan", ">"].includes(normalized)) {
    return generated.DataOperator.GreaterThan;
  }

  if (
    [
      "gte",
      "ge",
      "greater-than-or-equal",
      "greater-than-or-equal-to",
      "greaterthanorequalto",
      ">=",
    ].includes(normalized)
  ) {
    return generated.DataOperator.GreaterThanOrEqualTo;
  }

  throw new Error(
    "--threshold-operator must be gt, gte, greater-than, or greater-than-or-equal."
  );
}

function dataOperatorName(operator: generated.DataOperator): string {
  return generated.DataOperator[operator] ?? String(operator);
}

async function resolveSettingsPdaFromUser(args: {
  connection: Connection;
  programId: PublicKey;
  userAddress: PublicKey;
}): Promise<PublicKey> {
  const accounts = await args.connection.getProgramAccounts(args.programId, {
    commitment: "confirmed",
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Buffer.from(settingsDiscriminator)),
        },
      },
    ],
  });
  const matches: Array<{ address: PublicKey; settings: Settings }> = [];

  for (const account of accounts) {
    const [settings] = Settings.fromAccountInfo(account.account);

    if (
      settings.signers.some((signer) => signer.key.equals(args.userAddress))
    ) {
      matches.push({
        address: account.pubkey,
        settings,
      });
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `No smart-account Settings account found for user ${args.userAddress.toBase58()}.`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Found multiple Settings accounts for user ${args.userAddress.toBase58()}: ` +
        matches.map((match) => match.address.toBase58()).join(", ") +
        ". Re-run with --settings-pda."
    );
  }

  return matches[0].address;
}

function findSourceTokenAccountIndex(args: {
  instruction: TransactionInstruction;
  sourceTokenAccountIndex: number | null;
  vaultPda: PublicKey;
  usdcMint: PublicKey;
}): number {
  if (args.sourceTokenAccountIndex !== null) {
    if (args.sourceTokenAccountIndex >= args.instruction.keys.length) {
      throw new Error("--source-token-account-index is out of bounds.");
    }
    return args.sourceTokenAccountIndex;
  }

  const vaultUsdcAta = getAssociatedTokenAddressSync(
    args.usdcMint,
    args.vaultPda,
    true,
    TOKEN_PROGRAM_ID
  );
  const detectedIndex = args.instruction.keys.findIndex((meta) =>
    meta.pubkey.equals(vaultUsdcAta)
  );

  if (detectedIndex < 0) {
    throw new Error(
      `Unable to auto-detect vault USDC ATA ${vaultUsdcAta.toBase58()} in template instruction. ` +
        "Pass --source-token-account-index explicitly."
    );
  }

  return detectedIndex;
}

function getKaminoDepositInstructionDefinition(args: {
  instruction: TransactionInstruction;
  klendProgramId: PublicKey;
}): KaminoDepositInstructionDefinition | null {
  if (!args.instruction.programId.equals(args.klendProgramId)) {
    return null;
  }

  return (
    KAMINO_DEPOSIT_INSTRUCTIONS.find((definition) => {
      const discriminator = args.instruction.data.subarray(
        0,
        definition.discriminator.length
      );
      return (
        Buffer.compare(
          Buffer.from(discriminator),
          Buffer.from(definition.discriminator)
        ) === 0
      );
    }) ?? null
  );
}

function selectTemplateInstruction(args: {
  instructions: TransactionInstruction[];
  templateInstructionIndex: number | null;
  klendProgramId: PublicKey;
}): {
  instruction: TransactionInstruction;
  instructionIndex: number;
  definition: KaminoDepositInstructionDefinition;
} {
  if (args.templateInstructionIndex !== null) {
    const instruction = args.instructions[args.templateInstructionIndex];
    if (!instruction) {
      throw new Error("--template-instruction-index is out of bounds.");
    }

    const definition = getKaminoDepositInstructionDefinition({
      instruction,
      klendProgramId: args.klendProgramId,
    });
    if (!definition) {
      throw new Error(
        `Instruction ${args.templateInstructionIndex} is not a supported KLend deposit instruction.`
      );
    }

    return {
      instruction,
      instructionIndex: args.templateInstructionIndex,
      definition,
    };
  }

  const matches = args.instructions
    .map((instruction, instructionIndex) => ({
      instruction,
      instructionIndex,
      definition: getKaminoDepositInstructionDefinition({
        instruction,
        klendProgramId: args.klendProgramId,
      }),
    }))
    .filter(
      (
        entry
      ): entry is {
        instruction: TransactionInstruction;
        instructionIndex: number;
        definition: KaminoDepositInstructionDefinition;
      } => entry.definition !== null
    );

  if (matches.length === 0) {
    throw new Error(
      "Unable to auto-detect a supported KLend deposit instruction in the template file."
    );
  }

  if (matches.length > 1) {
    throw new Error(
      "Found multiple supported KLend deposit instructions in the template file: " +
        matches
          .map((match) => `${match.instructionIndex}:${match.definition.name}`)
          .join(", ") +
        ". Re-run with --template-instruction-index."
    );
  }

  return matches[0];
}

function buildKaminoPolicyCreationPayload(args: {
  instruction: TransactionInstruction;
  depositDefinition: KaminoDepositInstructionDefinition;
  accountIndex: number;
  sourceTokenAccountIndex: number;
  vaultPda: PublicKey;
  usdcMint: PublicKey;
  klendProgramId: PublicKey;
  thresholdAtomic: bigint;
  thresholdOperator: generated.DataOperator;
}): generated.PolicyCreationPayload {
  if (!args.instruction.programId.equals(args.klendProgramId)) {
    throw new Error(
      `Template instruction program ${args.instruction.programId.toBase58()} does not match KLend program ${args.klendProgramId.toBase58()}.`
    );
  }

  const discriminator = args.instruction.data.subarray(
    0,
    args.depositDefinition.discriminator.length
  );
  if (
    Buffer.compare(
      Buffer.from(discriminator),
      Buffer.from(args.depositDefinition.discriminator)
    ) !== 0
  ) {
    throw new Error(
      `Template instruction is not ${args.depositDefinition.name}; discriminator mismatch.`
    );
  }

  const accountConstraints: generated.AccountConstraint[] =
    args.instruction.keys.map((meta, index) => ({
      accountIndex: index,
      accountConstraint: {
        __kind: "Pubkey",
        fields: [[meta.pubkey]],
      },
      owner: null,
    }));

  accountConstraints.push({
    accountIndex: args.sourceTokenAccountIndex,
    owner: TOKEN_PROGRAM_ID,
    accountConstraint: {
      __kind: "AccountData",
      fields: [
        [
          {
            dataOffset: 0n,
            dataValue: {
              __kind: "U8Slice",
              fields: [args.usdcMint.toBuffer()],
            },
            operator: generated.DataOperator.Equals,
          },
          {
            dataOffset: 32n,
            dataValue: {
              __kind: "U8Slice",
              fields: [args.vaultPda.toBuffer()],
            },
            operator: generated.DataOperator.Equals,
          },
          {
            dataOffset: 64n,
            dataValue: {
              __kind: "U64Le",
              fields: [args.thresholdAtomic],
            },
            operator: args.thresholdOperator,
          },
        ],
      ],
    },
  });

  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: args.accountIndex,
        instructionsConstraints: [
          {
            programId: args.klendProgramId,
            accountConstraints,
            dataConstraints: [
              {
                dataOffset: 0n,
                dataValue: {
                  __kind: "U8Slice",
                  fields: [args.depositDefinition.discriminator],
                },
                operator: generated.DataOperator.Equals,
              },
            ],
          },
        ],
        preHook: null,
        postHook: null,
        spendingLimits: [],
      },
    ],
  };
}

function dedupeSigners(signers: Keypair[]): Keypair[] {
  const unique = new Map<string, Keypair>();
  for (const signer of signers) {
    unique.set(signer.publicKey.toBase58(), signer);
  }
  return [...unique.values()];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settingsSigner = loadKeypair(args.signerKeypairPath);
  const feePayer = args.feePayerKeypairPath
    ? loadKeypair(args.feePayerKeypairPath)
    : settingsSigner;
  const connection = new Connection(args.rpcUrl, { commitment: "confirmed" });
  const client = createLoyalSmartAccountsClient({
    connection,
    programId: args.programId,
    defaultCommitment: "confirmed",
  });
  const settingsPda =
    args.settingsPda ??
    (await resolveSettingsPdaFromUser({
      connection,
      programId: args.programId,
      userAddress: args.userAddress!,
    }));
  const settings = await client.smartAccounts.queries.fetchSettings(
    settingsPda
  );

  if (
    !settings.signers.some((signer) =>
      signer.key.equals(settingsSigner.publicKey)
    )
  ) {
    throw new Error(
      `Signer ${settingsSigner.publicKey.toBase58()} is not a member of settings ${settingsPda.toBase58()}.`
    );
  }

  const policySeed =
    args.policySeed ??
    Number(
      (settings.policySeed == null ? 0n : toBigInt(settings.policySeed)) + 1n
    );
  const transactionIndex = toBigInt(settings.transactionIndex) + 1n;
  const [policyPda] = pda.getPolicyPda({
    settingsPda,
    policySeed,
    programId: args.programId,
  });
  const [vaultPda] = pda.getSmartAccountPda({
    settingsPda,
    accountIndex: args.accountIndex,
    programId: args.programId,
  });
  const templateInstructions = parseInstructionsDocument(
    args.templateInstructionsFile
  );
  const selectedTemplateInstruction = selectTemplateInstruction({
    instructions: templateInstructions,
    templateInstructionIndex: args.templateInstructionIndex,
    klendProgramId: args.klendProgramId,
  });
  const templateInstruction = selectedTemplateInstruction.instruction;

  const sourceTokenAccountIndex = findSourceTokenAccountIndex({
    instruction: templateInstruction,
    sourceTokenAccountIndex: args.sourceTokenAccountIndex,
    vaultPda,
    usdcMint: args.usdcMint,
  });
  const policyCreationPayload = buildKaminoPolicyCreationPayload({
    instruction: templateInstruction,
    depositDefinition: selectedTemplateInstruction.definition,
    accountIndex: args.accountIndex,
    sourceTokenAccountIndex,
    vaultPda,
    usdcMint: args.usdcMint,
    klendProgramId: args.klendProgramId,
    thresholdAtomic: args.thresholdAtomic,
    thresholdOperator: args.thresholdOperator,
  });
  const createSettingsTransaction =
    await client.features.smartAccounts.prepare.createSettingsTransaction({
      feePayer: feePayer.publicKey,
      rentPayer: feePayer.publicKey,
      settingsPda,
      transactionIndex,
      creator: settingsSigner.publicKey,
      actions: [
        {
          __kind: "PolicyCreate",
          seed: policySeed,
          policyCreationPayload,
          signers: [
            {
              key: args.agent,
              permissions: { mask: 7 },
            },
          ],
          threshold: 1,
          timeLock: 0,
          startTimestamp: null,
          expirationArgs: null,
        },
      ],
      memo: args.memo,
    } as never);
  const createProposal = await client.features.proposals.prepare.create({
    feePayer: feePayer.publicKey,
    rentPayer: feePayer.publicKey,
    settingsPda,
    transactionIndex,
    creator: settingsSigner.publicKey,
  } as never);
  const preparedCreateAndPropose = freezePreparedOperation({
    operation: "createKaminoLendingPolicyProposal",
    payer: feePayer.publicKey,
    programId: args.programId,
    requiresConfirmation: true,
    instructions: [
      ...createSettingsTransaction.instructions,
      ...createProposal.instructions,
    ],
    lookupTableAccounts: [],
  });
  const signers = dedupeSigners([feePayer, settingsSigner]);
  const createSignature = await client.send(preparedCreateAndPropose, {
    signers,
    confirm: true,
  });
  const followUpSignatures: Record<string, string> = {};

  if (args.approve) {
    const approvePrepared = await client.features.proposals.prepare.approve({
      feePayer: feePayer.publicKey,
      settingsPda,
      transactionIndex,
      signer: settingsSigner.publicKey,
    } as never);
    followUpSignatures.approve = await client.send(approvePrepared, {
      signers,
      confirm: true,
    });
  }

  if (args.execute) {
    const executePrepared =
      await client.features.execution.prepare.executeSettingsTransaction({
        feePayer: feePayer.publicKey,
        rentPayer: feePayer.publicKey,
        settingsPda,
        transactionIndex,
        signer: settingsSigner.publicKey,
        policies: [policyPda],
      } as never);
    followUpSignatures.execute = await client.send(executePrepared, {
      signers,
      confirm: true,
    });
  }

  const [transactionPda] = pda.getTransactionPda({
    settingsPda,
    transactionIndex,
    programId: args.programId,
  });
  const [proposalPda] = pda.getProposalPda({
    settingsPda,
    transactionIndex,
    programId: args.programId,
  });

  console.log(
    JSON.stringify(
      {
        signature: createSignature,
        followUpSignatures,
        rpcUrl: args.rpcUrl,
        programId: args.programId.toBase58(),
        settingsPda: settingsPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        accountIndex: args.accountIndex,
        policySeed,
        policyPda: policyPda.toBase58(),
        transactionIndex: transactionIndex.toString(),
        transactionPda: transactionPda.toBase58(),
        proposalPda: proposalPda.toBase58(),
        settingsSigner: settingsSigner.publicKey.toBase58(),
        feePayer: feePayer.publicKey.toBase58(),
        agent: args.agent.toBase58(),
        klendProgramId: args.klendProgramId.toBase58(),
        usdcMint: args.usdcMint.toBase58(),
        sourceTokenAccountIndex,
        thresholdAtomic: args.thresholdAtomic.toString(),
        dataOperator: dataOperatorName(args.thresholdOperator),
        templateInstructionsFile: args.templateInstructionsFile,
        templateInstructionIndex: selectedTemplateInstruction.instructionIndex,
        depositInstructionName: selectedTemplateInstruction.definition.name,
        depositInstructionDiscriminator: Buffer.from(
          selectedTemplateInstruction.definition.discriminator
        ).toString("hex"),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Failed to create Kamino lending policy."
  );
  process.exit(1);
});
