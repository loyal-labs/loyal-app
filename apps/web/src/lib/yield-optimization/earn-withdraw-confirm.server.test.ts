import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const { pda } = await import("@loyal-labs/loyal-smart-accounts");
const { Keypair } = await import("@solana/web3.js");
const { createCanonicalWithdrawalInput } = await import(
  "./earn-withdraw-confirm.server"
);
const { EARN_PRODUCT_STABLECOINS } = await import(
  "./earn-product-mints.shared"
);

// Multi-mint confirm canonicalization (ASK-2096): the recorder must accept
// every supported Earn product mint in a Safe-universe market and reject
// everything else. #624 shipped multi-mint prepare while confirm still
// asserted USDC, silently stranding confirmed non-USDC deposits off the
// read model — types can't catch that, only this contract can.
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const JLP_MARKET = "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npbDsjzsdA";

function buildInput(overrides: { liquidityMint?: string; market?: string }) {
  const settings = Keypair.generate().publicKey;
  const policySeed = BigInt(7);
  const policyAccount = pda
    .getPolicyPda({ settingsPda: settings, policySeed: Number(policySeed) })[0]
    .toBase58();
  const vault = pda
    .getSmartAccountPda({ settingsPda: settings, accountIndex: 1 })[0]
    .toBase58();
  return {
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(1),
    delegatedSigner: Keypair.generate().publicKey.toBase58(),
    liquidityMint: overrides.liquidityMint ?? USDT_MINT,
    market: overrides.market ?? MAIN_MARKET,
    mode: "partial" as const,
    policyAccount,
    policyId: policySeed,
    policySeed,
    settings: settings.toBase58(),
    smartAccountAddress: vault,
    targetReserve: Keypair.generate().publicKey.toBase58(),
    vaultIndex: 1,
    vaultPubkey: vault,
    walletAddress: Keypair.generate().publicKey.toBase58(),
    withdrawalSignature: "sig",
    withdrawnAmountRaw: BigInt(1),
  };
}

describe("createCanonicalWithdrawalInput multi-mint support", () => {
  test("accepts a supported non-USDC mint in a Safe-universe market", () => {
    const canonical = createCanonicalWithdrawalInput(buildInput({}));
    expect(canonical.liquidityMint).toBe(USDT_MINT);
    expect(canonical.market).toBe(MAIN_MARKET);
  });

  test("rejects a mint outside the Earn product catalog", () => {
    const rogueMint = Keypair.generate().publicKey.toBase58();
    expect(() =>
      createCanonicalWithdrawalInput(buildInput({ liquidityMint: rogueMint }))
    ).toThrow(/not a supported Earn product mint/);
  });

  test("rejects a market outside the Safe universe", () => {
    expect(() =>
      createCanonicalWithdrawalInput(buildInput({ market: JLP_MARKET }))
    ).toThrow(/Safe universe/);
  });

  test("catalog symbols stay in sync with the six planned stables", () => {
    expect(EARN_PRODUCT_STABLECOINS.map(String)).toEqual([
      "CASH",
      "USDG",
      "PYUSD",
      "USDC",
      "USDT",
      "USDS",
    ]);
  });
});
