import { NextResponse } from "next/server";

import {
  parseEarnSponsoredPolicyConfirmRequestBody,
  type EarnPolicyConfirmRequestBody,
  type SponsoredYieldRoutePolicyInput,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  executeSponsoredEarnPolicyTransaction,
  type SponsoredTransactionConfirmation,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

import { POST as confirmEarnPolicy } from "../route";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function buildForwardedConfirmBody(
  args: {
    input: SponsoredYieldRoutePolicyInput;
    policy: SponsoredTransactionConfirmation;
    setupPolicy?: SponsoredTransactionConfirmation;
    stage: "route_policy" | "setup_policy";
  }
): EarnPolicyConfirmRequestBody & {
  policyTransaction: string;
  setupPolicyTransaction: string;
} {
  const { input, policy, setupPolicy, stage } = args;
  const setupPolicyFields =
    stage === "setup_policy" && setupPolicy
      ? {
          setupPolicyConfirmedSlot: setupPolicy.confirmedSlot,
          setupPolicySignature: setupPolicy.signature,
        }
      : {};

  return {
    ...setupPolicyFields,
    cluster: input.cluster,
    confirmedSlot: policy.confirmedSlot,
    delegatedSigner: input.delegatedSigner,
    liquidityMint: input.liquidityMint,
    market: input.market,
    policyAccount: input.policyAccount,
    policyId: input.policyId.toString(),
    policySeed: input.policySeed.toString(),
    policySignature: policy.signature,
    policyTransaction: input.policyTransaction,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    setupPolicyId: input.setupPolicyId?.toString() ?? null,
    setupPolicySeed: input.setupPolicySeed?.toString() ?? null,
    setupPolicyTransaction: input.setupPolicyTransaction,
    settings: input.settings,
    stage,
    targetReserve: input.targetReserve,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
  };
}

function buildForwardedRequest(args: {
  body: ReturnType<typeof buildForwardedConfirmBody>;
  headers: Headers;
  url: string;
}): Request {
  return new Request(args.url, {
    body: JSON.stringify(args.body),
    headers: args.headers,
    method: "POST",
  });
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

  let policy: SponsoredTransactionConfirmation;
  let setupPolicy: SponsoredTransactionConfirmation | undefined;
  try {
    policy = await executeSponsoredEarnPolicyTransaction(
      input.policyTransaction
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

  if (input.stage === "setup_policy") {
    const routePolicyResponse = await confirmEarnPolicy(
      buildForwardedRequest({
        body: buildForwardedConfirmBody({
          input,
          policy,
          stage: "route_policy",
        }),
        headers,
        url: request.url,
      })
    );
    if (!routePolicyResponse.ok) {
      return routePolicyResponse;
    }

    try {
      setupPolicy = await executeSponsoredEarnPolicyTransaction(
        input.setupPolicyTransaction
      );
    } catch (error) {
      if (error instanceof EarnPolicySponsoredTransactionError) {
        return jsonError(error.status, error.code, error.message);
      }
      throw error;
    }
  }

  return confirmEarnPolicy(
    buildForwardedRequest({
      body: buildForwardedConfirmBody({
        input,
        policy,
        setupPolicy,
        stage: input.stage,
      }),
      headers,
      url: request.url,
    })
  );
}
