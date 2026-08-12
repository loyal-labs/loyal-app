import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const { pda } = await import("@loyal-labs/loyal-smart-accounts");
const { Keypair, PublicKey } = await import("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import(
  "@solana/spl-token"
);
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

function buildInput(overrides: {
  liquidityMint?: string;
  market?: string | null;
  sourceTokenAccount?: string | null;
  sourceType?: "idle" | "reserve";
  targetReserve?: string;
}) {
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
    market: overrides.market === undefined ? MAIN_MARKET : overrides.market,
    mode: "partial" as const,
    policyAccount,
    policyId: policySeed,
    policySeed,
    settings: settings.toBase58(),
    smartAccountAddress: vault,
    sourceTokenAccount: overrides.sourceTokenAccount,
    sourceType: overrides.sourceType ?? "reserve",
    targetReserve:
      overrides.targetReserve ?? Keypair.generate().publicKey.toBase58(),
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

  test("records reserve history even when the market left today's Safe catalog", () => {
    expect(
      createCanonicalWithdrawalInput(buildInput({ market: JLP_MARKET })).market
    ).toBe(JLP_MARKET);
  });

  test("accepts idle withdrawal only from the mint's exact vault ATA", () => {
    const base = buildInput({ market: null, sourceType: "idle" });
    const vaultAta = getAssociatedTokenAddressSync(
      new PublicKey(USDT_MINT),
      new PublicKey(base.vaultPubkey),
      true,
      TOKEN_PROGRAM_ID
    ).toBase58();
    const canonical = createCanonicalWithdrawalInput({
      ...base,
      sourceMint: USDT_MINT,
      sourceTokenAccount: vaultAta,
      targetReserve: vaultAta,
    });
    expect(canonical.market).toBeNull();
    expect(canonical.sourceTokenAccount).toBe(vaultAta);
  });

  test("rejects an idle withdrawal from any other token account", () => {
    expect(() =>
      createCanonicalWithdrawalInput(
        buildInput({
          market: null,
          sourceTokenAccount: Keypair.generate().publicKey.toBase58(),
          sourceType: "idle",
        })
      )
    ).toThrow(/vault mint account/);
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
