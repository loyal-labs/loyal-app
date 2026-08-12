import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, test } from "bun:test";

import { validateGaslessStoreTransaction } from "./transaction-validation";

const createFixture = () => {
  const payer = Keypair.generate();
  const recipient = Keypair.generate();
  const session = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const expectedInstruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: recipient.publicKey, isSigner: true, isWritable: false },
      { pubkey: session, isSigner: false, isWritable: true },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: Buffer.from("canonical-store-instruction"),
  });
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(expectedInstruction);
  transaction.partialSign(recipient);

  return { expectedInstruction, payer, recipient, transaction };
};

describe("validateGaslessStoreTransaction", () => {
  test("accepts only the canonical store transaction signed by the recipient", () => {
    const { expectedInstruction, payer, recipient, transaction } =
      createFixture();

    expect(() =>
      validateGaslessStoreTransaction({
        transaction,
        expectedInstruction,
        payer: payer.publicKey,
        recipient: recipient.publicKey,
      })
    ).not.toThrow();
  });

  test("rejects a sponsor-funded system transfer", () => {
    const { expectedInstruction, payer, recipient } = createFixture();
    const maliciousTransaction = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1,
      })
    );

    expect(() =>
      validateGaslessStoreTransaction({
        transaction: maliciousTransaction,
        expectedInstruction,
        payer: payer.publicKey,
        recipient: recipient.publicKey,
      })
    ).toThrow("invalid program");
  });

  test("rejects a canonical instruction without the recipient signature", () => {
    const { expectedInstruction, payer, recipient } = createFixture();
    const unsignedTransaction = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(expectedInstruction);

    expect(() =>
      validateGaslessStoreTransaction({
        transaction: unsignedTransaction,
        expectedInstruction,
        payer: payer.publicKey,
        recipient: recipient.publicKey,
      })
    ).toThrow("valid recipient signature");
  });
});
