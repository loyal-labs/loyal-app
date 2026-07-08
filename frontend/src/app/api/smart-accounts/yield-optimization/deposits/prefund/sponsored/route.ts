import { NextResponse } from "next/server";
import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  parseEarnSponsoredDepositPrefundRequestBody,
  type EarnSponsoredDepositPrefundResponse,
  type SponsoredEarnDepositPrefundInput,
} from "@/lib/yield-optimization/earn-deposit-prepare-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  prefundEarnPolicySponsorDestination,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

const EARN_DEPOSIT_VAULT_INDEX = 1 as const;
const MAX_SPONSORED_EARN_DEPOSIT_PREFUND_LAMPORTS = BigInt(200_000_000);

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function toSafePolicySeed(policySeed: bigint): number {
  if (policySeed <= BigInt(0) || policySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("policySeed is outside the supported Earn deposit range.");
  }

  return Number(policySeed);
}

function validateCanonicalPrefundInput(
  input: SponsoredEarnDepositPrefundInput
) {
  const cluster = normalizeLoyalCluster(input.cluster);
  const settings = new PublicKey(input.settings);
  const wallet = new PublicKey(input.walletAddress);
  const policyAccount = new PublicKey(input.policyAccount);
  const vault = new PublicKey(input.vaultPubkey);
  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
  const expectedPolicyAccount = pda.getPolicyPda({
    programId,
    settingsPda: settings,
    policySeed: toSafePolicySeed(input.policySeed),
  })[0];
  const expectedVault = pda.getSmartAccountPda({
    accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    programId,
    settingsPda: settings,
  })[0];

  if (input.vaultIndex !== EARN_DEPOSIT_VAULT_INDEX) {
    throw new Error("vaultIndex must be 1 for Earn deposits.");
  }
  if (!expectedPolicyAccount.equals(policyAccount)) {
    throw new Error("policyAccount does not match canonical Earn metadata.");
  }
  if (!expectedVault.equals(vault)) {
    throw new Error("vaultPubkey does not match canonical Earn metadata.");
  }

  return {
    cluster,
    wallet,
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: SponsoredEarnDepositPrefundInput;
  try {
    input = parseEarnSponsoredDepositPrefundRequestBody(await request.json());
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
      "Sponsored Earn deposit pre-fund does not match the authenticated wallet session."
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
        : "Sponsored Earn deposit pre-fund metadata is invalid."
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (canonical.cluster !== configuredCluster) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Sponsored Earn deposit pre-fund cluster does not match the configured Solana environment."
    );
  }

  try {
    const sponsoredPrefund = await prefundEarnPolicySponsorDestination({
      destination: canonical.wallet,
      maxLamports: MAX_SPONSORED_EARN_DEPOSIT_PREFUND_LAMPORTS,
      requiredLamports: input.requiredLamports,
    });
    return NextResponse.json({
      sponsoredPrefund,
    } satisfies EarnSponsoredDepositPrefundResponse);
  } catch (error) {
    if (error instanceof EarnPolicySponsoredTransactionError) {
      return jsonError(error.status, error.code, error.message);
    }
    throw error;
  }
}
