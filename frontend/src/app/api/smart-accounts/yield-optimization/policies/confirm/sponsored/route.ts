import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";
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

function buildForwardedConfirmBody(args: {
  input: SponsoredYieldRoutePolicyInput;
  policy: SponsoredTransactionConfirmation;
  setupPolicy?: SponsoredTransactionConfirmation;
  stage: "route_policy" | "setup_policy";
}): EarnPolicyConfirmRequestBody & {
  policyTransaction: string;
  setupPolicyTransaction?: string | null;
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
    ...(input.setupPolicyTransaction
      ? { setupPolicyTransaction: input.setupPolicyTransaction }
      : {}),
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

function responseBodyWithSponsoredConfirmations(args: {
  payload: unknown;
  policy: SponsoredTransactionConfirmation;
  setupPolicy?: SponsoredTransactionConfirmation;
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
      policy: args.policy,
      setupPolicy: args.setupPolicy ?? null,
    },
  };
}

function sponsoredPolicyTransactionGuard(policyAccount: string) {
  return {
    allowedSmartAccountRentAccounts: [new PublicKey(policyAccount)],
    allowedSmartAccountsProgramId: new PublicKey(
      getServerEnv().loyalSmartAccounts.programId
    ),
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

  let policy: SponsoredTransactionConfirmation;
  let setupPolicy: SponsoredTransactionConfirmation | undefined;
  try {
    policy = await executeSponsoredEarnPolicyTransaction(
      input.policyTransaction,
      sponsoredPolicyTransactionGuard(input.policyAccount)
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
    const routePolicyPayload = await routePolicyResponse
      .json()
      .catch(() => null);
    if (!routePolicyResponse.ok) {
      return NextResponse.json(
        responseBodyWithSponsoredConfirmations({
          payload: routePolicyPayload,
          policy,
        }),
        { status: routePolicyResponse.status }
      );
    }

    try {
      if (!input.setupPolicyTransaction) {
        throw new EarnPolicySponsoredTransactionError({
          status: 400,
          code: "missing_setup_policy_transaction",
          message: "setupPolicyTransaction is required for policy setup.",
        });
      }
      if (!input.setupPolicyAccount) {
        throw new EarnPolicySponsoredTransactionError({
          status: 400,
          code: "missing_setup_policy_account",
          message: "setupPolicyAccount is required for sponsored policy setup.",
        });
      }
      setupPolicy = await executeSponsoredEarnPolicyTransaction(
        input.setupPolicyTransaction,
        sponsoredPolicyTransactionGuard(input.setupPolicyAccount)
      );
    } catch (error) {
      if (error instanceof EarnPolicySponsoredTransactionError) {
        return NextResponse.json(
          responseBodyWithSponsoredConfirmations({
            payload: { error: { code: error.code, message: error.message } },
            policy,
          }),
          { status: error.status }
        );
      }
      throw error;
    }
  }

  const forwardedResponse = await confirmEarnPolicy(
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
  const forwardedPayload = await forwardedResponse.json().catch(() => null);
  return NextResponse.json(
    responseBodyWithSponsoredConfirmations({
      payload: forwardedPayload,
      policy,
      setupPolicy,
    }),
    { status: forwardedResponse.status }
  );
}
