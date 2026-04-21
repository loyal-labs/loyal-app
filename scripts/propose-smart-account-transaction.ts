import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { PROGRAM_ADDRESS, pda } from "../sdk/loyal-smart-accounts/src/index.ts";
import {
  Settings,
  Policy,
  settingsDiscriminator,
  toBigInt,
  transactionMessageToMultisigTransactionMessageBytes,
} from "../sdk/loyal-smart-accounts-core/src/index.ts";
import { createSmartAccountVaultsClient } from "../packages/smart-account-vaults/src/index.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  type AccountMeta,
  type MessageV0,
} from "@solana/web3.js";

type SolTransferArgs = {
  kind: "sol";
  amountLamports: bigint;
};

type SplTransferArgs = {
  kind: "spl";
  mint: PublicKey;
  amount: bigint;
  decimals: number;
  destinationTokenAccount?: PublicKey;
  tokenProgramId?: PublicKey;
  createDestinationAta: boolean;
};

type CustomInstructionsArgs = {
  kind: "custom";
  instructionsFile: string;
  policyPda: PublicKey | null;
  instructionIndices: number[] | null;
  instructionConstraintIndices?: Uint8Array;
  approve: boolean;
  execute: boolean;
};

type TransferArgs = SolTransferArgs | SplTransferArgs | CustomInstructionsArgs;

type ParsedArgs = {
  settingsPda: PublicKey | null;
  userAddress: PublicKey | null;
  keypairPath: string;
  destination: PublicKey | null;
  accountIndex: number;
  memo?: string;
  rpcUrl: string;
  programId: PublicKey;
  transfer: TransferArgs;
};

function printHelpAndExit(): never {
  console.log(`Usage:
  bun run smart-accounts:propose (--settings-pda <PUBKEY> | --user <PUBKEY> | --policy-pda <PUBKEY>) [options]

Account selector (one required):
  --settings-pda <PUBKEY>              Smart-account Settings PDA (fast exact path)
  --user <PUBKEY>                      User wallet/signer address; resolves Settings PDA on-chain
  --policy-pda <PUBKEY>                Policy PDA for Agent-controlled policy transactions

Required for SOL/SPL transfer modes:
  --to <PUBKEY>                        Destination wallet address

Signer:
  --keypair <PATH>                     Solana keypair JSON path
                                       Default: ~/.config/solana/id.json

Routing:
  --vault-index <NUMBER>               Vault account index
  --account-index <NUMBER>             Alias for --vault-index
                                       Default: 0
  --memo <TEXT>                        Optional memo for the stored transaction
  --rpc-url <URL>                      Override RPC endpoint
  --program-id <PUBKEY>                Override Smart Account program id

SOL transfer mode:
  --amount-sol <DECIMAL>               SOL amount to propose

SPL transfer mode:
  --mint <PUBKEY>                      Token mint
  --amount <DECIMAL>                   Token amount in UI units
  --decimals <NUMBER>                  Token decimals
  --destination-token-account <PUBKEY> Explicit destination token account
  --token-program-id <PUBKEY>          Override token program
  --no-create-destination-ata          Do not create ATA if missing

Custom instruction mode:
  --instructions-file <PATH>           JSON instructions file. Supports Kamino KTX
                                       deposit-instructions responses and generic
                                       { instructions: [{ programId, data, keys }] }.
  --instruction-index <N>              Use only one instruction from the file.
  --instruction-indices <CSV>          Use only selected instruction indices from the file.
  --instruction-constraint-indices <CSV>
                                       Policy instruction constraint index per
                                       instruction. Default: 0 for every instruction.
  --approve                            Also approve the proposal with this signer
  --execute                            Also execute after approval. For --policy-pda,
                                       execution uses the same custom instruction file.

Examples:
  bun run smart-accounts:propose \\
    --settings-pda <SETTINGS> \\
    --to <RECIPIENT> \\
    --amount-sol 0.25

  bun run smart-accounts:propose \\
    --user <USER_WALLET> \\
    --vault-index 0 \\
    --to <RECIPIENT> \\
    --amount-sol 0.25

  bun run smart-accounts:propose \\
    --user <USER_WALLET> \\
    --to <RECIPIENT> \\
    --mint <MINT> \\
    --amount 10.5 \\
    --decimals 6

  bun run smart-accounts:propose \\
    --policy-pda <POLICY> \\
    --vault-index 0 \\
    --instructions-file kamino-deposit-instructions.json \\
    --instruction-index <DEPOSIT_INDEX> \\
    --keypair agent.json \\
    --approve \\
    --execute
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

function requireArg(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }

  return value;
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

  const paddedFraction = fraction.padEnd(decimals, "0");
  return BigInt(`${whole}${paddedFraction}`);
}

function parseCsvU8(value: string): Uint8Array {
  if (!value.trim()) {
    return new Uint8Array();
  }

  return Uint8Array.from(
    value.split(",").map((entry) => {
      const parsed = Number.parseInt(entry.trim(), 10);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
        throw new Error(`Invalid u8 value in CSV: ${entry}`);
      }
      return parsed;
    })
  );
}

function parseCsvIndices(value: string): number[] {
  if (!value.trim()) {
    return [];
  }

  return value.split(",").map((entry) => {
    const parsed = Number.parseInt(entry.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Invalid instruction index in CSV: ${entry}`);
    }
    return parsed;
  });
}

function decodeInstructionData(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(
      value.map((entry) => {
        if (!Number.isInteger(entry) || entry < 0 || entry > 255) {
          throw new Error(`Invalid instruction data byte: ${entry}`);
        }
        return entry;
      })
    );
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

function parseLookupTableAddresses(raw: unknown): PublicKey[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const document = raw as Record<string, unknown>;
  const addresses = new Set<string>();
  const explicit =
    document.addressLookupTableAddresses ?? document.lookupTables;

  if (Array.isArray(explicit)) {
    for (const entry of explicit) {
      if (typeof entry === "string") {
        addresses.add(entry);
      }
    }
  }

  if (document.lutsByAddress && typeof document.lutsByAddress === "object") {
    for (const address of Object.keys(document.lutsByAddress)) {
      addresses.add(address);
    }
  }

  return [...addresses].map((address) => new PublicKey(address));
}

function parseInstructionsDocument(filePath: string): {
  instructions: TransactionInstruction[];
  lookupTableAddresses: PublicKey[];
} {
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

  return {
    instructions: rawInstructions.map(parseInstruction),
    lookupTableAddresses: parseLookupTableAddresses(raw),
  };
}

function selectInstructionsByIndex(args: {
  instructions: TransactionInstruction[];
  instructionIndices: number[] | null;
}): TransactionInstruction[] {
  if (args.instructionIndices === null) {
    return args.instructions;
  }

  if (args.instructionIndices.length === 0) {
    throw new Error(
      "--instruction-indices must select at least one instruction."
    );
  }

  return args.instructionIndices.map((instructionIndex) => {
    const instruction = args.instructions[instructionIndex];
    if (!instruction) {
      throw new Error(
        `--instruction-index ${instructionIndex} is out of bounds.`
      );
    }
    return instruction;
  });
}

async function loadAddressLookupTableAccounts(args: {
  connection: Connection;
  addresses: PublicKey[];
}): Promise<AddressLookupTableAccount[]> {
  const accounts: AddressLookupTableAccount[] = [];

  for (const address of args.addresses) {
    const response = await args.connection.getAddressLookupTable(address);
    if (!response.value) {
      throw new Error(`Address lookup table not found: ${address.toBase58()}`);
    }
    accounts.push(response.value);
  }

  return accounts;
}

function buildExecutionAccountsForCompiledMessage(args: {
  compiledMessage: MessageV0;
  lookupTableAccounts: AddressLookupTableAccount[];
  vaultPda: PublicKey;
}): AccountMeta[] {
  const metas: AccountMeta[] = [];
  const lookupTablesByAddress = new Map(
    args.lookupTableAccounts.map((account) => [account.key.toBase58(), account])
  );

  metas.push(
    ...args.compiledMessage.addressTableLookups.map((lookup) => ({
      pubkey: lookup.accountKey,
      isWritable: false,
      isSigner: false,
    }))
  );

  for (const [
    index,
    accountKey,
  ] of args.compiledMessage.staticAccountKeys.entries()) {
    metas.push({
      pubkey: accountKey,
      isWritable: args.compiledMessage.isAccountWritable(index),
      isSigner:
        args.compiledMessage.isAccountSigner(index) &&
        !accountKey.equals(args.vaultPda),
    });
  }

  for (const lookup of args.compiledMessage.addressTableLookups) {
    const table = lookupTablesByAddress.get(lookup.accountKey.toBase58());
    if (!table) {
      throw new Error(
        `Compiled message references unloaded lookup table ${lookup.accountKey.toBase58()}`
      );
    }

    for (const index of lookup.writableIndexes) {
      const pubkey = table.state.addresses[index];
      if (!pubkey) {
        throw new Error(
          `Lookup table ${lookup.accountKey.toBase58()} is missing writable index ${index}`
        );
      }
      metas.push({ pubkey, isWritable: true, isSigner: false });
    }

    for (const index of lookup.readonlyIndexes) {
      const pubkey = table.state.addresses[index];
      if (!pubkey) {
        throw new Error(
          `Lookup table ${lookup.accountKey.toBase58()} is missing readonly index ${index}`
        );
      }
      metas.push({ pubkey, isWritable: false, isSigner: false });
    }
  }

  return metas;
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

function parseArgs(argv: string[]): ParsedArgs {
  let settingsPda: PublicKey | null = null;
  let userAddress: PublicKey | null = null;
  let policyPda: PublicKey | null = null;
  let keypairPath = "~/.config/solana/id.json";
  let destination: PublicKey | null = null;
  let accountIndex = 0;
  let memo: string | undefined;
  let rpcUrl = resolveDefaultRpcUrl();
  let programId = resolveDefaultProgramId();
  let amountSol: string | undefined;
  let mint: PublicKey | undefined;
  let amount: string | undefined;
  let decimals: number | undefined;
  let destinationTokenAccount: PublicKey | undefined;
  let tokenProgramId: PublicKey | undefined;
  let createDestinationAta = true;
  let instructionsFile: string | undefined;
  let instructionIndices: number[] | null = null;
  let instructionConstraintIndices: Uint8Array | undefined;
  let approve = false;
  let execute = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--settings-pda" && next) {
      settingsPda = new PublicKey(next);
      index += 1;
      continue;
    }

    if (
      (current === "--user" ||
        current === "--user-address" ||
        current === "--wallet") &&
      next
    ) {
      userAddress = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--policy-pda" && next) {
      policyPda = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--keypair" && next) {
      keypairPath = next;
      index += 1;
      continue;
    }

    if (current === "--to" && next) {
      destination = new PublicKey(next);
      index += 1;
      continue;
    }

    if (
      (current === "--account-index" || current === "--vault-index") &&
      next
    ) {
      accountIndex = Number.parseInt(next, 10);
      index += 1;
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

    if (current === "--amount-sol" && next) {
      amountSol = next;
      index += 1;
      continue;
    }

    if (current === "--mint" && next) {
      mint = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--amount" && next) {
      amount = next;
      index += 1;
      continue;
    }

    if (current === "--decimals" && next) {
      decimals = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (current === "--destination-token-account" && next) {
      destinationTokenAccount = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--token-program-id" && next) {
      tokenProgramId = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--no-create-destination-ata") {
      createDestinationAta = false;
      continue;
    }

    if (current === "--instructions-file" && next) {
      instructionsFile = next;
      index += 1;
      continue;
    }

    if (current === "--instruction-index" && next) {
      instructionIndices = parseCsvIndices(next);
      if (instructionIndices.length !== 1) {
        throw new Error("--instruction-index expects exactly one index.");
      }
      index += 1;
      continue;
    }

    if (current === "--instruction-indices" && next) {
      instructionIndices = parseCsvIndices(next);
      index += 1;
      continue;
    }

    if (current === "--instruction-constraint-indices" && next) {
      instructionConstraintIndices = parseCsvU8(next);
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

  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error("--account-index must be a non-negative integer");
  }

  if (!settingsPda && !userAddress && !policyPda) {
    throw new Error(
      "Missing account selector. Provide --settings-pda, --user, or --policy-pda."
    );
  }

  if (instructionsFile) {
    if (destination || amountSol || mint || amount || decimals !== undefined) {
      throw new Error(
        "Use either --instructions-file for custom instructions, --amount-sol for SOL, or --mint/--amount/--decimals for SPL."
      );
    }

    if ((approve || execute) && !policyPda && !settingsPda && !userAddress) {
      throw new Error(
        "--approve/--execute requires a consensus account selector."
      );
    }

    return {
      settingsPda,
      userAddress,
      keypairPath,
      destination: null,
      accountIndex,
      memo,
      rpcUrl,
      programId,
      transfer: {
        kind: "custom",
        instructionsFile,
        policyPda,
        instructionIndices,
        instructionConstraintIndices,
        approve,
        execute,
      },
    };
  }

  if (policyPda) {
    throw new Error("--policy-pda is supported with --instructions-file mode.");
  }

  const parsedDestination = new PublicKey(
    requireArg("--to", destination?.toBase58())
  );

  if (amountSol) {
    if (mint || amount || decimals !== undefined) {
      throw new Error(
        "Use either --amount-sol for SOL or --mint/--amount/--decimals for SPL."
      );
    }

    return {
      settingsPda,
      userAddress,
      keypairPath,
      destination: parsedDestination,
      accountIndex,
      memo,
      rpcUrl,
      programId,
      transfer: {
        kind: "sol",
        amountLamports: parseUiAmountToAtomic(amountSol, 9),
      },
    };
  }

  if (!mint || !amount || decimals === undefined) {
    throw new Error(
      "Missing transfer mode. Provide --amount-sol or --mint, --amount, and --decimals."
    );
  }

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("--decimals must be a non-negative integer");
  }

  return {
    settingsPda,
    userAddress,
    keypairPath,
    destination: parsedDestination,
    accountIndex,
    memo,
    rpcUrl,
    programId,
    transfer: {
      kind: "spl",
      mint,
      amount: parseUiAmountToAtomic(amount, decimals),
      decimals,
      destinationTokenAccount,
      tokenProgramId,
      createDestinationAta,
    },
  };
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
      `No smart-account Settings account found for user ${args.userAddress.toBase58()}. ` +
        "Use --settings-pda if this wallet is not a Settings signer."
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Found multiple Settings accounts for user ${args.userAddress.toBase58()}: ` +
        matches.map((match) => match.address.toBase58()).join(", ") +
        ". Re-run with --settings-pda to choose one explicitly."
    );
  }

  return matches[0].address;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const signer = loadKeypair(args.keypairPath);
  const connection = new Connection(args.rpcUrl, {
    commitment: "confirmed",
  });
  const client = createSmartAccountVaultsClient({
    connection,
    programId: args.programId,
  });
  let policy: Policy | null = null;
  let settingsPda: PublicKey;
  let consensusPda: PublicKey;
  let nextTransactionIndex: bigint;
  let vaultPda: PublicKey;
  let customInstructionCount = 0;
  let customLookupTableCount = 0;
  let policyExecutionAccounts: AccountMeta[] | null = null;

  if (args.transfer.kind === "custom" && args.transfer.policyPda) {
    policy = await client.sdk.policies.queries.fetchPolicy(
      args.transfer.policyPda
    );
    settingsPda = policy.settings;
    consensusPda = args.transfer.policyPda;
    nextTransactionIndex = toBigInt(policy.transactionIndex) + 1n;
    vaultPda = pda.getSmartAccountPda({
      settingsPda,
      accountIndex: args.accountIndex,
      programId: args.programId,
    })[0];

    const isSignerOnPolicy = policy.signers.some((entry) =>
      entry.key.equals(signer.publicKey)
    );
    if (!isSignerOnPolicy) {
      throw new Error(
        `Signer ${signer.publicKey.toBase58()} is not a member of policy ${consensusPda.toBase58()}.`
      );
    }
  } else {
    settingsPda =
      args.settingsPda ??
      (await resolveSettingsPdaFromUser({
        connection,
        programId: args.programId,
        userAddress: args.userAddress!,
      }));
    consensusPda = settingsPda;

    const settings = await client.sdk.smartAccounts.queries.fetchSettings(
      settingsPda
    );
    const isSignerOnSettings = settings.signers.some((entry) =>
      entry.key.equals(signer.publicKey)
    );

    if (!isSignerOnSettings) {
      throw new Error(
        `Signer ${signer.publicKey.toBase58()} is not a member of ${settingsPda.toBase58()}.`
      );
    }

    nextTransactionIndex = toBigInt(settings.transactionIndex) + 1n;
    vaultPda = pda.getSmartAccountPda({
      settingsPda,
      accountIndex: args.accountIndex,
      programId: args.programId,
    })[0];
  }

  const prepared =
    args.transfer.kind === "sol"
      ? await client.prepareSolTransferProposal({
          settingsPda,
          creator: signer.publicKey,
          feePayer: signer.publicKey,
          destination: args.destination!,
          amountLamports: args.transfer.amountLamports,
          accountIndex: args.accountIndex,
          memo: args.memo,
        })
      : args.transfer.kind === "spl"
      ? await client.prepareSplTransferProposal({
          settingsPda,
          creator: signer.publicKey,
          feePayer: signer.publicKey,
          mint: args.transfer.mint,
          destinationOwner: args.destination!,
          amount: args.transfer.amount,
          decimals: args.transfer.decimals,
          accountIndex: args.accountIndex,
          destinationTokenAccount: args.transfer.destinationTokenAccount,
          memo: args.memo,
          tokenProgramId: args.transfer.tokenProgramId,
          createDestinationAta: args.transfer.createDestinationAta,
        })
      : await (async () => {
          const custom = parseInstructionsDocument(
            args.transfer.instructionsFile
          );
          const instructions = selectInstructionsByIndex({
            instructions: custom.instructions,
            instructionIndices: args.transfer.instructionIndices,
          });
          const addressLookupTableAccounts =
            await loadAddressLookupTableAccounts({
              connection,
              addresses: custom.lookupTableAddresses,
            });
          customInstructionCount = instructions.length;
          customLookupTableCount = addressLookupTableAccounts.length;

          if (args.transfer.policyPda) {
            const message = new TransactionMessage({
              payerKey: vaultPda,
              recentBlockhash: (
                await connection.getLatestBlockhash("confirmed")
              ).blockhash,
              instructions,
            });
            const { compiledMessage } =
              transactionMessageToMultisigTransactionMessageBytes({
                message,
                addressLookupTableAccounts,
                smartAccountPda: vaultPda,
              });
            policyExecutionAccounts = buildExecutionAccountsForCompiledMessage({
              compiledMessage,
              lookupTableAccounts: addressLookupTableAccounts,
              vaultPda,
            });

            return client.preparePolicyCustomInstructionProposal({
              policyPda: args.transfer.policyPda,
              creator: signer.publicKey,
              feePayer: signer.publicKey,
              instructions,
              accountIndex: args.accountIndex,
              addressLookupTableAccounts,
              instructionConstraintIndices:
                args.transfer.instructionConstraintIndices,
              memo: args.memo,
            });
          }

          return client.prepareCustomInstructionProposal({
            settingsPda,
            creator: signer.publicKey,
            feePayer: signer.publicKey,
            instructions,
            accountIndex: args.accountIndex,
            addressLookupTableAccounts,
            memo: args.memo,
          });
        })();

  const signature = await client.sdk.send(prepared, {
    signers: [signer],
  });
  const [transactionPda] = pda.getTransactionPda({
    settingsPda: consensusPda,
    transactionIndex: nextTransactionIndex,
    programId: args.programId,
  });
  const [proposalPda] = pda.getProposalPda({
    settingsPda: consensusPda,
    transactionIndex: nextTransactionIndex,
    programId: args.programId,
  });
  const followUpSignatures: Record<string, string> = {};

  if (args.transfer.kind === "custom" && args.transfer.approve) {
    const approvePrepared = client.prepareApproveProposal({
      settingsPda: consensusPda,
      transactionIndex: nextTransactionIndex,
      signer: signer.publicKey,
      feePayer: signer.publicKey,
    });
    followUpSignatures.approve = await client.sdk.send(approvePrepared, {
      signers: [signer],
    });
  }

  if (args.transfer.kind === "custom" && args.transfer.execute) {
    const executePrepared = args.transfer.policyPda
      ? await client.sdk.features.execution.prepare.executePolicyTransaction({
          feePayer: signer.publicKey,
          policy: args.transfer.policyPda,
          transactionIndex: nextTransactionIndex,
          signer: signer.publicKey,
          anchorRemainingAccounts: policyExecutionAccounts ?? [],
          programId: args.programId,
        } as never)
      : await client.prepareExecuteProposal({
          settingsPda,
          transactionIndex: nextTransactionIndex,
          signer: signer.publicKey,
          feePayer: signer.publicKey,
        });

    followUpSignatures.execute = await client.sdk.send(executePrepared, {
      signers: [signer],
    });
  }

  console.log(
    JSON.stringify(
      {
        signature,
        followUpSignatures,
        rpcUrl: args.rpcUrl,
        programId: args.programId.toBase58(),
        settingsPda: settingsPda.toBase58(),
        consensusPda: consensusPda.toBase58(),
        policyPda: policy ? consensusPda.toBase58() : null,
        resolvedBy: policy
          ? "policy-pda"
          : args.settingsPda
          ? "settings-pda"
          : "user",
        userAddress: args.userAddress?.toBase58() ?? null,
        signer: signer.publicKey.toBase58(),
        accountIndex: args.accountIndex,
        vaultPda: vaultPda.toBase58(),
        transactionIndex: nextTransactionIndex.toString(),
        transactionPda: transactionPda.toBase58(),
        proposalPda: proposalPda.toBase58(),
        transfer:
          args.transfer.kind === "sol"
            ? {
                kind: "sol",
                amountLamports: args.transfer.amountLamports.toString(),
                destination: args.destination?.toBase58(),
              }
            : args.transfer.kind === "spl"
            ? {
                kind: "spl",
                mint: args.transfer.mint.toBase58(),
                amount: args.transfer.amount.toString(),
                decimals: args.transfer.decimals,
                destinationOwner: args.destination?.toBase58(),
                destinationTokenAccount:
                  args.transfer.destinationTokenAccount?.toBase58() ?? null,
                createDestinationAta: args.transfer.createDestinationAta,
              }
            : {
                kind: "custom",
                instructionsFile: args.transfer.instructionsFile,
                selectedInstructionIndices: args.transfer.instructionIndices,
                instructionCount: customInstructionCount,
                lookupTableCount: customLookupTableCount,
                instructionConstraintIndices: args.transfer
                  .instructionConstraintIndices
                  ? Array.from(args.transfer.instructionConstraintIndices)
                  : null,
                approve: args.transfer.approve,
                execute: args.transfer.execute,
              },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Failed to propose transaction."
  );
  process.exit(1);
});
