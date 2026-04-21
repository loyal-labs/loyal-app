import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import {
  PROGRAM_ADDRESS,
  pda,
} from "../sdk/loyal-smart-accounts/src/index.ts";
import {
  Settings,
  settingsDiscriminator,
  toBigInt,
} from "../sdk/loyal-smart-accounts-core/src/index.ts";
import { createSmartAccountVaultsClient } from "../packages/smart-account-vaults/src/index.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

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

type ParsedArgs = {
  settingsPda: PublicKey | null;
  userAddress: PublicKey | null;
  keypairPath: string;
  destination: PublicKey;
  accountIndex: number;
  memo?: string;
  rpcUrl: string;
  programId: PublicKey;
  transfer: SolTransferArgs | SplTransferArgs;
};

function printHelpAndExit(): never {
  console.log(`Usage:
  bun run smart-accounts:propose (--settings-pda <PUBKEY> | --user <PUBKEY>) --to <PUBKEY> [options]

Account selector (one required):
  --settings-pda <PUBKEY>              Smart-account Settings PDA (fast exact path)
  --user <PUBKEY>                      User wallet/signer address; resolves Settings PDA on-chain

Required:
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
  const raw = JSON.parse(fs.readFileSync(resolvePath(filePath), "utf8")) as number[];
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

    if (current === "--help" || current === "-h") {
      printHelpAndExit();
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error("--account-index must be a non-negative integer");
  }

  if (!settingsPda && !userAddress) {
    throw new Error("Missing account selector. Provide --settings-pda or --user.");
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

    if (settings.signers.some((signer) => signer.key.equals(args.userAddress))) {
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
  const settingsPda =
    args.settingsPda ??
    (await resolveSettingsPdaFromUser({
      connection,
      programId: args.programId,
      userAddress: args.userAddress!,
    }));

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

  const nextTransactionIndex = toBigInt(settings.transactionIndex) + 1n;
  const prepared =
    args.transfer.kind === "sol"
      ? await client.prepareSolTransferProposal({
          settingsPda,
          creator: signer.publicKey,
          feePayer: signer.publicKey,
          destination: args.destination,
          amountLamports: args.transfer.amountLamports,
          accountIndex: args.accountIndex,
          memo: args.memo,
        })
      : await client.prepareSplTransferProposal({
          settingsPda,
          creator: signer.publicKey,
          feePayer: signer.publicKey,
          mint: args.transfer.mint,
          destinationOwner: args.destination,
          amount: args.transfer.amount,
          decimals: args.transfer.decimals,
          accountIndex: args.accountIndex,
          destinationTokenAccount: args.transfer.destinationTokenAccount,
          memo: args.memo,
          tokenProgramId: args.transfer.tokenProgramId,
          createDestinationAta: args.transfer.createDestinationAta,
        });

  const signature = await client.sdk.send(prepared, {
    signers: [signer],
  });
  const [transactionPda] = pda.getTransactionPda({
    settingsPda,
    transactionIndex: nextTransactionIndex,
    programId: args.programId,
  });
  const [proposalPda] = pda.getProposalPda({
    settingsPda,
    transactionIndex: nextTransactionIndex,
    programId: args.programId,
  });
  const [vaultPda] = pda.getSmartAccountPda({
    settingsPda,
    accountIndex: args.accountIndex,
    programId: args.programId,
  });

  console.log(
    JSON.stringify(
      {
        signature,
        rpcUrl: args.rpcUrl,
        programId: args.programId.toBase58(),
        settingsPda: settingsPda.toBase58(),
        resolvedBy: args.settingsPda ? "settings-pda" : "user",
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
                destination: args.destination.toBase58(),
              }
            : {
                kind: "spl",
                mint: args.transfer.mint.toBase58(),
                amount: args.transfer.amount.toString(),
                decimals: args.transfer.decimals,
                destinationOwner: args.destination.toBase58(),
                destinationTokenAccount:
                  args.transfer.destinationTokenAccount?.toBase58() ?? null,
                createDestinationAta: args.transfer.createDestinationAta,
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
