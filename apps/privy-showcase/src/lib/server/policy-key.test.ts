import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { decodePolicySignerSecret } = await import("./policy-key");

describe("backend policy key boundary", () => {
  test("fails closed when the persistent server secret is missing or malformed", () => {
    expect(() => decodePolicySignerSecret(undefined)).toThrow("not configured");
    expect(() =>
      decodePolicySignerSecret(bs58.encode(new Uint8Array(32)))
    ).toThrow("64-byte");
  });

  test("derives only the public policy signer from a valid keypair", () => {
    const expected = Keypair.generate();
    expect(
      decodePolicySignerSecret(
        bs58.encode(expected.secretKey)
      ).publicKey.toBase58()
    ).toBe(expected.publicKey.toBase58());
  });
});
