import { NextResponse } from "next/server";
import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaConnection } from "@/lib/solana/rpc-connection.server";
import {
  parseEarnSponsoredAutodepositSetupPrefundRequestBody,
  type EarnSponsoredAutodepositSetupPrefundResponse,
  type SponsoredEarnAutodepositSetupPrefundInput,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  prefundEarnPolicySponsorDestination,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

const EARN_DEPOSIT_VAULT_INDEX = 1 as const;

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function toSafePolicySeed(policySeed: bigint): number {
  if (policySeed <= BigInt(0) || policySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("policySeed is outside the supported autodeposit range.");
  }

  return Number(policySeed);
}

function validateCanonicalPrefundInput(
  input: SponsoredEarnAutodepositSetupPrefundInput
) {
  const cluster = normalizeLoyalCluster(input.cluster);
  const settings = new PublicKey(input.settings);
  const policyAccount = new PublicKey(input.policyAccount);
  const wallet = new PublicKey(input.walletAddress);
  const expectedPolicyAccount = pda.getPolicyPda({
    settingsPda: settings,
    policySeed: toSafePolicySeed(input.policySeed),
  })[0];

  if (input.setupStage !== "create_policy") {
    throw new Error(
      "Sponsored Autodeposit setup pre-fund is only available for create_policy."
    );
  }
  if (input.vaultIndex !== EARN_DEPOSIT_VAULT_INDEX) {
    throw new Error("vaultIndex must be 1 for Earn autodeposit.");
  }
  if (!expectedPolicyAccount.equals(policyAccount)) {
    throw new Error(
      "policyAccount does not match canonical Earn autodeposit metadata."
    );
  }

  return {
    cluster,
    policyAccount,
    wallet,
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: SponsoredEarnAutodepositSetupPrefundInput;
  try {
    input = parseEarnSponsoredAutodepositSetupPrefundRequestBody(
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
      "Sponsored Autodeposit setup pre-fund does not match the authenticated wallet session."
    );
  }

  let canonical: ReturnType<typeof validateCanonicalPrefundInput>;
  try {
    canonical = validateCanonicalPrefundInput(input);
  } catch (error) {
    return jsonError(
      400,
      "metadata_mismatch",
      error instanceof Error
        ? error.message
        : "Sponsored Autodeposit setup pre-fund metadata is invalid."
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (canonical.cluster !== configuredCluster) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Sponsored Autodeposit setup pre-fund cluster does not match the configured Solana environment."
    );
  }

  const connection = getServerSolanaConnection(solanaEnv);
  const policyAccountInfo = await connection.getAccountInfo(
    canonical.policyAccount,
    "confirmed"
  );
  if (policyAccountInfo) {
    return jsonError(
      409,
      "policy_already_exists",
      "Autodeposit policy account already exists."
    );
  }

  try {
    const sponsoredPrefund = await prefundEarnPolicySponsorDestination({
      destination: canonical.wallet,
      requiredLamports: input.requiredLamports,
    });
    return NextResponse.json({
      sponsoredPrefund,
    } satisfies EarnSponsoredAutodepositSetupPrefundResponse);
  } catch (error) {
    if (error instanceof EarnPolicySponsoredTransactionError) {
      return jsonError(error.status, error.code, error.message);
    }
    throw error;
  }
}
