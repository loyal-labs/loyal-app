import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ADDRESS,
  pda,
} from "../packages/loyal-smart-accounts/src/index.ts";
import { createLoyalSmartAccountsClient } from "../packages/loyal-smart-accounts/src/client.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";

type ParsedArgs = {
  settingsPda: PublicKey;
  transactionIndex: bigint;
  signerKeypairPath: string;
  feePayerKeypairPath: string | null;
  policyPdas: PublicKey[];
  rpcUrl: string;
  programId: PublicKey;
};

function printHelpAndExit(): never {
  console.log(`Usage:
  bun run scripts/execute-smart-account-settings-transaction.ts --settings-pda <PUBKEY> --transaction-index <N> --keypair <SETTINGS_SIGNER> [options]

Required:
  --settings-pda <PUBKEY>              Smart-account Settings PDA
  --transaction-index <N>              Existing settings transaction index
  --keypair <PATH>                     Current Settings signer keypair

Options:
  --fee-payer-keypair <PATH>           Fee/rent payer keypair. Defaults to --keypair.
  --policy-pda <PUBKEY>                Policy PDA required by PolicyCreate. Repeatable.
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

function requireArg(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
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
  let transactionIndex: bigint | null = null;
  let signerKeypairPath: string | undefined;
  let feePayerKeypairPath: string | null = null;
  const policyPdas: PublicKey[] = [];
  let rpcUrl = resolveDefaultRpcUrl();
  let programId = resolveDefaultProgramId();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--settings-pda" && next) {
      settingsPda = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--transaction-index" && next) {
      transactionIndex = BigInt(next);
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

    if (current === "--policy-pda" && next) {
      policyPdas.push(new PublicKey(next));
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

    if (current === "--help" || current === "-h") {
      printHelpAndExit();
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  if (transactionIndex !== null && transactionIndex <= 0n) {
    throw new Error("--transaction-index must be positive.");
  }

  return {
    settingsPda: new PublicKey(
      requireArg("--settings-pda", settingsPda?.toBase58())
    ),
    transactionIndex: BigInt(
      requireArg("--transaction-index", transactionIndex?.toString())
    ),
    signerKeypairPath: requireArg("--keypair", signerKeypairPath),
    feePayerKeypairPath,
    policyPdas,
    rpcUrl,
    programId,
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
  const signer = loadKeypair(args.signerKeypairPath);
  const feePayer = args.feePayerKeypairPath
    ? loadKeypair(args.feePayerKeypairPath)
    : signer;
  const connection = new Connection(args.rpcUrl, { commitment: "confirmed" });
  const client = createLoyalSmartAccountsClient({
    connection,
    programId: args.programId,
    defaultCommitment: "confirmed",
  });

  const prepared =
    await client.features.execution.prepare.executeSettingsTransaction({
      feePayer: feePayer.publicKey,
      rentPayer: feePayer.publicKey,
      settingsPda: args.settingsPda,
      transactionIndex: args.transactionIndex,
      signer: signer.publicKey,
      policies: args.policyPdas,
    } as never);
  const signature = await client.send(prepared, {
    signers: dedupeSigners([feePayer, signer]),
    confirm: true,
  });
  const [transactionPda] = pda.getTransactionPda({
    settingsPda: args.settingsPda,
    transactionIndex: args.transactionIndex,
    programId: args.programId,
  });
  const [proposalPda] = pda.getProposalPda({
    settingsPda: args.settingsPda,
    transactionIndex: args.transactionIndex,
    programId: args.programId,
  });

  console.log(
    JSON.stringify(
      {
        signature,
        rpcUrl: args.rpcUrl,
        programId: args.programId.toBase58(),
        settingsPda: args.settingsPda.toBase58(),
        transactionIndex: args.transactionIndex.toString(),
        transactionPda: transactionPda.toBase58(),
        proposalPda: proposalPda.toBase58(),
        signer: signer.publicKey.toBase58(),
        feePayer: feePayer.publicKey.toBase58(),
        policyPdas: args.policyPdas.map((policyPda) => policyPda.toBase58()),
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
      : "Failed to execute settings transaction."
  );
  process.exit(1);
});
