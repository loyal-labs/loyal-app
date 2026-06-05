import { NextResponse } from "next/server";
import { LoyalCluster, getKaminoUsdcEarnTargetForCluster } from "@loyal/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import {
  findActiveYieldPosition,
  findActiveYieldRoutePolicy,
  type RoutePolicyRecord,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;
const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";

function resolveConfiguredCluster(): LoyalCluster {
  const solanaEnv = resolveSolanaEnv(process.env[SOLANA_ENV_ENV_NAME]);
  return solanaEnv === "devnet"
    ? LoyalCluster.Devnet
    : LoyalCluster.MainnetBeta;
}

function serializePosition(position: UserYieldPositionRecord) {
  return {
    ...position,
    createdAt: position.createdAt.toISOString(),
    firstDepositSignature: position.firstDepositSignature,
    id: position.id.toString(),
    lastConfirmedSlot: position.lastConfirmedSlot.toString(),
    policyId: position.policyId.toString(),
    policySeed: position.policySeed.toString(),
    principalAmountRaw: position.principalAmountRaw.toString(),
    targetSupplyApyBps: position.targetSupplyApyBps?.toString() ?? null,
    updatedAt: position.updatedAt.toISOString(),
  };
}

function serializePolicy(policy: RoutePolicyRecord) {
  return {
    account: policy.policyAccount,
    id: policy.id.toString(),
    seed: policy.policySeed.toString(),
    vaultIndex: policy.vaultIndex,
    vaultPubkey: policy.vaultPubkey,
  };
}

export async function GET(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return NextResponse.json(
      {
        error: {
          code: "unauthenticated",
          message: "No active auth session.",
        },
      },
      { status: 401 }
    );
  }

  const serverEnv = getServerEnv();
  const cluster = resolveConfiguredCluster();
  const earnTarget = getKaminoUsdcEarnTargetForCluster(cluster);
  const settingsPda = new PublicKey(principal.settingsPda);
  const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
  const [earnVaultPda] = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId,
    settingsPda,
  });
  const [canonicalVaultPda] = pda.getSmartAccountPda({
    accountIndex: 0,
    programId,
    settingsPda,
  });
  const [defaultEarnPolicyPda] = pda.getPolicyPda({
    policySeed: EARN_VAULT_INDEX,
    programId,
    settingsPda,
  });
  const [position, policy] = await Promise.all([
    findActiveYieldPosition({
      cluster,
      settings: principal.settingsPda,
      targetReserve: earnTarget.reserve.toBase58(),
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: principal.walletAddress,
    }),
    findActiveYieldRoutePolicy({
      authority: principal.walletAddress,
      cluster,
      settings: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
    }),
  ]);

  return NextResponse.json({
    canonicalVaultPubkey: canonicalVaultPda.toBase58(),
    defaultPolicy: {
      account: defaultEarnPolicyPda.toBase58(),
      seed: EARN_VAULT_INDEX.toString(),
    },
    policy: policy ? serializePolicy(policy) : null,
    position: position ? serializePosition(position) : null,
    settingsPda: principal.settingsPda,
    vault: {
      accountIndex: EARN_VAULT_INDEX,
      pubkey: earnVaultPda.toBase58(),
    },
  });
}
