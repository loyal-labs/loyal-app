import { NextResponse } from "next/server";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import {
  resolveDepositSponsoredTransactionGuards,
  resolveReusePolicyConfirmation,
} from "@/lib/yield-optimization/earn-deposit-sponsored-confirm.server";
import {
  hydratePreparedEarnUsdcDeposit,
  type WireSmartAccountPreparedEarnUsdcDeposit,
} from "@/lib/yield-optimization/earn-deposit-prepare-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  executeSponsoredEarnPolicyTransaction,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

import { POST as confirmMobileEarnDeposit } from "../route";

// Mobile twin of `yield-optimization/deposits/confirm/sponsored`. The device
// signs each prepared stage (with the sponsor as fee payer) but does NOT send;
// it echoes the serialized prepared deposit plus the base64 signed
// transactions. This route sponsor-signs, sends and confirms each stage in
// order, then forwards the real signatures/slots into the regular mobile
// confirm twin so recording stays on one code path.
const EARN_DEPOSIT_VAULT_INDEX = 1;

type SponsoredConfirmation = Awaited<
  ReturnType<typeof executeSponsoredEarnPolicyTransaction>
>;

type MobileSponsoredConfirmFields = {
  preparedDeposit: WireSmartAccountPreparedEarnUsdcDeposit;
  depositTransaction: string;
  policyTransaction?: string;
  setupPolicyTransaction?: string;
};

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseMobileSponsoredConfirmFields(
  body: unknown
): MobileSponsoredConfirmFields {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object.");
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.preparedDeposit !== "object" ||
    record.preparedDeposit === null
  ) {
    throw new Error("preparedDeposit is required.");
  }
  if (
    typeof record.depositTransaction !== "string" ||
    !record.depositTransaction
  ) {
    throw new Error("depositTransaction is required.");
  }
  return {
    preparedDeposit:
      record.preparedDeposit as WireSmartAccountPreparedEarnUsdcDeposit,
    depositTransaction: record.depositTransaction,
    policyTransaction: optionalString(record.policyTransaction),
    setupPolicyTransaction: optionalString(record.setupPolicyTransaction),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", "Invalid request body.");
  }

  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileWalletRequest({
      body,
      // Accepts the flow's prepare signature too — the device signs one auth
      // message per deposit flow (see authenticateMobileWalletRequest).
      purpose: ["earn-deposit-confirm", "earn-deposit-prepare"],
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let fields: MobileSponsoredConfirmFields;
  try {
    fields = parseMobileSponsoredConfirmFields(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  // Resolve the account (must already exist — prepare provisioned it).
  let settingsPda: string;
  let vaultPubkey: string;
  try {
    const user = await getOrCreateCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const existing = await findReadyCurrentUserSmartAccount({
      userId: user.id,
    });
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
    const programId = new PublicKey(
      getServerEnv().loyalSmartAccounts.programId
    );
    vaultPubkey = pda
      .getSmartAccountPda({
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        programId,
        settingsPda: new PublicKey(settingsPda),
      })[0]
      .toBase58();
  } catch (error) {
    console.error("[mobile-earn-deposit-confirm-sponsored] resolve failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown resolve error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "resolve_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  let policy: SponsoredConfirmation;
  let setupPolicy: SponsoredConfirmation | undefined;
  let deposit: SponsoredConfirmation;
  try {
    const persistence = hydratePreparedEarnUsdcDeposit(
      fields.preparedDeposit
    ).persistence;

    // Mobile-auth mirror of the session route's principal assertion: the
    // echoed prepare must belong to the authenticated wallet's Earn vault.
    if (
      persistence.walletAddress !== walletAddress ||
      persistence.settings !== settingsPda
    ) {
      return jsonError(
        403,
        "principal_mismatch",
        "Sponsored Earn deposit does not belong to the authenticated wallet."
      );
    }
    if (
      persistence.vaultIndex !== EARN_DEPOSIT_VAULT_INDEX ||
      persistence.vaultPubkey !== vaultPubkey
    ) {
      return jsonError(
        403,
        "vault_mismatch",
        "Sponsored Earn deposit vault does not match the authenticated wallet."
      );
    }

    const guards = await resolveDepositSponsoredTransactionGuards({
      depositMint: persistence.depositMint,
      liquidityMint: persistence.liquidityMint,
      policyAccount: persistence.policyAccount,
      policyInitialization: persistence.policyInitialization,
      setupPolicyAccount: persistence.setupPolicyAccount ?? null,
      smartAccountAddress: vaultPubkey,
      targetReserve: persistence.targetReserve,
      vaultPubkey: persistence.vaultPubkey,
    });
    if (persistence.policyInitialization === "create") {
      if (!fields.policyTransaction) {
        throw new EarnPolicySponsoredTransactionError({
          status: 400,
          code: "missing_policy_transaction",
          message:
            "policyTransaction is required when policyInitialization is create.",
        });
      }
      policy = await executeSponsoredEarnPolicyTransaction(
        fields.policyTransaction,
        guards.policy
      );
      if (!fields.setupPolicyTransaction) {
        throw new EarnPolicySponsoredTransactionError({
          status: 400,
          code: "missing_setup_policy_transaction",
          message:
            "setupPolicyTransaction is required when policyInitialization is create.",
        });
      }
      setupPolicy = await executeSponsoredEarnPolicyTransaction(
        fields.setupPolicyTransaction,
        guards.setupPolicy
      );
    } else {
      policy = await resolveReusePolicyConfirmation({
        cluster: persistence.cluster,
        policyAccount: persistence.policyAccount,
        policySeed: BigInt(persistence.policySeed),
        settings: persistence.settings,
        vaultIndex: persistence.vaultIndex,
        vaultPubkey: persistence.vaultPubkey,
        walletAddress,
      });
    }
    deposit = await executeSponsoredEarnPolicyTransaction(
      fields.depositTransaction,
      guards.deposit
    );
  } catch (error) {
    if (error instanceof EarnPolicySponsoredTransactionError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[mobile-earn-deposit-confirm-sponsored] execute failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown execute error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "sponsored_execution_failed",
      "Failed to execute the sponsored Earn deposit."
    );
  }

  // Forward into the regular mobile confirm twin with the real signatures and
  // slots. The original body already carries the wallet-auth fields and the
  // echoed prepared deposit; the twin's parser ignores the *Transaction extras.
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  const forwardedResponse = await confirmMobileEarnDeposit(
    new Request(request.url, {
      body: JSON.stringify({
        ...(body as Record<string, unknown>),
        depositSignature: deposit.signature,
        confirmedSlot: deposit.confirmedSlot,
        policySignature: policy.signature,
        policyConfirmedSlot: policy.confirmedSlot,
        ...(setupPolicy
          ? {
              setupPolicySignature: setupPolicy.signature,
              setupPolicyConfirmedSlot: setupPolicy.confirmedSlot,
            }
          : {}),
      }),
      headers,
      method: "POST",
    })
  );
  const forwardedPayload = await forwardedResponse.json().catch(() => null);
  const payload =
    forwardedPayload &&
    typeof forwardedPayload === "object" &&
    !Array.isArray(forwardedPayload)
      ? forwardedPayload
      : { data: forwardedPayload };
  return NextResponse.json(
    {
      ...payload,
      sponsoredConfirmations: {
        deposit,
        policy,
        setupPolicy: setupPolicy ?? null,
      },
    },
    { status: forwardedResponse.status }
  );
}
