import "server-only";
import {
  SUBSCRIPTIONS_PROGRAM_ID,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PULLED_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET,
  deriveRecurringDelegation,
  deriveSubscriptionAuthority,
} from "@loyal-labs/actions";
import { accounts, pda } from "@loyal-labs/loyal-smart-accounts-core";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import {
  CANONICAL_USDC_MINT,
  DEMO_CLUSTER,
  EARN_VAULT_INDEX,
  SQUADS_PROGRAM_ID,
} from "../constants";
import {
  assertPolicySignerBoundary,
  assertSweepChainBoundary,
  type SweepRequest,
} from "../sweep-intent";

function readPubkey(data: Buffer, offset: number): PublicKey {
  if (data.length < offset + 32)
    throw new Error("Recurring delegation account is truncated.");
  return new PublicKey(data.subarray(offset, offset + 32));
}

function readU64(data: Buffer, offset: number): bigint {
  if (data.length < offset + 8)
    throw new Error("Recurring delegation account is truncated.");
  return data.readBigUInt64LE(offset);
}

async function getTokenBalanceOrZero(
  connection: Connection,
  account: PublicKey
): Promise<bigint> {
  try {
    return BigInt(
      (await connection.getTokenAccountBalance(account, "finalized")).value
        .amount
    );
  } catch {
    return 0n;
  }
}

export async function readValidatedSweepContext(args: {
  connection: Connection;
  request: SweepRequest;
  policySigner: PublicKey;
}) {
  const wallet = new PublicKey(args.request.wallet);
  const settingsPda = new PublicKey(args.request.settings);
  const policy = new PublicKey(args.request.policy);
  const recurringDelegation = new PublicKey(args.request.recurringDelegation);
  const settings = await accounts.Settings.fromAccountAddress(
    args.connection,
    settingsPda,
    "finalized"
  );
  const vault = pda.getSmartAccountPda({
    settingsPda,
    accountIndex: EARN_VAULT_INDEX,
    programId: SQUADS_PROGRAM_ID,
  })[0];
  const authority = deriveSubscriptionAuthority(wallet, CANONICAL_USDC_MINT);
  const expectedDelegation = deriveRecurringDelegation(
    authority,
    wallet,
    vault,
    BigInt(args.request.delegationNonce)
  );
  const delegationAccount = await args.connection.getAccountInfo(
    recurringDelegation,
    "finalized"
  );
  if (
    !delegationAccount ||
    !delegationAccount.owner.equals(SUBSCRIPTIONS_PROGRAM_ID)
  ) {
    throw new Error(
      "Recurring delegation is missing or owned by the wrong program."
    );
  }
  if (!expectedDelegation.equals(recurringDelegation))
    throw new Error("Recurring delegation PDA is non-canonical.");

  const delegator = readPubkey(
    delegationAccount.data,
    SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET
  );
  const delegatee = readPubkey(
    delegationAccount.data,
    SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET
  );
  const observedAuthority = readPubkey(
    delegationAccount.data,
    SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET
  );
  const mint = readPubkey(
    delegationAccount.data,
    SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET
  );
  const amountPerPeriod = readU64(
    delegationAccount.data,
    SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET
  );
  const amountPulled = readU64(
    delegationAccount.data,
    SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PULLED_OFFSET
  );
  if (!observedAuthority.equals(authority))
    throw new Error(
      "Recurring delegation has the wrong subscription authority."
    );

  assertSweepChainBoundary({
    intent: args.request,
    wallet: wallet.toBase58(),
    settings: settingsPda.toBase58(),
    policy: policy.toBase58(),
    recurringDelegation: recurringDelegation.toBase58(),
    policySigner: args.policySigner.toBase58(),
    rootSigners: settings.signers.map((signer) => signer.key.toBase58()),
    delegator: delegator.toBase58(),
    delegatee: delegatee.toBase58(),
    expectedDelegatee: vault.toBase58(),
    mint: mint.toBase58(),
    expectedMint: CANONICAL_USDC_MINT.toBase58(),
  });

  const vaults = createSmartAccountVaultsClient({
    connection: args.connection,
    programId: SQUADS_PROGRAM_ID,
  });
  const observedPolicy = await vaults.sdk.policies.queries.fetchPolicy(
    policy,
    "finalized"
  );
  assertPolicySignerBoundary({
    expectedPolicySigner: args.policySigner.toBase58(),
    observedSigners: observedPolicy.signers.map((signer) => ({
      address: signer.key.toBase58(),
      permissionMask: signer.permissions.mask,
    })),
  });
  await vaults.assertEarnUsdcAutodepositCanonicalArtifacts({
    settingsPda,
    walletAddress: wallet,
    policySigner: args.policySigner,
    policy,
    policySeed: BigInt(args.request.policySeed),
    recurringDelegation,
    nonce: BigInt(args.request.delegationNonce),
    amountRaw: amountPerPeriod,
    cluster: DEMO_CLUSTER,
  });

  const walletAta = getAssociatedTokenAddressSync(
    CANONICAL_USDC_MINT,
    wallet,
    false,
    TOKEN_PROGRAM_ID
  );
  const vaultAta = getAssociatedTokenAddressSync(
    CANONICAL_USDC_MINT,
    vault,
    true,
    TOKEN_PROGRAM_ID
  );
  const walletBalance = BigInt(
    (await args.connection.getTokenAccountBalance(walletAta, "finalized")).value
      .amount
  );
  const vaultBalance = await getTokenBalanceOrZero(args.connection, vaultAta);

  return {
    amountPerPeriod,
    amountPulled,
    policy,
    recurringDelegation,
    settingsPda,
    vault,
    vaultAta,
    vaultBalance,
    wallet,
    walletAta,
    walletBalance,
  };
}
