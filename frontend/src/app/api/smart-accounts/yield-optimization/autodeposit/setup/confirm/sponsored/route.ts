import { NextResponse } from "next/server";

import {
  parseEarnSponsoredAutodepositSetupConfirmRequestBody,
  type EarnAutodepositSetupConfirmRequestBody,
  type SponsoredEarnAutodepositSetupInput,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";

import { POST as confirmEarnAutodepositSetup } from "../route";

const MOCK_CONFIRMED_SLOT = "0";
const MOCK_SETUP_SIGNATURE = "mock-sponsored-autodeposit-setup-signature";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function buildForwardedConfirmBody(
  input: SponsoredEarnAutodepositSetupInput
): EarnAutodepositSetupConfirmRequestBody & {
  setupTransaction: string;
} {
  return {
    amountPerPeriodRaw: input.amountPerPeriodRaw.toString(),
    cluster: input.cluster,
    confirmedSlot: MOCK_CONFIRMED_SLOT,
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
    setupSignature: MOCK_SETUP_SIGNATURE,
    setupStage: input.setupStage,
    setupTransaction: input.setupTransaction,
    startTimestamp: input.startTimestamp.toString(),
    subscriptionAuthority: input.subscriptionAuthority,
    subscriptionAuthorityInitialization: input.subscriptionAuthorityInitialization,
    subscriptionDelegatee: input.subscriptionDelegatee,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    vaultUsdcAta: input.vaultUsdcAta,
    walletAddress: input.walletAddress,
    walletBalanceFloorRaw: input.walletBalanceFloorRaw.toString(),
    walletUsdcAta: input.walletUsdcAta,
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

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  return confirmEarnAutodepositSetup(
    new Request(request.url, {
      body: JSON.stringify(buildForwardedConfirmBody(input)),
      headers,
      method: "POST",
    })
  );
}
