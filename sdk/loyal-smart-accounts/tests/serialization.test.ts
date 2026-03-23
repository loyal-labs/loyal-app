import { describe, expect, it } from "bun:test";
import { Keypair, TransactionMessage } from "@solana/web3.js";
import { codecs } from "../index";

describe("serialization helpers", () => {
  it("round-trips a compiled instruction", () => {
    const [bytes] = codecs.compiledMsInstructionBeet.serialize({
      programIdIndex: 1,
      accountIndexes: [0, 2],
      data: [7, 8, 9],
    });
    const decoded = codecs.compiledMsInstructionBeet.deserialize(Buffer.from(bytes))[0];

    expect(decoded.programIdIndex).toBe(1);
    expect(decoded.accountIndexes).toEqual([0, 2]);
    expect(decoded.data).toEqual([7, 8, 9]);
  });

  it("serializes a wrapped transaction message", () => {
    const payer = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        {
          programId: Keypair.generate().publicKey,
          keys: [{ pubkey: recipient, isSigner: false, isWritable: true }],
          data: Buffer.from([1, 2, 3]),
        },
      ],
    });

    const result = codecs.transactionMessageToMultisigTransactionMessageBytes({
      message,
      smartAccountPda: payer,
    });
    const decoded = codecs.transactionMessageBeet.deserialize(
      Buffer.from(result.transactionMessageBytes)
    )[0];

    expect(decoded.accountKeys.length).toBeGreaterThan(0);
    expect(decoded.instructions.length).toBe(1);
  });
});
