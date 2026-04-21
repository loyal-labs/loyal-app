import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  type Connection,
} from "@solana/web3.js";

function normalizeAccountIndex(accountIndex: number | undefined): number {
  return accountIndex ?? 0;
}

export async function createVaultSolTransferMessage(args: {
  connection: Connection;
  vaultPda: PublicKey;
  destination: PublicKey;
  amountLamports: bigint;
}) {
  const { blockhash } = await args.connection.getLatestBlockhash("confirmed");

  return new TransactionMessage({
    payerKey: args.vaultPda,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: args.vaultPda,
        toPubkey: args.destination,
        lamports: args.amountLamports,
      }),
    ],
  });
}

export async function createVaultSplTransferMessage(args: {
  connection: Connection;
  vaultPda: PublicKey;
  mint: PublicKey;
  destinationOwner: PublicKey;
  amount: bigint;
  decimals: number;
  destinationTokenAccount?: PublicKey;
  tokenProgramId?: PublicKey;
  createDestinationAta?: boolean;
}) {
  const { blockhash } = await args.connection.getLatestBlockhash("confirmed");
  const tokenProgramId = args.tokenProgramId ?? TOKEN_PROGRAM_ID;
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    args.mint,
    args.vaultPda,
    true,
    tokenProgramId
  );
  const destinationTokenAccount =
    args.destinationTokenAccount ??
    getAssociatedTokenAddressSync(
      args.mint,
      args.destinationOwner,
      false,
      tokenProgramId
    );
  const instructions = [];

  if (!args.destinationTokenAccount && (args.createDestinationAta ?? true)) {
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        args.vaultPda,
        destinationTokenAccount,
        args.destinationOwner,
        args.mint,
        tokenProgramId
      )
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      sourceTokenAccount,
      args.mint,
      destinationTokenAccount,
      args.vaultPda,
      args.amount,
      args.decimals,
      [],
      tokenProgramId
    )
  );

  return new TransactionMessage({
    payerKey: args.vaultPda,
    recentBlockhash: blockhash,
    instructions,
  });
}

export function isSupportedTokenProgram(programId: PublicKey): boolean {
  return (
    programId.equals(TOKEN_PROGRAM_ID) || programId.equals(TOKEN_2022_PROGRAM_ID)
  );
}

export function resolveVaultAccountIndex(accountIndex: number | undefined): number {
  return normalizeAccountIndex(accountIndex);
}
