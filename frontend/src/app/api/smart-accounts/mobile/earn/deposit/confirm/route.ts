import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { reportEarnDepositQuestCompletion } from "@/features/solana-week/server/quest-completion-service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  buildEarnDepositConfirmRequestBody,
  parseEarnDepositConfirmRequestBody,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnDepositConfirmError,
  recordConfirmedEarnDeposit,
  resolvePolicyCreationSignatureFromChain,
} from "@/lib/yield-optimization/earn-deposit-confirm.server";
import {
  resolveEarnDepositConfirmPolicySignature,
  type EarnDepositPolicySignatureSource,
} from "@/lib/yield-optimization/earn-deposit-flow.shared";
import {
  hydratePreparedEarnUsdcDeposit,
  type WireSmartAccountPreparedEarnUsdcDeposit,
} from "@/lib/yield-optimization/earn-deposit-prepare-contracts.shared";
import { findActiveYieldRoutePolicyPair } from "@/lib/yield-optimization/yield-deposit-repository.server";

// Mobile twin of `yield-optimization/deposits/confirm`. The device echoes back
// the serialized prepared deposit it signed plus each stage's signature+slot;
// this route rebuilds the canonical confirm payload server-side (the web client
// does this in-browser) and defers to the shared `recordConfirmedEarnDeposit`.
const EARN_DEPOSIT_VAULT_INDEX = 1;

type MobileConfirmFields = {
  preparedDeposit: WireSmartAccountPreparedEarnUsdcDeposit;
  depositSignature: string;
  confirmedSlot: string;
  policySignature?: string;
  policyConfirmedSlot?: string;
  setupPolicySignature?: string;
  setupPolicyConfirmedSlot?: string;
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

function parseMobileConfirmFields(body: unknown): MobileConfirmFields {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object.");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.preparedDeposit !== "object" || record.preparedDeposit === null) {
    throw new Error("preparedDeposit is required.");
  }
  if (typeof record.depositSignature !== "string" || !record.depositSignature) {
    throw new Error("depositSignature is required.");
  }
  if (typeof record.confirmedSlot !== "string" || !record.confirmedSlot) {
    throw new Error("confirmedSlot is required.");
  }
  return {
    preparedDeposit:
      record.preparedDeposit as WireSmartAccountPreparedEarnUsdcDeposit,
    depositSignature: record.depositSignature,
    confirmedSlot: record.confirmedSlot,
    policySignature: optionalString(record.policySignature),
    policyConfirmedSlot: optionalString(record.policyConfirmedSlot),
    setupPolicySignature: optionalString(record.setupPolicySignature),
    setupPolicyConfirmedSlot: optionalString(record.setupPolicyConfirmedSlot),
  };
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
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
      purpose: "earn-deposit-confirm",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let fields: MobileConfirmFields;
  try {
    fields = parseMobileConfirmFields(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  // Resolve the account (must already exist — prepare provisioned it).
  let smartAccountAddress: string;
  let settingsPda: string;
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
    // Earn confirm keys on the vault (smart-account index 1), not the wallet's
    // main account (index 0) that findReadyCurrentUserSmartAccount returns. The
    // web client derives the vault from the prepared op; mirror that here so the
    // canonical `smartAccountAddress` check passes and the vault-keyed position
    // is matched. (Same derivation the deposit-confirm canonical uses.)
    smartAccountAddress = pda
      .getSmartAccountPda({
        settingsPda: new PublicKey(settingsPda),
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      })[0]
      .toBase58();
  } catch (error) {
    console.error("[mobile-earn-deposit-confirm] resolve failed", {
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

  // Rebuild + record. Hydrate the echoed prepared deposit, resolve the policy
  // signature (the active policy's last-seen signature for top-ups, or the
  // mobile-supplied policy-stage signatures for a first deposit), build the
  // canonical confirm body, then hand off to the shared recorder.
  try {
    const solanaEnv = getConfiguredSolanaEnv();
    const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
    const preparedDeposit = hydratePreparedEarnUsdcDeposit(
      fields.preparedDeposit
    );

    const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda: new PublicKey(settingsPda),
    });
    const policyPair = await findActiveYieldRoutePolicyPair({
      authority: walletAddress,
      cluster,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
    });
    let activePolicy: EarnDepositPolicySignatureSource = policyPair?.routePolicy
      ? {
          account: policyPair.routePolicy.policyAccount,
          seed: policyPair.routePolicy.policySeed.toString(),
          lastSeenSignature: policyPair.routePolicy.lastSeenSignature,
          lastSeenSlot: policyPair.routePolicy.lastSeenSlot?.toString() ?? null,
        }
      : null;
    // Recovery path: prepare can reuse a policy pair it discovered on-chain
    // when a prior confirm failure left no DB rows — then there is no recorded
    // creation signature for the reuse resolution to cite. Resolve it from the
    // chain so this confirm can adopt the policy instead of failing.
    const reusedPolicyAccount = preparedDeposit.policy.account.toBase58();
    let adoptedSetupPolicy: { signature: string; slot: string } | null = null;
    if (
      !preparedDeposit.policySetupPrepared &&
      !preparedDeposit.policyFinalizePrepared &&
      preparedDeposit.persistence.policyInitialization !== "create" &&
      (!activePolicy ||
        activePolicy.account !== reusedPolicyAccount ||
        !activePolicy.lastSeenSignature)
    ) {
      const creation = await resolvePolicyCreationSignatureFromChain({
        cluster: solanaEnv,
        policyAccount: reusedPolicyAccount,
      });
      if (creation) {
        activePolicy = {
          account: reusedPolicyAccount,
          seed: preparedDeposit.policy.seed.toString(),
          lastSeenSignature: creation.signature,
          lastSeenSlot: creation.slot,
        };
        // Adopt the setup policy of the reused pair too: the recorder only
        // writes the managed-vault row — which every Earn read (holdings,
        // withdraw sources) keys on — when the confirm carries complete
        // setup-policy metadata (account/seed from prepare's persistence plus
        // a creation signature+slot, resolved from chain here).
        const setupPolicyAccount =
          preparedDeposit.persistence.setupPolicyAccount;
        if (setupPolicyAccount) {
          adoptedSetupPolicy = await resolvePolicyCreationSignatureFromChain({
            cluster: solanaEnv,
            policyAccount: setupPolicyAccount,
          });
        }
      }
    }

    const resolution = resolveEarnDepositConfirmPolicySignature({
      activePolicy,
      policySignature: fields.policySignature,
      policyConfirmedSlot: fields.policyConfirmedSlot,
      setupPolicySignature: fields.setupPolicySignature,
      setupPolicyConfirmedSlot: fields.setupPolicyConfirmedSlot,
      preparedDeposit,
    });
    if ("error" in resolution) {
      return jsonError(400, "policy_signature_unresolved", resolution.error);
    }

    const confirmBody = buildEarnDepositConfirmRequestBody({
      preparedDeposit,
      signature: fields.depositSignature,
      confirmedSlot: fields.confirmedSlot,
      smartAccountAddress,
      policySignature: resolution.policySignature,
      policyConfirmedSlot: resolution.policyConfirmedSlot,
      setupPolicySignature:
        resolution.setupPolicySignature ?? adoptedSetupPolicy?.signature,
      setupPolicyConfirmedSlot:
        resolution.setupPolicyConfirmedSlot ?? adoptedSetupPolicy?.slot,
    });
    const input = parseEarnDepositConfirmRequestBody(confirmBody);

    const position = await recordConfirmedEarnDeposit({
      principal: { walletAddress, smartAccountAddress, settingsPda },
      input,
    });

    // Best-effort Solana Week attribution: Quest 1 ("connect wallet and deposit
    // $5+ in Earn"). Deposits under the threshold are a no-op. Idempotent on
    // Solana's side; never blocks the deposit confirm.
    await reportEarnDepositQuestCompletion(
      walletAddress,
      input.principalAmountRaw,
      {
        source: "mobile-earn-deposit-confirm",
        solanaEnv,
        depositUsdcRaw: input.principalAmountRaw.toString(),
      }
    );

    return NextResponse.json({ position });
  } catch (error) {
    if (error instanceof EarnDepositConfirmError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[mobile-earn-deposit-confirm] build/record failed", {
      depositSignature: fields.depositSignature,
      errorMessage:
        error instanceof Error ? error.message : "Unknown confirm error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      400,
      "confirm_failed",
      error instanceof Error ? error.message : "Failed to confirm Earn deposit."
    );
  }
}
