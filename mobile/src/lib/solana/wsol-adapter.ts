import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  NATIVE_MINT,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";

export async function wrapSolToWSol(opts: {
  connection: Connection;
  keypair: Keypair;
  lamports: number;
}): Promise<{ wsolAta: PublicKey; createdAta: boolean }> {
  const { connection, keypair, lamports } = opts;

  const wsolAta = await getAssociatedTokenAddress(
    NATIVE_MINT,
    keypair.publicKey,
  );

  const tx = new Transaction();
  let createdAta = false;

  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    createdAta = true;
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        wsolAta,
        keypair.publicKey,
        NATIVE_MINT,
      ),
    );
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: wsolAta,
      lamports,
    }),
  );

  tx.add(createSyncNativeInstruction(wsolAta));

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  return { wsolAta, createdAta };
}

export async function closeWsolAta(opts: {
  connection: Connection;
  keypair: Keypair;
  wsolAta: PublicKey;
}): Promise<void> {
  const { connection, keypair, wsolAta } = opts;

  try {
    const tx = new Transaction().add(
      createCloseAccountInstruction(
        wsolAta,
        keypair.publicKey,
        keypair.publicKey,
      ),
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);

    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
  } catch (error) {
    console.error("Failed to close wSOL ATA", error);
  }
}
