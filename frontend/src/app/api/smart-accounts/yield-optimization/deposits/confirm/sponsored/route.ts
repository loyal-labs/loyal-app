import { NextResponse } from "next/server";

import {
  parseEarnSponsoredDepositConfirmRequestBody,
  type EarnDepositConfirmRequestBody,
  type SponsoredYieldDepositConfirmInput,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  executeSponsoredEarnPolicyTransaction,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

import { POST as confirmEarnDeposit } from "../route";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function buildForwardedConfirmBody(
  args: {
    deposit: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
    input: SponsoredYieldDepositConfirmInput;
    policy: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
    setupPolicy?: Awaited<
      ReturnType<typeof executeSponsoredEarnPolicyTransaction>
    >;
  }
): EarnDepositConfirmRequestBody & {
  depositTransaction: string;
  policyTransaction: string;
  setupPolicyTransaction: string;
} {
  const { deposit, input, policy, setupPolicy } = args;
  return {
    cluster: input.cluster,
    confirmedSlot: deposit.confirmedSlot,
    delegatedSigner: input.delegatedSigner,
    depositMint: input.depositMint,
    depositSignature: deposit.signature,
    depositTransaction: input.depositTransaction,
    liquidityMint: input.liquidityMint,
    market: input.market,
    policyAccount: input.policyAccount,
    policyConfirmedSlot: policy.confirmedSlot,
    policyId: input.policyId.toString(),
    policyInitialization: input.policyInitialization,
    policySeed: input.policySeed.toString(),
    policySignature: policy.signature,
    policyTransaction: input.policyTransaction,
    principalAmountRaw: input.principalAmountRaw.toString(),
    settings: input.settings,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    ...(setupPolicy
      ? { setupPolicyConfirmedSlot: setupPolicy.confirmedSlot }
      : {}),
    setupPolicyId: input.setupPolicyId?.toString() ?? null,
    setupPolicySeed: input.setupPolicySeed?.toString() ?? null,
    ...(setupPolicy ? { setupPolicySignature: setupPolicy.signature } : {}),
    setupPolicyTransaction: input.setupPolicyTransaction,
    smartAccountAddress: input.smartAccountAddress,
    targetReserve: input.targetReserve,
    targetSupplyApyBps: input.targetSupplyApyBps?.toString() ?? null,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
  };
}

export async function POST(request: Request) {
  let input: SponsoredYieldDepositConfirmInput;
  try {
    input = parseEarnSponsoredDepositConfirmRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  let policy: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
  let setupPolicy:
    | Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>
    | undefined;
  let deposit: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
  try {
    policy = await executeSponsoredEarnPolicyTransaction(
      input.policyTransaction
    );
    if (input.policyInitialization === "create") {
      setupPolicy = await executeSponsoredEarnPolicyTransaction(
        input.setupPolicyTransaction
      );
    }
    deposit = await executeSponsoredEarnPolicyTransaction(
      input.depositTransaction
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

  return confirmEarnDeposit(
    new Request(request.url, {
      body: JSON.stringify(
        buildForwardedConfirmBody({ deposit, input, policy, setupPolicy })
      ),
      headers,
      method: "POST",
    })
  );
}
