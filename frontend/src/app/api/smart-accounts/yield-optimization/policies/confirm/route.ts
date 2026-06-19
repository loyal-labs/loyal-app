import { NextResponse } from "next/server";
import {
  getKaminoUsdcEarnTargetForCluster,
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { parseEarnPolicyConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  findCurrentEarnDepositOnboardingAttempt,
  recordConfirmedEarnDepositOnboardingPolicyStage,
  type ConfirmedYieldRoutePolicyInput,
  type RoutePolicyRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_POLICY_VAULT_INDEX = 1;

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
      `${label} does not match the canonical earn policy metadata.`
    );
  }
}

function toSafePolicySeed(policySeed: bigint): number {
  if (policySeed <= BigInt(0) || policySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("policySeed is outside the supported earn policy range.");
  }

  return Number(policySeed);
}

function createCanonicalPolicyInput(
  requestInput: ConfirmedYieldRoutePolicyInput,
  stage: "route_policy" | "setup_policy"
): ConfirmedYieldRoutePolicyInput {
  const cluster = normalizeLoyalCluster(requestInput.cluster);
  const normalizedRequestInput = { ...requestInput, cluster };
  const settings = new PublicKey(requestInput.settings);
  const expectedSetupPolicySeed = requestInput.policySeed + BigInt(1);
  const expectedPolicyAccount = pda.getPolicyPda({
    settingsPda: settings,
    policySeed: toSafePolicySeed(requestInput.policySeed),
  })[0];
  const expectedSetupPolicyAccount = pda.getPolicyPda({
    settingsPda: settings,
    policySeed: toSafePolicySeed(expectedSetupPolicySeed),
  })[0];
  const expectedVault = pda.getSmartAccountPda({
    settingsPda: settings,
    accountIndex: EARN_POLICY_VAULT_INDEX,
  })[0];
  const earnTarget = getKaminoUsdcEarnTargetForCluster(cluster);
  const canonicalInput = {
    ...normalizedRequestInput,
    cluster,
    liquidityMint: earnTarget.liquidityMint.toBase58(),
    market: earnTarget.market.toBase58(),
    policyAccount: expectedPolicyAccount.toBase58(),
    policyId: requestInput.policySeed,
    policySeed: requestInput.policySeed,
    setupPolicyAccount: expectedSetupPolicyAccount.toBase58(),
    setupPolicyId: expectedSetupPolicySeed,
    setupPolicySeed: expectedSetupPolicySeed,
    targetReserve: earnTarget.reserve.toBase58(),
    vaultIndex: EARN_POLICY_VAULT_INDEX,
    vaultPubkey: expectedVault.toBase58(),
  };

  assertCanonicalField(
    normalizedRequestInput.cluster,
    canonicalInput.cluster,
    "cluster"
  );
  assertCanonicalField(
    requestInput.liquidityMint,
    canonicalInput.liquidityMint,
    "liquidityMint"
  );
  assertCanonicalField(requestInput.market, canonicalInput.market, "market");
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
    requestInput.policySeed,
    canonicalInput.policySeed,
    "policySeed"
  );
  if (stage === "setup_policy") {
    if (!requestInput.setupPolicySignature) {
      throw new Error("setupPolicySignature is required for policy setup.");
    }
    if (
      requestInput.setupPolicyConfirmedSlot === null ||
      requestInput.setupPolicyConfirmedSlot === undefined
    ) {
      throw new Error("setupPolicyConfirmedSlot is required for policy setup.");
    }
    assertCanonicalField(
      requestInput.setupPolicyAccount ?? null,
      canonicalInput.setupPolicyAccount,
      "setupPolicyAccount"
    );
    assertCanonicalField(
      requestInput.setupPolicyId ?? null,
      canonicalInput.setupPolicyId,
      "setupPolicyId"
    );
    assertCanonicalField(
      requestInput.setupPolicySeed ?? null,
      canonicalInput.setupPolicySeed,
      "setupPolicySeed"
    );
  }
  assertCanonicalField(
    requestInput.targetReserve,
    canonicalInput.targetReserve,
    "targetReserve"
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

  return canonicalInput;
}

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getServerSolanaEndpoints(cluster);
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
  operation: "route policy setup" | "setup policy setup";
  signature: string;
}): Promise<bigint> {
  const { value } = await getConnection(args.cluster).getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0];

  if (!status || status.err) {
    throw new Error(`${args.operation} transaction is not confirmed.`);
  }

  if (
    status.confirmationStatus !== "confirmed" &&
    status.confirmationStatus !== "finalized"
  ) {
    throw new Error(`${args.operation} transaction is not confirmed.`);
  }

  if (typeof status.slot !== "number") {
    throw new Error("Confirmed transaction slot is unavailable.");
  }

  return BigInt(status.slot);
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

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ConfirmedYieldRoutePolicyInput & {
    stage: "route_policy" | "setup_policy";
  };
  try {
    input = parseEarnPolicyConfirmRequestBody(await request.json());
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
      "Confirmed yield policy does not match the authenticated wallet session."
    );
  }

  try {
    if (input.stage === "setup_policy") {
      const attempt = await findCurrentEarnDepositOnboardingAttempt({
        settings: input.settings,
        vaultIndex: input.vaultIndex,
        vaultPubkey: input.vaultPubkey,
        walletAddress: input.walletAddress,
      });
      if (!attempt?.routePolicySignature || !attempt.routePolicyConfirmedSlot) {
        return jsonError(
          409,
          "missing_route_policy_stage",
          "Confirm the Earn route policy before confirming the setup policy."
        );
      }
      input = {
        ...input,
        policyConfirmedSlot: attempt.routePolicyConfirmedSlot,
        policySignature: attempt.routePolicySignature,
      };
    }

    input = {
      ...createCanonicalPolicyInput(input, input.stage),
      stage: input.stage,
    };
  } catch (error) {
    return jsonError(
      400,
      "metadata_mismatch",
      error instanceof Error
        ? error.message
        : "Confirmed yield policy metadata is invalid."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (input.cluster !== configuredCluster) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Confirmed yield policy cluster does not match the configured Solana environment."
    );
  }

  const signatureToVerify =
    input.stage === "setup_policy"
      ? input.setupPolicySignature ?? ""
      : input.policySignature;
  const expectedSlot =
    input.stage === "setup_policy"
      ? input.setupPolicyConfirmedSlot
      : input.confirmedSlot;
  let confirmedSlot: bigint;
  try {
    confirmedSlot = await resolveConfirmedSignatureSlot({
      cluster: solanaEnv,
      operation:
        input.stage === "setup_policy"
          ? "setup policy setup"
          : "route policy setup",
      signature: signatureToVerify,
    });
  } catch (error) {
    return jsonError(
      400,
      input.stage === "setup_policy"
        ? "unconfirmed_setup_policy_signature"
        : "unconfirmed_signature",
      error instanceof Error
        ? error.message
        : "Policy setup transaction is not confirmed."
    );
  }

  if (expectedSlot !== confirmedSlot) {
    return jsonError(
      400,
      input.stage === "setup_policy"
        ? "setup_policy_slot_mismatch"
        : "slot_mismatch",
      input.stage === "setup_policy"
        ? "Confirmed setup policy slot does not match the transaction status."
        : "Confirmed yield policy slot does not match the transaction status."
    );
  }

  const policy = await recordConfirmedEarnDepositOnboardingPolicyStage(
    input,
    input.stage
  );

  return NextResponse.json({
    policy: serializePolicy(policy),
  });
}
