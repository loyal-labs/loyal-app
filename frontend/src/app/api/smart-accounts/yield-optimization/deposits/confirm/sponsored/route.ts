import { NextResponse } from "next/server";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

import {
  resolveAuthenticatedPrincipalFromRequest,
  type AuthenticatedPrincipal,
} from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import {
  parseEarnSponsoredDepositConfirmRequestBody,
  type EarnDepositConfirmRequestBody,
  type SponsoredYieldDepositConfirmInput,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  resolveDepositSponsoredTransactionGuards,
  resolveReusePolicyConfirmation,
} from "@/lib/yield-optimization/earn-deposit-sponsored-confirm.server";
import {
  EarnPolicySponsoredTransactionError,
  executeSponsoredEarnPolicyTransaction,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

import { POST as confirmEarnDeposit } from "../route";

const EARN_DEPOSIT_VAULT_INDEX = 1;

type SponsoredDepositConfirmation = Awaited<
  ReturnType<typeof executeSponsoredEarnPolicyTransaction>
>;

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function responseBodyWithSponsoredConfirmations(args: {
  deposit: SponsoredDepositConfirmation;
  kaminoSetup?: SponsoredDepositConfirmation | null;
  payload: unknown;
  policy: SponsoredDepositConfirmation;
  setupPolicy?: SponsoredDepositConfirmation;
}) {
  const payload =
    args.payload &&
    typeof args.payload === "object" &&
    !Array.isArray(args.payload)
      ? args.payload
      : { data: args.payload };

  return {
    ...payload,
    sponsoredConfirmations: {
      deposit: args.deposit,
      kaminoSetup: args.kaminoSetup ?? null,
      policy: args.policy,
      setupPolicy: args.setupPolicy ?? null,
    },
  };
}

function buildForwardedConfirmBody(args: {
  deposit: SponsoredDepositConfirmation;
  input: SponsoredYieldDepositConfirmInput;
  policy: SponsoredDepositConfirmation;
  setupPolicy?: SponsoredDepositConfirmation;
}): EarnDepositConfirmRequestBody & {
  depositTransaction: string;
  policyTransaction?: string | null;
  setupPolicyTransaction?: string | null;
} {
  const { deposit, input, policy, setupPolicy } = args;
  return {
    cluster: input.cluster,
    confirmedSlot: deposit.confirmedSlot,
    delegatedSigner: input.delegatedSigner,
    depositMint: input.depositMint,
    depositSignature: deposit.signature,
    depositTransaction: input.depositTransaction,
    ...(input.kaminoSetupTransaction
      ? { kaminoSetupTransaction: input.kaminoSetupTransaction }
      : {}),
    liquidityMint: input.liquidityMint,
    market: input.market,
    policyAccount: input.policyAccount,
    policyConfirmedSlot: policy.confirmedSlot,
    policyId: input.policyId.toString(),
    policyInitialization: input.policyInitialization,
    policySeed: input.policySeed.toString(),
    policySignature: policy.signature,
    ...(input.policyTransaction
      ? { policyTransaction: input.policyTransaction }
      : {}),
    principalAmountRaw: input.principalAmountRaw.toString(),
    settings: input.settings,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    ...(setupPolicy
      ? { setupPolicyConfirmedSlot: setupPolicy.confirmedSlot }
      : {}),
    setupPolicyId: input.setupPolicyId?.toString() ?? null,
    setupPolicySeed: input.setupPolicySeed?.toString() ?? null,
    ...(setupPolicy ? { setupPolicySignature: setupPolicy.signature } : {}),
    ...(input.setupPolicyTransaction
      ? { setupPolicyTransaction: input.setupPolicyTransaction }
      : {}),
    smartAccountAddress: input.smartAccountAddress,
    targetReserve: input.targetReserve,
    targetSupplyApyBps: input.targetSupplyApyBps?.toString() ?? null,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
  };
}

function assertSponsoredDepositPrincipal(args: {
  input: SponsoredYieldDepositConfirmInput;
  principal: AuthenticatedPrincipal;
}): void {
  const { input, principal } = args;
  if (
    input.walletAddress !== principal.walletAddress ||
    input.settings !== principal.settingsPda
  ) {
    throw new EarnPolicySponsoredTransactionError({
      status: 403,
      code: "principal_mismatch",
      message: "Sponsored Earn deposit does not belong to the active session.",
    });
  }
  if (input.vaultIndex !== EARN_DEPOSIT_VAULT_INDEX) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "invalid_vault_index",
      message: "Sponsored Earn deposit must target the Earn vault.",
    });
  }

  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
  const settingsPda = new PublicKey(principal.settingsPda);
  const [expectedVault] = pda.getSmartAccountPda({
    accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    programId,
    settingsPda,
  });
  if (
    input.vaultPubkey !== expectedVault.toBase58() ||
    input.smartAccountAddress !== expectedVault.toBase58()
  ) {
    throw new EarnPolicySponsoredTransactionError({
      status: 403,
      code: "vault_mismatch",
      message:
        "Sponsored Earn deposit vault does not match the active session.",
    });
  }
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: SponsoredYieldDepositConfirmInput;
  try {
    input = parseEarnSponsoredDepositConfirmRequestBody(await request.json());
    assertSponsoredDepositPrincipal({ input, principal });
  } catch (error) {
    if (error instanceof EarnPolicySponsoredTransactionError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  let policy: SponsoredDepositConfirmation;
  let setupPolicy: SponsoredDepositConfirmation | undefined;
  let kaminoSetup: SponsoredDepositConfirmation | null = null;
  let deposit: SponsoredDepositConfirmation;
  try {
    const guards = await resolveDepositSponsoredTransactionGuards(input);
    if (input.policyInitialization === "create") {
      if (!input.policyTransaction) {
        throw new EarnPolicySponsoredTransactionError({
          status: 400,
          code: "missing_policy_transaction",
          message:
            "policyTransaction is required when policyInitialization is create.",
        });
      }
      policy = await executeSponsoredEarnPolicyTransaction(
        input.policyTransaction,
        guards.policy
      );
      if (!input.setupPolicyTransaction) {
        throw new EarnPolicySponsoredTransactionError({
          status: 400,
          code: "missing_setup_policy_transaction",
          message:
            "setupPolicyTransaction is required when policyInitialization is create.",
        });
      }
      setupPolicy = await executeSponsoredEarnPolicyTransaction(
        input.setupPolicyTransaction,
        guards.setupPolicy
      );
    } else {
      policy = await resolveReusePolicyConfirmation(input);
    }
    if (input.kaminoSetupTransaction) {
      kaminoSetup = await executeSponsoredEarnPolicyTransaction(
        input.kaminoSetupTransaction,
        guards.kaminoSetup
      );
    }
    deposit = await executeSponsoredEarnPolicyTransaction(
      input.depositTransaction,
      guards.deposit
    );
  } catch (error) {
    if (error instanceof EarnPolicySponsoredTransactionError) {
      return jsonError(error.status, error.code, error.message);
    }
    throw error;
  }

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  const forwardedResponse = await confirmEarnDeposit(
    new Request(request.url, {
      body: JSON.stringify(
        buildForwardedConfirmBody({ deposit, input, policy, setupPolicy })
      ),
      headers,
      method: "POST",
    })
  );
  const forwardedPayload = await forwardedResponse.json().catch(() => null);
  return NextResponse.json(
    responseBodyWithSponsoredConfirmations({
      deposit,
      kaminoSetup,
      payload: forwardedPayload,
      policy,
      setupPolicy,
    }),
    { status: forwardedResponse.status }
  );
}
