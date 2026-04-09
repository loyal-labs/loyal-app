import { Keypair, Transaction, SystemProgram, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { LocalKeypairSigner } from "../signer";

describe("LocalKeypairSigner", () => {
  const keypair = Keypair.generate();
  const signer = new LocalKeypairSigner(keypair);

  it("exposes kind and publicKey", () => {
    expect(signer.kind).toBe("local");
    expect(signer.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it("signs arbitrary messages compatibly with tweetnacl", async () => {
    const message = new TextEncoder().encode("hello loyal");
    const signature = await signer.signMessage(message);
    const valid = nacl.sign.detached.verify(
      message,
      signature,
      keypair.publicKey.toBytes(),
    );
    expect(valid).toBe(true);
  });

  it("signs legacy transactions via partialSign", async () => {
    const destination = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: destination,
        lamports: 1,
      }),
    );
    tx.feePayer = keypair.publicKey;
    // Deterministic blockhash for test
    tx.recentBlockhash = new PublicKey(
      "11111111111111111111111111111112",
    ).toBase58();

    await signer.signTransaction(tx);

    expect(tx.signatures.length).toBe(1);
    expect(tx.signatures[0].publicKey.toBase58()).toBe(
      keypair.publicKey.toBase58(),
    );
    expect(tx.signatures[0].signature).not.toBeNull();
    expect(tx.verifySignatures()).toBe(true);
  });

  it("signs multiple transactions in batch", async () => {
    const destination = Keypair.generate().publicKey;
    const blockhash = new PublicKey(
      "11111111111111111111111111111112",
    ).toBase58();

    const txs = [0, 1, 2].map((i) => {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: destination,
          lamports: i + 1,
        }),
      );
      tx.feePayer = keypair.publicKey;
      tx.recentBlockhash = blockhash;
      return tx;
    });

    await signer.signAllTransactions(txs);

    for (const tx of txs) {
      expect(tx.verifySignatures()).toBe(true);
    }
  });

  it("exposes secretKey hex for local backup only", () => {
    const hex = signer.getSecretKeyHex();
    expect(hex).toHaveLength(128); // 64 bytes * 2 hex chars
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});
