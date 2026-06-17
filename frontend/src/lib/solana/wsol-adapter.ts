import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  NATIVE_MINT,
} from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import { SystemProgram, Transaction } from "@solana/web3.js";

type WalletSigner = {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction>(tx: T) => Promise<T>;
};

/**
 * Wrap native SOL into wSOL ATA using wallet adapter signing.
 * Equivalent to app/src/lib/solana/deposits/wsol-utils.ts but uses
 * wallet adapter signTransaction + sendRawTransaction instead of Keypair.
 */
export async function wrapSolToWSol(opts: {
  connection: Connection;
  wallet: WalletSigner;
  lamports: number;
}): Promise<{ wsolAta: PublicKey; createdAta: boolean }> {
  const { connection, wallet, lamports } = opts;

  const wsolAta = await getAssociatedTokenAddress(
    NATIVE_MINT,
    wallet.publicKey
  );

  const tx = new Transaction();
  let createdAta = false;

  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    createdAta = true;
    tx.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        wsolAta,
        wallet.publicKey,
        NATIVE_MINT
      )
    );
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wsolAta,
      lamports,
    })
  );

  tx.add(createSyncNativeInstruction(wsolAta));

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  return { wsolAta, createdAta };
}

/**
 * Close a wSOL ATA to recover rent + remaining SOL.
 */
export async function closeWsolAta(opts: {
  connection: Connection;
  wallet: WalletSigner;
  wsolAta: PublicKey;
}): Promise<void> {
  const { connection, wallet, wsolAta } = opts;

  try {
    const tx = new Transaction().add(
      createCloseAccountInstruction(wsolAta, wallet.publicKey, wallet.publicKey)
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    const signed = await wallet.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
  } catch (error) {
    console.error("Failed to close wSOL ATA", error);
  }
}
