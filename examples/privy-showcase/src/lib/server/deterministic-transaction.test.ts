import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts-core";
import { Keypair, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, test } from "bun:test";
import { compileDeterministicPolicyTransaction } from "./deterministic-transaction";

describe("instance-independent sweep replay protection", () => {
  test("the same signed intent inputs produce the same Solana transaction signature", () => {
    const policySigner = Keypair.generate();
    const blockhash = Keypair.generate().publicKey.toBase58();
    const prepared = {
      operation: "sweepReplayInvariant",
      payer: policySigner.publicKey,
      programId: SystemProgram.programId,
      requiresConfirmation: true,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: policySigner.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
      lookupTableAccounts: [],
    } as PreparedLoyalSmartAccountsOperation<string>;

    const first = compileDeterministicPolicyTransaction({
      prepared,
      blockhash,
      policySigner,
    });
    const replay = compileDeterministicPolicyTransaction({
      prepared,
      blockhash,
      policySigner,
    });
    expect(first.serialize()).toEqual(replay.serialize());
    expect(bs58.encode(first.signatures[0]!)).toBe(
      bs58.encode(replay.signatures[0]!)
    );
  });

  test("changing the signed blockhash changes the transaction identity", () => {
    const policySigner = Keypair.generate();
    const prepared = {
      operation: "sweepReplayInvariant",
      payer: policySigner.publicKey,
      programId: SystemProgram.programId,
      requiresConfirmation: true,
      instructions: [],
      lookupTableAccounts: [],
    } as PreparedLoyalSmartAccountsOperation<string>;
    const first = compileDeterministicPolicyTransaction({
      prepared,
      blockhash: Keypair.generate().publicKey.toBase58(),
      policySigner,
    });
    const changed = compileDeterministicPolicyTransaction({
      prepared,
      blockhash: Keypair.generate().publicKey.toBase58(),
      policySigner,
    });
    expect(bs58.encode(first.signatures[0]!)).not.toBe(
      bs58.encode(changed.signatures[0]!)
    );
  });
});
