import "server-only";

import { parseKaminoReserveTokenAccounts } from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaConnection } from "@/lib/solana/rpc-connection.server";
import { resolvePolicyCreationSignatureFromChain } from "@/lib/yield-optimization/earn-deposit-confirm.server";
import {
  EarnPolicySponsoredTransactionError,
  type SponsoredTransactionConfirmation,
  type SponsoredTransactionGuardContext,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";
import { findActiveYieldRoutePolicyPair } from "@/lib/yield-optimization/yield-deposit-repository.server";

// Sponsored Earn deposit confirm helpers shared by the session route
// (`yield-optimization/deposits/confirm/sponsored`) and its mobile twin
// (`mobile/earn/deposit/confirm/sponsored`). Both routes execute the same
// sponsor-guarded transactions; keeping the guard construction here keeps the
// sponsor abuse surface defined in exactly one place.

export type SponsoredEarnDepositReusePolicyInput = {
  cluster: string;
  policyAccount: string;
  policySeed: bigint;
  settings: string;
  vaultIndex: number;
  vaultPubkey: string;
  walletAddress: string;
};

export type SponsoredEarnDepositGuardInput = {
  depositMint: string;
  liquidityMint: string;
  policyAccount: string;
  policyInitialization: "create" | "reuse";
  setupPolicyAccount?: string | null;
  smartAccountAddress: string;
  targetReserve: string;
  vaultPubkey: string;
};

export type SponsoredEarnDepositGuards = {
  deposit: SponsoredTransactionGuardContext;
  kaminoSetup: SponsoredTransactionGuardContext;
  policy: SponsoredTransactionGuardContext;
  setupPolicy: SponsoredTransactionGuardContext;
};

function uniquePublicKeys(values: readonly PublicKey[]): PublicKey[] {
  return [
    ...new Map(values.map((value) => [value.toBase58(), value])).values(),
  ];
}

// Resolves the recorded (or chain-recovered) confirmation of the active policy
// for a sponsored top-up, where the client sends no policy transaction.
export async function resolveReusePolicyConfirmation(
  input: SponsoredEarnDepositReusePolicyInput
): Promise<SponsoredTransactionConfirmation> {
  const activePolicyPair = await findActiveYieldRoutePolicyPair({
    authority: input.walletAddress,
    cluster: input.cluster,
    settings: input.settings,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
  });
  const activePolicy = activePolicyPair?.routePolicy ?? null;
  if (activePolicy) {
    if (
      activePolicy.policyAccount !== input.policyAccount ||
      activePolicy.policySeed !== input.policySeed
    ) {
      throw new EarnPolicySponsoredTransactionError({
        status: 409,
        code: "active_policy_mismatch",
        message:
          "Sponsored Earn top-up policy does not match the active Earn policy.",
      });
    }
    return {
      confirmedSlot: activePolicy.lastSeenSlot.toString(),
      signature: activePolicy.lastSeenSignature,
    };
  }

  const recoveredPolicy = await resolvePolicyCreationSignatureFromChain({
    cluster: resolveLoyalWebSolanaEnvFromEnv(process.env),
    policyAccount: input.policyAccount,
  });
  if (recoveredPolicy) {
    return {
      confirmedSlot: recoveredPolicy.slot,
      signature: recoveredPolicy.signature,
    };
  }

  throw new EarnPolicySponsoredTransactionError({
    status: 409,
    code: "active_policy_not_found",
    message:
      "Sponsored Earn top-up could not resolve the active Earn policy confirmation.",
  });
}

// Builds the per-stage guard contexts that bound what the sponsor key may pay
// for inside each sponsored deposit transaction.
export async function resolveDepositSponsoredTransactionGuards(
  input: SponsoredEarnDepositGuardInput
): Promise<SponsoredEarnDepositGuards> {
  const smartAccountsProgramId = new PublicKey(
    getServerEnv().loyalSmartAccounts.programId
  );
  const vaultPubkey = new PublicKey(input.vaultPubkey);
  const smartAccountAddress = new PublicKey(input.smartAccountAddress);
  const policyAccount = new PublicKey(input.policyAccount);
  const setupPolicyAccount = input.setupPolicyAccount
    ? new PublicKey(input.setupPolicyAccount)
    : null;
  if (input.policyInitialization === "create" && !setupPolicyAccount) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "missing_setup_policy_account",
      message: "Sponsored Earn deposit is missing the setup policy account.",
    });
  }

  const reserveAccount = await getServerSolanaConnection(
    resolveLoyalWebSolanaEnvFromEnv(process.env)
  ).getAccountInfo(new PublicKey(input.targetReserve), "confirmed");
  if (!reserveAccount) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "target_reserve_not_found",
      message: "Sponsored Earn deposit target reserve was not found.",
    });
  }
  const reserveAccounts = parseKaminoReserveTokenAccounts(reserveAccount.data);
  const allowedSystemTransferDestinations = uniquePublicKeys([
    vaultPubkey,
    smartAccountAddress,
  ]);

  const depositGuard = {
    allowedAssociatedTokenMints: uniquePublicKeys([
      new PublicKey(input.depositMint),
      new PublicKey(input.liquidityMint),
      reserveAccounts.reserveCollateralMint,
    ]),
    allowedAssociatedTokenOwners: allowedSystemTransferDestinations,
    allowedSystemTransferDestinations,
  };

  return {
    deposit: depositGuard,
    kaminoSetup: depositGuard,
    policy: {
      allowedSmartAccountRentAccounts: [policyAccount],
      allowedSmartAccountsProgramId: smartAccountsProgramId,
    },
    setupPolicy: {
      allowedSmartAccountRentAccounts: setupPolicyAccount
        ? [setupPolicyAccount]
        : [],
      allowedSmartAccountsProgramId: smartAccountsProgramId,
      allowedSystemTransferDestinations,
    },
  };
}
