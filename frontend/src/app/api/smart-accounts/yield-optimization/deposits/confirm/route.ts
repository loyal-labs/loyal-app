import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { parseEarnDepositConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnDepositConfirmError,
  recordConfirmedEarnDeposit,
  resolvePolicyCreationSignatureFromChain,
} from "@/lib/yield-optimization/earn-deposit-confirm.server";
import {
  findActiveYieldRoutePolicyPair,
  type ConfirmedYieldDepositInput,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

// A top-up reuses a policy that already exists on-chain, so nothing in this
// flow signs a policy transaction — the recorded "policy signature" is only a
// citation of where we last saw that policy. The browser can only cite the DB
// row it got from Earn state, and that row is legitimately absent: a full Earn
// exit releases the policy pair, and a failed confirm never writes one. Left to
// the client, such a deposit dead-ends forever ("Confirming this Earn top-up
// requires the active policy signature"), because the state it is told to
// refresh will always be empty.
//
// So the server owns the citation for a reuse, exactly as the mobile confirm
// twin does: read the DB pair, and when it is missing, recover the policy's
// creation signature from the chain. The setup policy is recovered alongside
// it, because `getConfirmedSetupPolicyMetadata` only writes the managed-vault
// row — which every Earn read keys on — when that metadata is complete.
async function resolveReusedPolicyCitation(
  input: ConfirmedYieldDepositInput,
  walletAddress: string
): Promise<ConfirmedYieldDepositInput> {
  const pair = await findActiveYieldRoutePolicyPair({
    authority: walletAddress,
    cluster: input.cluster,
    settings: input.settings,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
  });
  if (
    pair?.routePolicy.policyAccount === input.policyAccount &&
    pair.routePolicy.lastSeenSignature
  ) {
    return {
      ...input,
      policyConfirmedSlot: pair.routePolicy.lastSeenSlot,
      policySignature: pair.routePolicy.lastSeenSignature,
    };
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const routeCreation = await resolvePolicyCreationSignatureFromChain({
    cluster: solanaEnv,
    policyAccount: input.policyAccount,
  });
  if (!routeCreation) {
    throw new EarnDepositConfirmError({
      code: "policy_signature_unresolved",
      message:
        "We couldn't verify your Earn policy on-chain. Your deposit is safe — please try again in a moment.",
      status: 400,
    });
  }

  const setupCreation = input.setupPolicyAccount
    ? await resolvePolicyCreationSignatureFromChain({
        cluster: solanaEnv,
        policyAccount: input.setupPolicyAccount,
      })
    : null;

  console.warn("[earn-deposit-confirm] adopted reused policy from chain", {
    policyAccount: input.policyAccount,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    setupPolicyRecovered: setupCreation !== null,
    walletAddress,
  });

  return {
    ...input,
    policyConfirmedSlot: BigInt(routeCreation.slot),
    policySignature: routeCreation.signature,
    ...(setupCreation
      ? {
          setupPolicyConfirmedSlot: BigInt(setupCreation.slot),
          setupPolicySignature: setupCreation.signature,
        }
      : {}),
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ConfirmedYieldDepositInput;
  try {
    input = parseEarnDepositConfirmRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  try {
    if (input.policyInitialization === "reuse") {
      input = await resolveReusedPolicyCitation(input, principal.walletAddress);
    }

    const position = await recordConfirmedEarnDeposit({
      principal: {
        walletAddress: principal.walletAddress,
        smartAccountAddress: principal.smartAccountAddress,
        settingsPda: principal.settingsPda,
      },
      input,
    });
    return NextResponse.json({ position });
  } catch (error) {
    if (error instanceof EarnDepositConfirmError) {
      return jsonError(error.status, error.code, error.message);
    }
    throw error;
  }
}
