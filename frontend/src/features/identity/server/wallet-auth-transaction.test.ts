import { describe, expect, mock, test } from "bun:test";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

mock.module("server-only", () => ({}));

const {
  WALLET_AUTH_MEMO_PROGRAM_ID,
  createWalletAuthTransactionChallenge,
  verifyWalletAuthTransactionProof,
} = await import("./wallet-auth-transaction");

const MEMO = [
  "Sign in to askloyal",
  "",
  "Version: 1",
  "Origin: https://preview.askloyal.com",
  "Wallet: wallet-placeholder",
  "Nonce: abc12345",
  "Issued At: 2099-03-11T12:00:00.000Z",
  "Expires At: 2099-03-11T12:10:00.000Z",
  "",
  "This transaction only proves you control this wallet for Loyal sign-in.",
].join("\n");

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function createSignedProof(keypair: Keypair) {
  const challenge = createWalletAuthTransactionChallenge({
    blockhash: Keypair.generate().publicKey.toBase58(),
    memo: MEMO,
    walletAddress: keypair.publicKey.toBase58(),
  });
  const transaction = Transaction.from(fromBase64(challenge.transaction));
  transaction.sign(keypair);

  return {
    challenge,
    signedTransaction: toBase64(transaction.serialize()),
  };
}

describe("wallet transaction auth verification", () => {
  test("verifies a signed memo-only transaction and derives the address", () => {
    const keypair = Keypair.generate();
    const { challenge, signedTransaction } = createSignedProof(keypair);

    const walletAddress = verifyWalletAuthTransactionProof({
      memo: challenge.memo,
      signedTransaction,
      walletAddress: keypair.publicKey.toBase58(),
    });

    expect(walletAddress).toBe(keypair.publicKey.toBase58());
  });

  test("accepts wallet-refreshed blockhash with the same memo proof", () => {
    const keypair = Keypair.generate();
    const challenge = createWalletAuthTransactionChallenge({
      blockhash: Keypair.generate().publicKey.toBase58(),
      memo: MEMO,
      walletAddress: keypair.publicKey.toBase58(),
    });
    const transaction = Transaction.from(fromBase64(challenge.transaction));
    transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
    transaction.sign(keypair);

    const walletAddress = verifyWalletAuthTransactionProof({
      memo: challenge.memo,
      signedTransaction: toBase64(transaction.serialize()),
      walletAddress: keypair.publicKey.toBase58(),
    });

    expect(walletAddress).toBe(keypair.publicKey.toBase58());
  });

  test("accepts wallet-added compute budget instructions", () => {
    const keypair = Keypair.generate();
    const challenge = createWalletAuthTransactionChallenge({
      blockhash: Keypair.generate().publicKey.toBase58(),
      memo: MEMO,
      walletAddress: keypair.publicKey.toBase58(),
    });
    const transaction = Transaction.from(fromBase64(challenge.transaction));
    transaction.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
    );
    transaction.sign(keypair);

    const walletAddress = verifyWalletAuthTransactionProof({
      memo: challenge.memo,
      signedTransaction: toBase64(transaction.serialize()),
      walletAddress: keypair.publicKey.toBase58(),
    });

    expect(walletAddress).toBe(keypair.publicKey.toBase58());
  });

  test("rejects a changed memo", () => {
    const keypair = Keypair.generate();
    const { challenge, signedTransaction } = createSignedProof(keypair);

    expect(() =>
      verifyWalletAuthTransactionProof({
        memo: `${challenge.memo}\nchanged`,
        signedTransaction,
        walletAddress: keypair.publicKey.toBase58(),
      })
    ).toThrow("Wallet transaction memo is invalid.");
  });

  test("rejects a changed fee payer", () => {
    const keypair = Keypair.generate();
    const otherWalletAddress = Keypair.generate().publicKey.toBase58();
    const { challenge, signedTransaction } = createSignedProof(keypair);

    expect(() =>
      verifyWalletAuthTransactionProof({
        memo: challenge.memo,
        signedTransaction,
        walletAddress: otherWalletAddress,
      })
    ).toThrow("Wallet transaction fee payer is invalid.");
  });

  test("rejects an extra instruction", () => {
    const keypair = Keypair.generate();
    const challenge = createWalletAuthTransactionChallenge({
      blockhash: Keypair.generate().publicKey.toBase58(),
      memo: MEMO,
      walletAddress: keypair.publicKey.toBase58(),
    });
    const transaction = Transaction.from(fromBase64(challenge.transaction));
    transaction.add(
      new TransactionInstruction({
        keys: [],
        programId: SystemProgram.programId,
        data: Buffer.alloc(0),
      })
    );
    transaction.sign(keypair);

    expect(() =>
      verifyWalletAuthTransactionProof({
        memo: challenge.memo,
        signedTransaction: toBase64(transaction.serialize()),
        walletAddress: keypair.publicKey.toBase58(),
      })
    ).toThrow("Wallet transaction instructions are invalid.");
  });

  test("rejects compute budget instructions with accounts", () => {
    const keypair = Keypair.generate();
    const challenge = createWalletAuthTransactionChallenge({
      blockhash: Keypair.generate().publicKey.toBase58(),
      memo: MEMO,
      walletAddress: keypair.publicKey.toBase58(),
    });
    const transaction = Transaction.from(fromBase64(challenge.transaction));
    transaction.instructions.unshift(
      new TransactionInstruction({
        keys: [
          {
            isSigner: false,
            isWritable: false,
            pubkey: keypair.publicKey,
          },
        ],
        programId: ComputeBudgetProgram.programId,
        data: Buffer.from([2, 0, 0, 0, 0]),
      })
    );
    transaction.sign(keypair);

    expect(() =>
      verifyWalletAuthTransactionProof({
        memo: challenge.memo,
        signedTransaction: toBase64(transaction.serialize()),
        walletAddress: keypair.publicKey.toBase58(),
      })
    ).toThrow("Wallet transaction instructions are invalid.");
  });

  test("rejects an invalid fee-payer signature", () => {
    const keypair = Keypair.generate();
    const { challenge, signedTransaction } = createSignedProof(keypair);
    const bytes = fromBase64(signedTransaction);
    bytes[1] = (bytes[1] ?? 0) ^ 0xff;

    expect(() =>
      verifyWalletAuthTransactionProof({
        memo: challenge.memo,
        signedTransaction: toBase64(bytes),
        walletAddress: keypair.publicKey.toBase58(),
      })
    ).toThrow("Wallet transaction signature is invalid.");
  });

  test("rejects non-memo programs even with matching message bytes", () => {
    const keypair = Keypair.generate();
    const transaction = new Transaction({
      feePayer: keypair.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      new TransactionInstruction({
        keys: [],
        programId: WALLET_AUTH_MEMO_PROGRAM_ID,
        data: Buffer.from(MEMO, "utf8"),
      })
    );
    transaction.instructions[0] = new TransactionInstruction({
      keys: [],
      programId: SystemProgram.programId,
      data: Buffer.from(MEMO, "utf8"),
    });
    transaction.sign(keypair);

    expect(() =>
      verifyWalletAuthTransactionProof({
        memo: MEMO,
        signedTransaction: toBase64(transaction.serialize()),
        walletAddress: keypair.publicKey.toBase58(),
      })
    ).toThrow("Wallet transaction instructions are invalid.");
  });
});
