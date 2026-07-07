import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import {
  parseEarnSponsoredWithdrawalConfirmRequestBody,
  type EarnWithdrawalConfirmRequestBody,
  type SponsoredYieldWithdrawalConfirmInput,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  executeSignedEarnPolicyTransaction,
  executeSponsoredEarnPolicyTransaction,
  type SponsoredTransactionConfirmation,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

import { POST as confirmEarnWithdraw } from "../route";

const EARN_DEPOSIT_VAULT_INDEX = 1;

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function optionalBigIntString(value: bigint | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}

function buildForwardedConfirmBody(args: {
  input: SponsoredYieldWithdrawalConfirmInput;
  withdrawal: SponsoredTransactionConfirmation;
}): EarnWithdrawalConfirmRequestBody {
  const { input, withdrawal } = args;
  return {
    ...(input.autodepositClose
      ? {
          autodepositClose: {
            ...input.autodepositClose,
            confirmedSlot: input.autodepositClose.confirmedSlot.toString(),
          },
        }
      : {}),
    accountingReserve: input.accountingReserve ?? null,
    cluster: input.cluster,
    confirmedSlot: withdrawal.confirmedSlot,
    delegatedSigner: input.delegatedSigner,
    executionReserve: input.executionReserve ?? null,
    isFinalStep: input.isFinalStep ?? null,
    liquidityMint: input.liquidityMint,
    market: input.market,
    mode: input.mode,
    policyAccount: input.policyAccount,
    policyId: input.policyId.toString(),
    policySeed: input.policySeed.toString(),
    reserveWithdrawals: input.reserveWithdrawals ?? null,
    settings: input.settings,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    setupPolicyId: optionalBigIntString(input.setupPolicyId),
    setupPolicySeed: optionalBigIntString(input.setupPolicySeed),
    smartAccountAddress: input.smartAccountAddress,
    sourceAmountRaw: optionalBigIntString(input.sourceAmountRaw),
    sourceId: input.sourceId ?? null,
    sourceMetadata: input.sourceMetadata ?? null,
    sourceMint: input.sourceMint ?? null,
    sourceTokenAccount: input.sourceTokenAccount ?? null,
    sourceType: input.sourceType ?? null,
    stepCount: input.stepCount ?? null,
    stepIndex: input.stepIndex ?? null,
    targetReserve: input.targetReserve,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
    withdrawalSignature: withdrawal.signature,
    withdrawnAmountRaw: input.withdrawnAmountRaw.toString(),
  };
}

function responseBodyWithSponsoredConfirmations(args: {
  policyClose: SponsoredTransactionConfirmation | null;
  payload: unknown;
  withdrawal: SponsoredTransactionConfirmation;
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
      policyClose: args.policyClose,
      withdrawal: args.withdrawal,
    },
  };
}

function assertSponsoredWithdrawalInput(
  input: SponsoredYieldWithdrawalConfirmInput,
  principal: {
    settingsPda: string;
    walletAddress: string;
  }
) {
  if (
    input.walletAddress !== principal.walletAddress ||
    input.settings !== principal.settingsPda
  ) {
    throw new EarnPolicySponsoredTransactionError({
      status: 403,
      code: "principal_mismatch",
      message:
        "Sponsored Earn withdrawal does not belong to the active session.",
    });
  }
  if (input.vaultIndex !== EARN_DEPOSIT_VAULT_INDEX) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "invalid_vault_index",
      message: "Sponsored Earn withdrawal must target the Earn vault.",
    });
  }
  if (input.mode !== "full" || input.isFinalStep === false) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "unsupported_sponsored_withdrawal",
      message:
        "Sponsored Earn withdrawal is only supported for the final full-withdraw step.",
    });
  }
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: SponsoredYieldWithdrawalConfirmInput;
  try {
    input = parseEarnSponsoredWithdrawalConfirmRequestBody(
      await request.json()
    );
    assertSponsoredWithdrawalInput(input, principal);
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

  const smartAccountCloseGuard = {
    allowedSmartAccountRentAccounts: [
      new PublicKey(input.policyAccount),
      ...(input.setupPolicyAccount
        ? [new PublicKey(input.setupPolicyAccount)]
        : []),
    ],
    allowedSmartAccountsProgramId: new PublicKey(
      getServerEnv().loyalSmartAccounts.programId
    ),
    requireSponsorFeePayer: false,
  };

  let withdrawal: SponsoredTransactionConfirmation;
  try {
    withdrawal = input.policyCloseTransaction
      ? await executeSignedEarnPolicyTransaction(input.withdrawalTransaction)
      : await executeSponsoredEarnPolicyTransaction(
          input.withdrawalTransaction,
          smartAccountCloseGuard
        );
  } catch (error) {
    if (error instanceof EarnPolicySponsoredTransactionError) {
      return jsonError(error.status, error.code, error.message);
    }
    throw error;
  }

  let policyClose: SponsoredTransactionConfirmation | null = null;
  if (input.policyCloseTransaction) {
    try {
      policyClose = await executeSponsoredEarnPolicyTransaction(
        input.policyCloseTransaction,
        smartAccountCloseGuard
      );
    } catch (error) {
      if (error instanceof EarnPolicySponsoredTransactionError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
            },
            sponsoredConfirmations: {
              policyClose: null,
              withdrawal,
            },
          },
          { status: error.status }
        );
      }
      throw error;
    }
  }

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  const forwardedResponse = await confirmEarnWithdraw(
    new Request(request.url, {
      body: JSON.stringify(buildForwardedConfirmBody({ input, withdrawal })),
      headers,
      method: "POST",
    })
  );
  const forwardedPayload = await forwardedResponse.json().catch(() => null);
  return NextResponse.json(
    responseBodyWithSponsoredConfirmations({
      payload: forwardedPayload,
      policyClose,
      withdrawal,
    }),
    { status: forwardedResponse.status }
  );
}
