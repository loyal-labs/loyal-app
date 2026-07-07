import { NextResponse } from "next/server";

import {
  parseEarnSponsoredDepositConfirmRequestBody,
  type EarnDepositConfirmRequestBody,
  type SponsoredYieldDepositConfirmInput,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";

import { POST as confirmEarnDeposit } from "../route";

const MOCK_CONFIRMED_SLOT = "0";
const MOCK_DEPOSIT_SIGNATURE = "mock-sponsored-deposit-signature";
const MOCK_POLICY_SIGNATURE = "mock-sponsored-policy-signature";
const MOCK_SETUP_POLICY_SIGNATURE = "mock-sponsored-setup-policy-signature";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function buildForwardedConfirmBody(
  input: SponsoredYieldDepositConfirmInput
): EarnDepositConfirmRequestBody & {
  depositTransaction: string;
  policyTransaction: string;
  setupPolicyTransaction: string;
} {
  return {
    cluster: input.cluster,
    confirmedSlot: MOCK_CONFIRMED_SLOT,
    delegatedSigner: input.delegatedSigner,
    depositMint: input.depositMint,
    depositSignature: MOCK_DEPOSIT_SIGNATURE,
    depositTransaction: input.depositTransaction,
    liquidityMint: input.liquidityMint,
    market: input.market,
    policyAccount: input.policyAccount,
    policyConfirmedSlot: MOCK_CONFIRMED_SLOT,
    policyId: input.policyId.toString(),
    policyInitialization: input.policyInitialization,
    policySeed: input.policySeed.toString(),
    policySignature: MOCK_POLICY_SIGNATURE,
    policyTransaction: input.policyTransaction,
    principalAmountRaw: input.principalAmountRaw.toString(),
    settings: input.settings,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    setupPolicyConfirmedSlot: MOCK_CONFIRMED_SLOT,
    setupPolicyId: input.setupPolicyId?.toString() ?? null,
    setupPolicySeed: input.setupPolicySeed?.toString() ?? null,
    setupPolicySignature: MOCK_SETUP_POLICY_SIGNATURE,
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

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  return confirmEarnDeposit(
    new Request(request.url, {
      body: JSON.stringify(buildForwardedConfirmBody(input)),
      headers,
      method: "POST",
    })
  );
}
