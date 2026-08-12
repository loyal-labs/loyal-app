import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, test } from "bun:test";
import {
  assertPolicySignerBoundary,
  assertSweepChainBoundary,
  assertSweepSnapshot,
  calculateSweepAmount,
  encodeSweepIntent,
  type SweepIntent,
  verifySweepIntentSignature,
} from "./sweep-intent";

const wallet = Keypair.generate();
const settings = Keypair.generate().publicKey.toBase58();
const policy = Keypair.generate().publicKey.toBase58();
const delegation = Keypair.generate().publicKey.toBase58();
const intent: SweepIntent = {
  nonce: crypto.randomUUID(),
  expiresAt: Date.now() + 30_000,
  wallet: wallet.publicKey.toBase58(),
  settings,
  policy,
  policySeed: "3",
  recurringDelegation: delegation,
  delegationNonce: "7",
  requestedAmountRaw: "9000000",
  minimumBalanceRaw: "1000000",
  blockhash: Keypair.generate().publicKey.toBase58(),
  lastValidBlockHeight: 123,
  expectedWalletBalanceRaw: "12000000",
  expectedVaultBalanceRaw: "2000000",
  expectedAmountPulledRaw: "4000000",
  amountPerPeriodRaw: "20000000",
  authorizedAmountRaw: "9000000",
};

describe("delegated sweep authorization", () => {
  test("accepts only the wallet signature over every execution field", () => {
    const signature = bs58.encode(naclSign());
    expect(verifySweepIntentSignature({ intent, signature })).toBe(true);
    expect(
      verifySweepIntentSignature({
        intent: { ...intent, policy: Keypair.generate().publicKey.toBase58() },
        signature,
      })
    ).toBe(false);
    expect(
      verifySweepIntentSignature({
        intent: {
          ...intent,
          blockhash: Keypair.generate().publicKey.toBase58(),
        },
        signature,
      })
    ).toBe(false);
    expect(
      verifySweepIntentSignature({
        intent: { ...intent, authorizedAmountRaw: "8000000" },
        signature,
      })
    ).toBe(false);
  });

  test("caps execution by request, wallet floor, and remaining period allowance", () => {
    expect(
      calculateSweepAmount({
        requested: 9n,
        walletBalance: 12n,
        minimumBalance: 5n,
        amountPerPeriod: 20n,
        amountPulled: 4n,
      })
    ).toBe(7n);
    expect(() =>
      calculateSweepAmount({
        requested: 0n,
        walletBalance: 12n,
        minimumBalance: 5n,
        amountPerPeriod: 20n,
        amountPulled: 4n,
      })
    ).toThrow("No USDC");
    expect(() =>
      calculateSweepAmount({
        requested: 1n,
        walletBalance: 5n,
        minimumBalance: 5n,
        amountPerPeriod: 20n,
        amountPulled: 0n,
      })
    ).toThrow("No USDC");
  });

  test.each([
    ["wallet", { wallet: Keypair.generate().publicKey.toBase58() }],
    ["settings", { settings: Keypair.generate().publicKey.toBase58() }],
    ["policy", { policy: Keypair.generate().publicKey.toBase58() }],
    [
      "delegation",
      { recurringDelegation: Keypair.generate().publicKey.toBase58() },
    ],
  ])("rejects a wrong %s before execution", (_label, override) => {
    expect(() => assertBoundary({ ...intent, ...override })).toThrow();
  });

  test("rejects root policy signer, wrong mint, and redirected destination", () => {
    const backend = policySigner();
    expect(() =>
      assertBoundary(intent, {
        policySigner: backend,
        rootSigners: [intent.wallet, backend],
      })
    ).toThrow("must not be a root");
    expect(() =>
      assertBoundary(intent, { mint: Keypair.generate().publicKey.toBase58() })
    ).toThrow("wrong mint");
    expect(() =>
      assertBoundary(intent, {
        delegatee: Keypair.generate().publicKey.toBase58(),
      })
    ).toThrow("wrong destination");
  });

  test("rejects a wrong, additional, or under-permissioned policy signer", () => {
    const expectedPolicySigner = policySigner();
    expect(() =>
      assertPolicySignerBoundary({
        expectedPolicySigner,
        observedSigners: [{ address: policySigner(), permissionMask: 0b111 }],
      })
    ).toThrow("wrong backend signer");
    expect(() =>
      assertPolicySignerBoundary({
        expectedPolicySigner,
        observedSigners: [
          { address: expectedPolicySigner, permissionMask: 0b111 },
          { address: policySigner(), permissionMask: 0b111 },
        ],
      })
    ).toThrow("exactly one signer");
    expect(() =>
      assertPolicySignerBoundary({
        expectedPolicySigner,
        observedSigners: [
          { address: expectedPolicySigner, permissionMask: 0b001 },
        ],
      })
    ).toThrow("permissions are incomplete");
  });

  test("rejects stale state snapshots and a non-canonical authorized amount", () => {
    expect(() => assertSnapshot()).not.toThrow();
    expect(() => assertSnapshot({ walletBalanceRaw: 11_999_999n })).toThrow(
      "wallet-balance snapshot is stale"
    );
    expect(() => assertSnapshot({ amountPulledRaw: 4_000_001n })).toThrow(
      "allowance snapshot is stale"
    );
    expect(() =>
      assertSweepSnapshot({
        intent: { ...intent, authorizedAmountRaw: "8000000" },
        walletBalanceRaw: 12_000_000n,
        vaultBalanceRaw: 2_000_000n,
        amountPulledRaw: 4_000_000n,
        amountPerPeriodRaw: 20_000_000n,
      })
    ).toThrow("authorized amount is non-canonical");
  });
});

function naclSign(): Uint8Array {
  return nacl.sign.detached(encodeSweepIntent(intent), wallet.secretKey);
}

function assertSnapshot(
  override: Partial<Parameters<typeof assertSweepSnapshot>[0]> = {}
) {
  assertSweepSnapshot({
    intent,
    walletBalanceRaw: 12_000_000n,
    vaultBalanceRaw: 2_000_000n,
    amountPulledRaw: 4_000_000n,
    amountPerPeriodRaw: 20_000_000n,
    ...override,
  });
}

function policySigner(): string {
  return Keypair.generate().publicKey.toBase58();
}

function assertBoundary(
  value: SweepIntent,
  override: Partial<Parameters<typeof assertSweepChainBoundary>[0]> = {}
) {
  const backend = override.policySigner ?? policySigner();
  assertSweepChainBoundary({
    intent: value,
    wallet: intent.wallet,
    settings,
    policy,
    recurringDelegation: delegation,
    policySigner: backend,
    rootSigners: [intent.wallet],
    delegator: intent.wallet,
    delegatee: "vault",
    expectedDelegatee: "vault",
    mint: "usdc",
    expectedMint: "usdc",
    ...override,
  });
}
