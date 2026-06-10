import { NextResponse } from "next/server";
import {
  deriveRecurringDelegation,
  deriveSubscriptionAuthority,
  getKaminoUsdcEarnTargetForCluster,
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  parseEarnAutodepositSetupConfirmRequestBody,
  type EarnAutodepositSetupConfirmResponse,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  recordConfirmedAutodepositDelegation,
  recordPendingAutodepositSetup,
  type BalanceSweepTargetRecord,
  type ConfirmedEarnAutodepositSetupInput,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

const EARN_DEPOSIT_VAULT_INDEX = 1 as const;
const MONTH_PERIOD_SECONDS = BigInt(30 * 24 * 60 * 60);

const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
}

function assertCanonicalField(
  actual: string | bigint | number | null,
  expected: string | bigint | number | null,
  label: string
) {
  if (actual !== expected) {
    throw new Error(
      `${label} does not match canonical Earn autodeposit metadata.`
    );
  }
}

function toSafePolicySeed(policySeed: bigint): number {
  if (policySeed <= BigInt(0) || policySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("policySeed is outside the supported autodeposit range.");
  }

  return Number(policySeed);
}

function createCanonicalAutodepositSetupInput(
  requestInput: ConfirmedEarnAutodepositSetupInput
): ConfirmedEarnAutodepositSetupInput {
  const cluster = normalizeLoyalCluster(requestInput.cluster);
  const normalizedRequestInput = { ...requestInput, cluster };
  const settings = new PublicKey(requestInput.settings);
  const wallet = new PublicKey(requestInput.walletAddress);
  const expectedPolicyAccount = pda.getPolicyPda({
    settingsPda: settings,
    policySeed: toSafePolicySeed(requestInput.policySeed),
  })[0];
  const expectedVault = pda.getSmartAccountPda({
    settingsPda: settings,
    accountIndex: EARN_DEPOSIT_VAULT_INDEX,
  })[0];
  const earnTarget = getKaminoUsdcEarnTargetForCluster(cluster);
  const usdcMint = earnTarget.liquidityMint;
  const expectedSubscriptionAuthority = deriveSubscriptionAuthority(
    wallet,
    usdcMint
  );
  const expectedRecurringDelegation = deriveRecurringDelegation(
    expectedSubscriptionAuthority,
    wallet,
    expectedVault,
    requestInput.nonce
  );
  const expectedWalletUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    wallet,
    false,
    TOKEN_PROGRAM_ID
  );
  const expectedVaultUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    expectedVault,
    true,
    TOKEN_PROGRAM_ID
  );
  const expectedPolicySigner = getDeploymentPolicySignerPublicKey().toBase58();
  const canonicalInput = {
    ...normalizedRequestInput,
    delegatedSigner: expectedPolicySigner,
    liquidityMint: usdcMint.toBase58(),
    policyAccount: expectedPolicyAccount.toBase58(),
    policyId: requestInput.policySeed,
    policySeed: requestInput.policySeed,
    recurringDelegation: expectedRecurringDelegation.toBase58(),
    subscriptionAuthority: expectedSubscriptionAuthority.toBase58(),
    subscriptionDelegatee: expectedVault.toBase58(),
    vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
    vaultPubkey: expectedVault.toBase58(),
    vaultUsdcAta: expectedVaultUsdcAta.toBase58(),
    walletUsdcAta: expectedWalletUsdcAta.toBase58(),
  };

  assertCanonicalField(
    normalizedRequestInput.cluster,
    canonicalInput.cluster,
    "cluster"
  );
  assertCanonicalField(
    requestInput.delegatedSigner,
    canonicalInput.delegatedSigner,
    "delegatedSigner"
  );
  assertCanonicalField(
    requestInput.liquidityMint,
    canonicalInput.liquidityMint,
    "liquidityMint"
  );
  assertCanonicalField(
    requestInput.periodLengthSeconds,
    MONTH_PERIOD_SECONDS,
    "periodLengthSeconds"
  );
  assertCanonicalField(
    requestInput.policyAccount,
    canonicalInput.policyAccount,
    "policyAccount"
  );
  assertCanonicalField(
    requestInput.policyId,
    requestInput.policySeed,
    "policyId"
  );
  assertCanonicalField(
    requestInput.policyId,
    canonicalInput.policyId,
    "policyId"
  );
  assertCanonicalField(
    requestInput.recurringDelegation,
    canonicalInput.recurringDelegation,
    "recurringDelegation"
  );
  assertCanonicalField(
    requestInput.subscriptionAuthority,
    canonicalInput.subscriptionAuthority,
    "subscriptionAuthority"
  );
  assertCanonicalField(
    requestInput.subscriptionDelegatee,
    canonicalInput.subscriptionDelegatee,
    "subscriptionDelegatee"
  );
  assertCanonicalField(
    requestInput.vaultIndex,
    canonicalInput.vaultIndex,
    "vaultIndex"
  );
  assertCanonicalField(
    requestInput.vaultPubkey,
    canonicalInput.vaultPubkey,
    "vaultPubkey"
  );
  assertCanonicalField(
    requestInput.vaultUsdcAta,
    canonicalInput.vaultUsdcAta,
    "vaultUsdcAta"
  );
  assertCanonicalField(
    requestInput.walletUsdcAta,
    canonicalInput.walletUsdcAta,
    "walletUsdcAta"
  );

  if (requestInput.amountPerPeriodRaw <= BigInt(0)) {
    throw new Error("amountPerPeriodRaw must be greater than 0.");
  }
  if (requestInput.walletBalanceFloorRaw < BigInt(0)) {
    throw new Error("walletBalanceFloorRaw cannot be negative.");
  }

  return canonicalInput;
}

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getFrontendSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

async function resolveConfirmedSignatureSlot(args: {
  cluster: SolanaEnv;
  signature: string;
}): Promise<bigint> {
  const { value } = await getConnection(args.cluster).getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0];

  if (!status || status.err) {
    throw new Error("Autodeposit setup transaction is not confirmed.");
  }

  if (
    status.confirmationStatus !== "confirmed" &&
    status.confirmationStatus !== "finalized"
  ) {
    throw new Error("Autodeposit setup transaction is not confirmed.");
  }

  if (typeof status.slot !== "number") {
    throw new Error("Confirmed transaction slot is unavailable.");
  }

  return BigInt(status.slot);
}

function serializeTarget(
  target: BalanceSweepTargetRecord
): EarnAutodepositSetupConfirmResponse["target"] {
  return {
    active: target.active,
    balanceSweepPolicyId: target.balanceSweepPolicyId?.toString() ?? null,
    id: target.id.toString(),
    lifecycleStatus: target.lifecycleStatus,
    policyAccount: target.policyAccount,
    recurringDelegation: target.recurringDelegation,
    walletBalanceFloorRaw: target.walletBalanceFloorRaw?.toString() ?? null,
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ConfirmedEarnAutodepositSetupInput;
  try {
    input = parseEarnAutodepositSetupConfirmRequestBody(await request.json());
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
      "Confirmed autodeposit setup does not match the authenticated wallet session."
    );
  }

  try {
    input = createCanonicalAutodepositSetupInput(input);
  } catch (error) {
    return jsonError(
      400,
      "metadata_mismatch",
      error instanceof Error
        ? error.message
        : "Confirmed autodeposit setup metadata is invalid."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (input.cluster !== configuredCluster) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Confirmed autodeposit setup cluster does not match the configured Solana environment."
    );
  }

  let confirmedSlot: bigint;
  try {
    confirmedSlot = await resolveConfirmedSignatureSlot({
      cluster: solanaEnv,
      signature: input.setupSignature,
    });
  } catch (error) {
    return jsonError(
      400,
      "unconfirmed_signature",
      error instanceof Error
        ? error.message
        : "Autodeposit setup transaction is not confirmed."
    );
  }

  if (input.confirmedSlot !== confirmedSlot) {
    return jsonError(
      400,
      "slot_mismatch",
      "Confirmed autodeposit setup slot does not match the transaction status."
    );
  }

  const target =
    input.setupStage === "create_recurring_delegation"
      ? await recordConfirmedAutodepositDelegation(input)
      : await recordPendingAutodepositSetup(input);

  return NextResponse.json({ target: serializeTarget(target) });
}
