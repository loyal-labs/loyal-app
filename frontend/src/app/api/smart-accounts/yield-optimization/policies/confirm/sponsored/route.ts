import { NextResponse } from "next/server";

import {
  parseEarnSponsoredPolicyConfirmRequestBody,
  type EarnPolicyConfirmRequestBody,
  type SponsoredYieldRoutePolicyInput,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";

import { POST as confirmEarnPolicy } from "../route";

const MOCK_CONFIRMED_SLOT = "0";
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
  input: SponsoredYieldRoutePolicyInput
): EarnPolicyConfirmRequestBody & {
  policyTransaction: string;
  setupPolicyTransaction: string;
} {
  const setupPolicyFields =
    input.stage === "setup_policy"
      ? {
          setupPolicyConfirmedSlot: MOCK_CONFIRMED_SLOT,
          setupPolicySignature: MOCK_SETUP_POLICY_SIGNATURE,
        }
      : {};

  return {
    ...setupPolicyFields,
    cluster: input.cluster,
    confirmedSlot: MOCK_CONFIRMED_SLOT,
    delegatedSigner: input.delegatedSigner,
    liquidityMint: input.liquidityMint,
    market: input.market,
    policyAccount: input.policyAccount,
    policyId: input.policyId.toString(),
    policySeed: input.policySeed.toString(),
    policySignature: MOCK_POLICY_SIGNATURE,
    policyTransaction: input.policyTransaction,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    setupPolicyId: input.setupPolicyId?.toString() ?? null,
    setupPolicySeed: input.setupPolicySeed?.toString() ?? null,
    setupPolicyTransaction: input.setupPolicyTransaction,
    settings: input.settings,
    stage: input.stage,
    targetReserve: input.targetReserve,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
  };
}

export async function POST(request: Request) {
  let input: SponsoredYieldRoutePolicyInput;
  try {
    input = parseEarnSponsoredPolicyConfirmRequestBody(await request.json());
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

  return confirmEarnPolicy(
    new Request(request.url, {
      body: JSON.stringify(buildForwardedConfirmBody(input)),
      headers,
      method: "POST",
    })
  );
}
