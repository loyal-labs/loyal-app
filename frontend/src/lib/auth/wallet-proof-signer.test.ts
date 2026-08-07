import { describe, expect, test } from "bun:test";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  signWalletProofTransaction,
  WalletProofSignerError,
} from "./wallet-proof-signer";

function buildChallengeTransactionBase64(feePayer: PublicKey): string {
  const transaction = new Transaction({
    feePayer,
    recentBlockhash: "11111111111111111111111111111111",
  }).add(
    new TransactionInstruction({
      keys: [{ isSigner: true, isWritable: false, pubkey: feePayer }],
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      data: Buffer.from("loyal login proof", "utf8"),
    })
  );

  return transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

// Brave Wallet refuses to sign the non-broadcastable proof transaction after
// pre-validating its placeholder blockhash on-chain (ASK-2049). That refusal
// must classify as `wallet_signing_unsupported` with a self-serve message, not
// bubble as an opaque signing failure.
describe("signWalletProofTransaction", () => {
  const transaction = buildChallengeTransactionBase64(
    Keypair.generate().publicKey
  );

  test("classifies a wallet blockhash-validation refusal as unsupported", async () => {
    const promise = signWalletProofTransaction({
      signTransaction: () =>
        Promise.reject(
          new Error("Blockhash is invalid or can not be validated")
        ),
      transaction,
    });

    await expect(promise).rejects.toBeInstanceOf(WalletProofSignerError);
    await promise.catch((error: WalletProofSignerError) => {
      expect(error.code).toBe("wallet_signing_unsupported");
      expect(error.message).toContain("I use Ledger or hardware wallet");
    });
  });

  test("still classifies an explicit user rejection as rejected", async () => {
    const promise = signWalletProofTransaction({
      signTransaction: () =>
        Promise.reject(new Error("User rejected the request.")),
      transaction,
    });

    await promise.catch((error: WalletProofSignerError) => {
      expect(error).toBeInstanceOf(WalletProofSignerError);
      expect(error.code).toBe("wallet_signature_rejected");
    });
  });
});
