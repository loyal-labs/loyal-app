import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  SystemProgram,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";

export function wrapSolToWsolIx({
  user,
  payer,
  lamports,
}: {
  user: PublicKey;
  payer: PublicKey;
  lamports: bigint;
}): TransactionInstruction[] {
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, user);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      wsolAta,
      user,
      NATIVE_MINT
    ),
    SystemProgram.transfer({
      fromPubkey: user,
      toPubkey: wsolAta,
      lamports,
    }),
    createSyncNativeInstruction(wsolAta),
  ];
}

export function createWsolAta({
  user,
  payer,
}: {
  user: PublicKey;
  payer: PublicKey;
}): TransactionInstruction {
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, user);
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    wsolAta,
    user,
    NATIVE_MINT
  );
}

export function closeWsolAta({
  user,
  destination,
}: {
  user: PublicKey;
  destination: PublicKey;
}): TransactionInstruction {
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, user);
  return createCloseAccountInstruction(wsolAta, destination, user);
}
