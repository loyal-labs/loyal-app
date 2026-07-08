import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";
import {
  parseEarnSponsoredAutodepositSetupConfirmRequestBody,
  type EarnAutodepositSetupConfirmRequestBody,
  type SponsoredEarnAutodepositSetupInput,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  executeSponsoredEarnPolicyTransaction,
  type SponsoredTransactionConfirmation,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

import { POST as confirmEarnAutodepositSetup } from "../route";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function buildForwardedConfirmBody(args: {
  input: SponsoredEarnAutodepositSetupInput;
  setup: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
}): EarnAutodepositSetupConfirmRequestBody & {
  setupTransaction: string;
} {
  const { input, setup } = args;
  return {
    amountPerPeriodRaw: input.amountPerPeriodRaw.toString(),
    cluster: input.cluster,
    confirmedSlot: setup.confirmedSlot,
    delegatedSigner: input.delegatedSigner,
    expiryTimestamp: input.expiryTimestamp.toString(),
    liquidityMint: input.liquidityMint,
    nonce: input.nonce.toString(),
    periodLengthSeconds: input.periodLengthSeconds.toString(),
    policyAccount: input.policyAccount,
    policyId: input.policyId.toString(),
    policySeed: input.policySeed.toString(),
    recurringDelegation: input.recurringDelegation,
    settings: input.settings,
    setupSignature: setup.signature,
    setupStage: input.setupStage,
    setupTransaction: input.setupTransaction,
    startTimestamp: input.startTimestamp.toString(),
    subscriptionAuthority: input.subscriptionAuthority,
    subscriptionAuthorityInitialization:
      input.subscriptionAuthorityInitialization,
    subscriptionDelegatee: input.subscriptionDelegatee,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    vaultUsdcAta: input.vaultUsdcAta,
    walletAddress: input.walletAddress,
    walletBalanceFloorRaw: input.walletBalanceFloorRaw.toString(),
    walletUsdcAta: input.walletUsdcAta,
  };
}

function responseBodyWithSponsoredConfirmations(args: {
  payload: unknown;
  setup: SponsoredTransactionConfirmation;
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
      setup: args.setup,
    },
  };
}

function sponsoredAutodepositSetupGuard(
  input: SponsoredEarnAutodepositSetupInput
) {
  if (input.setupStage !== "create_policy") {
    return undefined;
  }

  return {
    allowedSmartAccountRentAccounts: [new PublicKey(input.policyAccount)],
    allowedSmartAccountsProgramId: new PublicKey(
      getServerEnv().loyalSmartAccounts.programId
    ),
  };
}

export async function POST(request: Request) {
  let input: SponsoredEarnAutodepositSetupInput;
  try {
    input = parseEarnSponsoredAutodepositSetupConfirmRequestBody(
      await request.json()
    );
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  let setup: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
  try {
    setup = await executeSponsoredEarnPolicyTransaction(
      input.setupTransaction,
      sponsoredAutodepositSetupGuard(input)
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

  const forwardedResponse = await confirmEarnAutodepositSetup(
    new Request(request.url, {
      body: JSON.stringify(buildForwardedConfirmBody({ input, setup })),
      headers,
      method: "POST",
    })
  );
  const forwardedPayload = await forwardedResponse.json().catch(() => null);
  return NextResponse.json(
    responseBodyWithSponsoredConfirmations({
      payload: forwardedPayload,
      setup,
    }),
    { status: forwardedResponse.status }
  );
}
