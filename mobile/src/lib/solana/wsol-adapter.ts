import type { Connection, PublicKey } from "@solana/web3.js";
import { SystemProgram, Transaction } from "@solana/web3.js";

import type { Signer } from "@/lib/wallet/signer";

// Lazy-load @solana/spl-token to avoid top-level Buffer usage
async function getSplToken() {
  return await import("@solana/spl-token");
}

export async function wrapSolToWSol(opts: {
  connection: Connection;
  signer: Signer;
  lamports: number;
}): Promise<{ wsolAta: PublicKey; createdAta: boolean }> {
  const { connection, signer, lamports } = opts;
  const {
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    getAssociatedTokenAddress,
    NATIVE_MINT,
  } = await getSplToken();

  const owner = signer.publicKey;
  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, owner);

  const tx = new Transaction();
  let createdAta = false;

  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    createdAta = true;
    tx.add(
      createAssociatedTokenAccountInstruction(
        owner,
        wsolAta,
        owner,
        NATIVE_MINT,
      ),
    );
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: wsolAta,
      lamports,
    }),
  );

  tx.add(createSyncNativeInstruction(wsolAta));

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner;
  await signer.signTransaction(tx);

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  return { wsolAta, createdAta };
}

export async function closeWsolAta(opts: {
  connection: Connection;
  signer: Signer;
  wsolAta: PublicKey;
}): Promise<void> {
  const { connection, signer, wsolAta } = opts;
  const { createCloseAccountInstruction } = await getSplToken();

  try {
    const owner = signer.publicKey;
    const tx = new Transaction().add(
      createCloseAccountInstruction(wsolAta, owner, owner),
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = owner;
    await signer.signTransaction(tx);

    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
  } catch (error) {
    console.error("Failed to close wSOL ATA", error);
  }
}
