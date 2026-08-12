import nacl from "tweetnacl";
import bs58 from "bs58";
import { z } from "zod";

export const sweepRequestSchema = z.object({
  wallet: z.string().min(32),
  settings: z.string().min(32),
  policy: z.string().min(32),
  policySeed: z.string().regex(/^\d+$/),
  recurringDelegation: z.string().min(32),
  delegationNonce: z.string().regex(/^\d+$/),
  requestedAmountRaw: z.string().regex(/^\d+$/),
  minimumBalanceRaw: z.string().regex(/^\d+$/),
});

export const sweepIntentSchema = sweepRequestSchema.extend({
  nonce: z.string().uuid(),
  expiresAt: z.number().int().positive(),
  blockhash: z.string().min(32),
  lastValidBlockHeight: z.number().int().nonnegative(),
  expectedWalletBalanceRaw: z.string().regex(/^\d+$/),
  expectedVaultBalanceRaw: z.string().regex(/^\d+$/),
  expectedAmountPulledRaw: z.string().regex(/^\d+$/),
  amountPerPeriodRaw: z.string().regex(/^\d+$/),
  authorizedAmountRaw: z.string().regex(/^[1-9]\d*$/),
});

export type SweepRequest = z.infer<typeof sweepRequestSchema>;
export type SweepIntent = z.infer<typeof sweepIntentSchema>;

export function encodeSweepIntent(intent: SweepIntent): Uint8Array {
  return new TextEncoder().encode(
    [
      "Loyal Privy showcase sweep",
      `nonce:${intent.nonce}`,
      `expiresAt:${intent.expiresAt}`,
      `wallet:${intent.wallet}`,
      `settings:${intent.settings}`,
      `policy:${intent.policy}`,
      `policySeed:${intent.policySeed}`,
      `recurringDelegation:${intent.recurringDelegation}`,
      `delegationNonce:${intent.delegationNonce}`,
      `requestedAmountRaw:${intent.requestedAmountRaw}`,
      `minimumBalanceRaw:${intent.minimumBalanceRaw}`,
      `blockhash:${intent.blockhash}`,
      `lastValidBlockHeight:${intent.lastValidBlockHeight}`,
      `expectedWalletBalanceRaw:${intent.expectedWalletBalanceRaw}`,
      `expectedVaultBalanceRaw:${intent.expectedVaultBalanceRaw}`,
      `expectedAmountPulledRaw:${intent.expectedAmountPulledRaw}`,
      `amountPerPeriodRaw:${intent.amountPerPeriodRaw}`,
      `authorizedAmountRaw:${intent.authorizedAmountRaw}`,
      "cluster:mainnet-beta",
    ].join("\n")
  );
}

export function verifySweepIntentSignature(args: {
  intent: SweepIntent;
  signature: string;
}): boolean {
  try {
    return nacl.sign.detached.verify(
      encodeSweepIntent(args.intent),
      bs58.decode(args.signature),
      bs58.decode(args.intent.wallet)
    );
  } catch {
    return false;
  }
}

export function calculateSweepAmount(args: {
  requested: bigint;
  walletBalance: bigint;
  minimumBalance: bigint;
  amountPerPeriod: bigint;
  amountPulled: bigint;
}): bigint {
  const aboveFloor =
    args.walletBalance > args.minimumBalance
      ? args.walletBalance - args.minimumBalance
      : 0n;
  const remainingAllowance =
    args.amountPerPeriod > args.amountPulled
      ? args.amountPerPeriod - args.amountPulled
      : 0n;
  const amount = [args.requested, aboveFloor, remainingAllowance].reduce(
    (minimum, value) => (value < minimum ? value : minimum)
  );
  if (amount <= 0n)
    throw new Error(
      "No USDC is currently sweepable within the signed floor and on-chain allowance."
    );
  return amount;
}

export function assertSweepChainBoundary(args: {
  intent: SweepRequest;
  wallet: string;
  settings: string;
  policy: string;
  recurringDelegation: string;
  policySigner: string;
  rootSigners: string[];
  delegator: string;
  delegatee: string;
  expectedDelegatee: string;
  mint: string;
  expectedMint: string;
}): void {
  if (args.intent.wallet !== args.wallet)
    throw new Error("Wrong authenticated wallet.");
  if (args.intent.settings !== args.settings)
    throw new Error("Wrong Settings account.");
  if (args.intent.policy !== args.policy)
    throw new Error("Wrong sweep policy.");
  if (args.intent.recurringDelegation !== args.recurringDelegation)
    throw new Error("Wrong recurring delegation.");
  if (!args.rootSigners.includes(args.wallet))
    throw new Error("Wallet is not a root Settings signer.");
  if (args.rootSigners.includes(args.policySigner))
    throw new Error("Backend policy signer must not be a root signer.");
  if (args.delegator !== args.wallet)
    throw new Error("Delegation belongs to a different wallet.");
  if (args.delegatee !== args.expectedDelegatee)
    throw new Error("Delegation has the wrong destination vault.");
  if (args.mint !== args.expectedMint)
    throw new Error("Delegation has the wrong mint.");
}

export function assertSweepSnapshot(args: {
  intent: SweepIntent;
  walletBalanceRaw: bigint;
  vaultBalanceRaw: bigint;
  amountPulledRaw: bigint;
  amountPerPeriodRaw: bigint;
}): void {
  if (BigInt(args.intent.expectedWalletBalanceRaw) !== args.walletBalanceRaw)
    throw new Error("Sweep intent wallet-balance snapshot is stale.");
  if (BigInt(args.intent.expectedVaultBalanceRaw) !== args.vaultBalanceRaw)
    throw new Error("Sweep intent vault-balance snapshot is stale.");
  if (BigInt(args.intent.expectedAmountPulledRaw) !== args.amountPulledRaw)
    throw new Error("Sweep intent allowance snapshot is stale.");
  if (BigInt(args.intent.amountPerPeriodRaw) !== args.amountPerPeriodRaw)
    throw new Error("Sweep intent period cap changed.");

  const expectedAmount = calculateSweepAmount({
    requested: BigInt(args.intent.requestedAmountRaw),
    walletBalance: args.walletBalanceRaw,
    minimumBalance: BigInt(args.intent.minimumBalanceRaw),
    amountPerPeriod: args.amountPerPeriodRaw,
    amountPulled: args.amountPulledRaw,
  });
  if (BigInt(args.intent.authorizedAmountRaw) !== expectedAmount)
    throw new Error("Sweep intent authorized amount is non-canonical.");
}

export function assertPolicySignerBoundary(args: {
  expectedPolicySigner: string;
  observedSigners: Array<{ address: string; permissionMask: number }>;
}): void {
  if (args.observedSigners.length !== 1)
    throw new Error("Sweep policy must have exactly one signer.");
  const [observed] = args.observedSigners;
  if (observed?.address !== args.expectedPolicySigner)
    throw new Error("Sweep policy has the wrong backend signer.");
  if ((observed.permissionMask & 0b111) !== 0b111)
    throw new Error("Sweep policy signer permissions are incomplete.");
}
