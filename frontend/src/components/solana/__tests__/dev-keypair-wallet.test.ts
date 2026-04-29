import { describe, expect, test } from "bun:test";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

import { parseDevSecretKeyInput } from "../dev-keypair-wallet";

describe("parseDevSecretKeyInput", () => {
  test("accepts a Solana CLI JSON keypair", () => {
    const keypair = Keypair.generate();
    const parsed = parseDevSecretKeyInput(
      JSON.stringify(Array.from(keypair.secretKey))
    );

    expect(parsed.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  test("accepts a base58-encoded secret key", () => {
    const keypair = Keypair.generate();
    const parsed = parseDevSecretKeyInput(bs58.encode(keypair.secretKey));

    expect(parsed.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  test("accepts a hex-encoded secret key", () => {
    const keypair = Keypair.generate();
    const parsed = parseDevSecretKeyInput(
      Buffer.from(keypair.secretKey).toString("hex")
    );

    expect(parsed.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  test("rejects a public key", () => {
    const keypair = Keypair.generate();

    expect(() =>
      parseDevSecretKeyInput(keypair.publicKey.toBase58())
    ).toThrow("Expected a 64-byte secret key");
  });
});
