import {
  freezePreparedOperation,
  compilePreparedOperation,
} from "@loyal-labs/loyal-smart-accounts-core";
import {
  Keypair,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, test } from "bun:test";
import {
  assertSignedTransactionMatchesExpected,
  parseSponsorBody,
  parseSponsorKey,
} from "./sponsor-validation";

const blockhash = Keypair.generate().publicKey.toBase58();

function fixture(extraSigner?: Keypair) {
  const sponsor = Keypair.generate();
  const wallet = Keypair.generate();
  const program = Keypair.generate().publicKey;
  const instruction = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ...(extraSigner
        ? [{ pubkey: extraSigner.publicKey, isSigner: true, isWritable: false }]
        : []),
    ],
    data: Buffer.from("fixed demo stage"),
  });
  const expected = freezePreparedOperation({
    operation: "test",
    payer: sponsor.publicKey,
    programId: program,
    requiresConfirmation: true,
    instructions: [instruction],
    lookupTableAccounts: [],
  });
  const transaction = compilePreparedOperation({ prepared: expected, blockhash });
  transaction.sign([wallet, ...(extraSigner ? [extraSigner] : [])]);
  return { expected, sponsor, transaction, wallet };
}

describe("sponsor transaction validation", () => {
  test("accepts only an exact expected message with the wallet signature", () => {
    const value = fixture();
    expect(() =>
      assertSignedTransactionMatchesExpected({
        transaction: value.transaction,
        expected: value.expected,
        sponsor: value.sponsor.publicKey,
        wallet: value.wallet.publicKey,
      })
    ).not.toThrow();
  });

  test("accepts an exact wallet-paid setup message after bounded prefunding", () => {
    const sponsor = Keypair.generate();
    const wallet = Keypair.generate();
    const program = Keypair.generate().publicKey;
    const expected = freezePreparedOperation({
      operation: "prefunded-policy-setup",
      payer: wallet.publicKey,
      programId: program,
      requiresConfirmation: true,
      instructions: [
        new TransactionInstruction({
          programId: program,
          keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
          data: Buffer.from("fixed policy setup"),
        }),
      ],
      lookupTableAccounts: [],
    });
    const transaction = compilePreparedOperation({ prepared: expected, blockhash });
    transaction.sign([wallet]);

    expect(() =>
      assertSignedTransactionMatchesExpected({
        transaction,
        expected,
        sponsor: sponsor.publicKey,
        wallet: wallet.publicKey,
      })
    ).not.toThrow();
  });

  test("rejects a prefilled sponsor signature", () => {
    const value = fixture();
    value.transaction.sign([value.sponsor]);
    expect(() =>
      assertSignedTransactionMatchesExpected({
        transaction: value.transaction,
        expected: value.expected,
        sponsor: value.sponsor.publicKey,
        wallet: value.wallet.publicKey,
      })
    ).toThrow("Sponsor signature slot must be empty");
  });

  test("rejects an invalid wallet signature", () => {
    const value = fixture();
    value.transaction.signatures[1]![0] ^= 1;
    expect(() =>
      assertSignedTransactionMatchesExpected({
        transaction: value.transaction,
        expected: value.expected,
        sponsor: value.sponsor.publicKey,
        wallet: value.wallet.publicKey,
      })
    ).toThrow("Privy wallet signature is invalid");
  });

  test("rejects extra required signers even when the message otherwise matches", () => {
    const extra = Keypair.generate();
    const value = fixture(extra);
    expect(() =>
      assertSignedTransactionMatchesExpected({
        transaction: value.transaction,
        expected: value.expected,
        sponsor: value.sponsor.publicKey,
        wallet: value.wallet.publicKey,
      })
    ).toThrow("signer set must be exactly");
  });

  test("rejects any message mutation", () => {
    const value = fixture();
    value.transaction.message.staticAccountKeys[2] =
      Keypair.generate().publicKey;
    expect(() =>
      assertSignedTransactionMatchesExpected({
        transaction: value.transaction,
        expected: value.expected,
        sponsor: value.sponsor.publicKey,
        wallet: value.wallet.publicKey,
      })
    ).toThrow("does not exactly match");
  });
});

describe("sponsor request parsing", () => {
  test("accepts a 64-byte base58 sponsor key without exposing it", () => {
    const key = Keypair.generate();
    expect(parseSponsorKey(bs58.encode(key.secretKey)).publicKey.toBase58()).toBe(
      key.publicKey.toBase58()
    );
  });

  test("accepts only the bounded prefund shape", () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const settings = Keypair.generate().publicKey.toBase58();
    expect(
      parseSponsorBody(JSON.stringify({ kind: "prefund", wallet, settings }))
    ).toEqual({ kind: "prefund", wallet, settings });
  });

  test("rejects unknown stages and oversized payloads", () => {
    expect(() =>
      parseSponsorBody(
        JSON.stringify({
          kind: "setup",
          transaction: "AA==",
          wallet: Keypair.generate().publicKey.toBase58(),
          settings: Keypair.generate().publicKey.toBase58(),
          stage: "arbitrary-relay",
        })
      )
    ).toThrow("Unknown setup stage");
    expect(() => parseSponsorBody("x".repeat(4_097))).toThrow("too large");
  });
});
