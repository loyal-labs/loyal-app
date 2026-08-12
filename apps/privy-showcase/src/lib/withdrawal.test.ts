import { Keypair } from "@solana/web3.js";
import { describe, expect, test } from "bun:test";
import { getPrivyWithdrawalBoundary } from "./withdrawal";

describe("Privy-controlled vault withdrawal", () => {
  test("pins amount, source vault-1 ATA, and destination to the same wallet ATA", () => {
    const settings = Keypair.generate().publicKey;
    const wallet = Keypair.generate().publicKey;
    const first = getPrivyWithdrawalBoundary({
      settings,
      wallet,
      amountRaw: 1_250_000n,
    });
    const differentWallet = getPrivyWithdrawalBoundary({
      settings,
      wallet: Keypair.generate().publicKey,
      amountRaw: 1_250_000n,
    });
    expect(first.amountRaw).toBe(1_250_000n);
    expect(first.sourceAta.equals(differentWallet.sourceAta)).toBe(true);
    expect(first.destinationAta.equals(differentWallet.destinationAta)).toBe(
      false
    );
  });

  test("rejects zero or negative movement before preparation", () => {
    const settings = Keypair.generate().publicKey;
    const wallet = Keypair.generate().publicKey;
    expect(() =>
      getPrivyWithdrawalBoundary({ settings, wallet, amountRaw: 0n })
    ).toThrow("greater than zero");
  });
});
