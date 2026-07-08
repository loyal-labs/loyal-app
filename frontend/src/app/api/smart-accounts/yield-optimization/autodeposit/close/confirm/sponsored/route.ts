import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import {
  parseEarnSponsoredAutodepositCloseConfirmRequestBody,
  type EarnAutodepositCloseConfirmRequestBody,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  executeSponsoredEarnPolicyTransaction,
  type SponsoredTransactionConfirmation,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

import { POST as confirmEarnAutodepositClose } from "../route";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function buildForwardedConfirmBody(args: {
  close: SponsoredTransactionConfirmation;
  input: ReturnType<
    typeof parseEarnSponsoredAutodepositCloseConfirmRequestBody
  >;
}): EarnAutodepositCloseConfirmRequestBody & {
  closeTransaction: string;
} {
  const { close, input } = args;
  return {
    cluster: input.cluster,
    closeSignature: close.signature,
    closeTransaction: input.closeTransaction,
    confirmedSlot: close.confirmedSlot,
    delegatedSigner: input.delegatedSigner,
    policyAccount: input.policyAccount,
    recurringDelegation: input.recurringDelegation,
    settings: input.settings,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
  };
}

function responseBodyWithSponsoredConfirmations(args: {
  close: SponsoredTransactionConfirmation;
  payload: unknown;
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
      close: args.close,
    },
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ReturnType<
    typeof parseEarnSponsoredAutodepositCloseConfirmRequestBody
  >;
  try {
    input = parseEarnSponsoredAutodepositCloseConfirmRequestBody(
      await request.json()
    );
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  if (
    input.walletAddress !== principal.walletAddress ||
    input.settings !== principal.settingsPda
  ) {
    return jsonError(
      403,
      "principal_mismatch",
      "Sponsored Autodeposit close does not belong to the active session."
    );
  }

  let close: SponsoredTransactionConfirmation;
  try {
    close = await executeSponsoredEarnPolicyTransaction(
      input.closeTransaction,
      {
        allowedSmartAccountRentAccounts: [new PublicKey(input.policyAccount)],
        allowedSmartAccountsProgramId: new PublicKey(
          getServerEnv().loyalSmartAccounts.programId
        ),
      }
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

  const forwardedResponse = await confirmEarnAutodepositClose(
    new Request(request.url, {
      body: JSON.stringify(buildForwardedConfirmBody({ close, input })),
      headers,
      method: "POST",
    })
  );
  const forwardedPayload = await forwardedResponse.json().catch(() => null);
  return NextResponse.json(
    responseBodyWithSponsoredConfirmations({
      close,
      payload: forwardedPayload,
    }),
    { status: forwardedResponse.status }
  );
}
