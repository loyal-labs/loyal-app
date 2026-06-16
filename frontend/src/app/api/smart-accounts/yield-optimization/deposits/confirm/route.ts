import { NextResponse } from "next/server";
import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { parseEarnDepositConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import { assertSafeUsdcEarnReserveMetadata } from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  recordConfirmedYieldDeposit,
  type ConfirmedYieldDepositInput,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_DEPOSIT_VAULT_INDEX = 1;

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
      `${label} does not match the canonical earn deposit metadata.`
    );
  }
}

function toSafePolicySeed(policySeed: bigint): number {
  if (policySeed <= BigInt(0) || policySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("policySeed is outside the supported earn policy range.");
  }

  return Number(policySeed);
}

function createCanonicalDepositInput(
  requestInput: ConfirmedYieldDepositInput
): ConfirmedYieldDepositInput {
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
    accountIndex: EARN_DEPOSIT_VAULT_INDEX,
  })[0];
  const hasSetupPolicyMetadata =
    (requestInput.setupPolicyId !== undefined &&
      requestInput.setupPolicyId !== null) ||
    (requestInput.setupPolicyAccount !== undefined &&
      requestInput.setupPolicyAccount !== null) ||
    (requestInput.setupPolicySeed !== undefined &&
      requestInput.setupPolicySeed !== null);
  const requiresSetupPolicyMetadata =
    requestInput.policyInitialization === "create" || hasSetupPolicyMetadata;
  const target = assertSafeUsdcEarnReserveMetadata({
    cluster,
    liquidityMint: requestInput.liquidityMint,
    market: requestInput.market,
    targetReserve: requestInput.targetReserve,
  });
  if (
    requestInput.targetSupplyApyBps !== null &&
    requestInput.targetSupplyApyBps < BigInt(0)
  ) {
    throw new Error("Earn target APY evidence cannot be negative.");
  }
  const canonicalInput = {
    ...normalizedRequestInput,
    cluster,
    depositMint: target.liquidityMint,
    liquidityMint: target.liquidityMint,
    market: target.market,
    policyAccount: expectedPolicyAccount.toBase58(),
    policyId: requestInput.policySeed,
    policySeed: requestInput.policySeed,
    ...(requiresSetupPolicyMetadata
      ? {
          setupPolicyAccount: expectedSetupPolicyAccount.toBase58(),
          setupPolicyId: expectedSetupPolicySeed,
          setupPolicySeed: expectedSetupPolicySeed,
        }
      : {}),
    targetReserve: target.targetReserve,
    targetSupplyApyBps: requestInput.targetSupplyApyBps,
    vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
    vaultPubkey: expectedVault.toBase58(),
  };

  assertCanonicalField(
    normalizedRequestInput.cluster,
    canonicalInput.cluster,
    "cluster"
  );
  assertCanonicalField(
    requestInput.depositMint,
    canonicalInput.depositMint,
    "depositMint"
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
  if (requestInput.policyInitialization === "create") {
    if (
      requestInput.policyConfirmedSlot === null ||
      requestInput.policyConfirmedSlot === undefined
    ) {
      throw new Error("policyConfirmedSlot is required for policy creation.");
    }
    if (!requestInput.setupPolicySignature) {
      throw new Error("setupPolicySignature is required for policy creation.");
    }
    if (
      requestInput.setupPolicyConfirmedSlot === null ||
      requestInput.setupPolicyConfirmedSlot === undefined
    ) {
      throw new Error(
        "setupPolicyConfirmedSlot is required for policy creation."
      );
    }
  }
  if (requiresSetupPolicyMetadata) {
    assertCanonicalField(
      requestInput.setupPolicyAccount ?? null,
      canonicalInput.setupPolicyAccount ?? null,
      "setupPolicyAccount"
    );
    assertCanonicalField(
      requestInput.setupPolicyId ?? null,
      canonicalInput.setupPolicyId ?? null,
      "setupPolicyId"
    );
    assertCanonicalField(
      requestInput.setupPolicySeed ?? null,
      canonicalInput.setupPolicySeed ?? null,
      "setupPolicySeed"
    );
  }
  const hasSetupPolicyConfirmation =
    (requestInput.setupPolicySignature !== undefined &&
      requestInput.setupPolicySignature !== null) ||
    (requestInput.setupPolicyConfirmedSlot !== undefined &&
      requestInput.setupPolicyConfirmedSlot !== null);
  if (
    hasSetupPolicyConfirmation &&
    (!requestInput.setupPolicySignature ||
      requestInput.setupPolicyConfirmedSlot === null ||
      requestInput.setupPolicyConfirmedSlot === undefined)
  ) {
    throw new Error("Setup policy confirmation metadata is incomplete.");
  }
  assertCanonicalField(
    requestInput.targetReserve,
    canonicalInput.targetReserve,
    "targetReserve"
  );
  assertCanonicalField(
    requestInput.targetSupplyApyBps,
    canonicalInput.targetSupplyApyBps,
    "targetSupplyApyBps"
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
  operation: "deposit" | "route policy setup" | "setup policy setup";
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

function serializePosition(position: UserYieldPositionRecord) {
  return {
    currentHolding: {
      amountRaw: position.currentAmountRaw.toString(),
      liquidityMint: position.currentLiquidityMint,
      market: position.currentMarket,
      observedAt: position.currentObservedAt.toISOString(),
      observedSlot: position.currentObservedSlot.toString(),
      provenance: {
        lastHoldingEventId: position.lastHoldingEventId?.toString() ?? null,
        lastRebalanceDecisionId:
          position.lastRebalanceDecisionId?.toString() ?? null,
      },
      reserve: position.currentReserve,
    },
    id: position.id.toString(),
    initialHolding: {
      liquidityMint: position.initialLiquidityMint,
      market: position.initialMarket,
      reserve: position.initialReserve,
      supplyApyBps: position.initialSupplyApyBps?.toString() ?? null,
    },
    principalAmountRaw: position.principalAmountRaw.toString(),
    status: position.status,
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

  if (
    input.walletAddress !== principal.walletAddress ||
    input.smartAccountAddress !== principal.smartAccountAddress ||
    input.settings !== principal.settingsPda
  ) {
    return jsonError(
      403,
      "principal_mismatch",
      "Confirmed yield deposit does not match the authenticated wallet session."
    );
  }

  try {
    input = createCanonicalDepositInput(input);
  } catch (error) {
    return jsonError(
      400,
      "metadata_mismatch",
      error instanceof Error
        ? error.message
        : "Confirmed yield deposit metadata is invalid."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (input.cluster !== configuredCluster) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Confirmed yield deposit cluster does not match the configured Solana environment."
    );
  }

  let confirmedSlot: bigint;
  try {
    confirmedSlot = await resolveConfirmedSignatureSlot({
      cluster: solanaEnv,
      operation: "deposit",
      signature: input.depositSignature,
    });
  } catch (error) {
    return jsonError(
      400,
      "unconfirmed_signature",
      error instanceof Error
        ? error.message
        : "Deposit transaction is not confirmed."
    );
  }

  if (input.confirmedSlot !== confirmedSlot) {
    return jsonError(
      400,
      "slot_mismatch",
      "Confirmed yield deposit slot does not match the transaction status."
    );
  }

  if (input.policyInitialization === "create") {
    let policyConfirmedSlot: bigint;
    try {
      policyConfirmedSlot = await resolveConfirmedSignatureSlot({
        cluster: solanaEnv,
        operation: "route policy setup",
        signature: input.policySignature,
      });
    } catch (error) {
      return jsonError(
        400,
        "unconfirmed_policy_signature",
        error instanceof Error
          ? error.message
          : "Route policy setup transaction is not confirmed."
      );
    }

    if (input.policyConfirmedSlot !== policyConfirmedSlot) {
      return jsonError(
        400,
        "policy_slot_mismatch",
        "Confirmed route policy setup slot does not match the transaction status."
      );
    }

    let setupPolicyConfirmedSlot: bigint;
    try {
      setupPolicyConfirmedSlot = await resolveConfirmedSignatureSlot({
        cluster: solanaEnv,
        operation: "setup policy setup",
        signature: input.setupPolicySignature ?? "",
      });
    } catch (error) {
      return jsonError(
        400,
        "unconfirmed_setup_policy_signature",
        error instanceof Error
          ? error.message
          : "Setup policy transaction is not confirmed."
      );
    }

    if (input.setupPolicyConfirmedSlot !== setupPolicyConfirmedSlot) {
      return jsonError(
        400,
        "setup_policy_slot_mismatch",
        "Confirmed setup policy slot does not match the transaction status."
      );
    }
  }

  let position: UserYieldPositionRecord;
  try {
    position = await recordConfirmedYieldDeposit(input);
  } catch (error) {
    console.error("[earn-deposit-confirm] record failed", {
      amountRaw: input.principalAmountRaw.toString(),
      cluster: input.cluster,
      depositSignature: input.depositSignature,
      errorMessage:
        error instanceof Error ? error.message : "Unknown record error.",
      errorName: error instanceof Error ? error.name : typeof error,
      policyAccount: input.policyAccount,
      policyInitialization: input.policyInitialization,
      policySeed: input.policySeed.toString(),
      settings: input.settings,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress: input.walletAddress,
    });
    return jsonError(
      409,
      "record_failed",
      error instanceof Error
        ? error.message
        : "Failed to record confirmed earn deposit."
    );
  }

  return NextResponse.json({
    position: serializePosition(position),
  });
}
