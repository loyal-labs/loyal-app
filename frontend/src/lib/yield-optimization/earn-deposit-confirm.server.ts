import "server-only";

import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { assertSafeUsdcEarnReserveMetadata } from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  markEarnDepositOnboardingAccountingFailed,
  markEarnDepositOnboardingComplete,
  recordEarnDepositOnboardingDepositSignature,
  recordConfirmedYieldDeposit,
  type ConfirmedYieldDepositInput,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Shared core of the Earn deposit "confirm" step. Both the session-authed web
// route (`yield-optimization/deposits/confirm`) and the wallet-signed mobile
// route (`mobile/earn/deposit/confirm`) call `recordConfirmedEarnDeposit` so the
// security-critical canonicalization + on-chain slot verification can never
// drift between surfaces. The caller supplies the authenticated principal (from
// a session or a verified wallet signature); this module owns everything after.
const EARN_DEPOSIT_VAULT_INDEX = 1;

const connectionCache = new Map<SolanaEnv, Connection>();

// Carries an HTTP status + stable error code so each route can map failures to
// the same response it returned before this logic was extracted.
export class EarnDepositConfirmError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(args: { status: number; code: string; message: string }) {
    super(args.message);
    this.name = "EarnDepositConfirmError";
    this.status = args.status;
    this.code = args.code;
  }
}

export type EarnDepositConfirmPrincipal = {
  walletAddress: string;
  smartAccountAddress: string;
  settingsPda: string;
};

export type SerializedYieldPosition = ReturnType<typeof serializePosition>;

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
    smartAccountAddress: expectedVault.toBase58(),
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
    requestInput.smartAccountAddress,
    canonicalInput.smartAccountAddress,
    "smartAccountAddress"
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

// Validates a confirmed Earn deposit against the authenticated principal and
// the on-chain transaction status, then records the position. Throws
// `EarnDepositConfirmError` (status + code) on any rejection.
export async function recordConfirmedEarnDeposit(args: {
  principal: EarnDepositConfirmPrincipal;
  input: ConfirmedYieldDepositInput;
}): Promise<SerializedYieldPosition> {
  let input = args.input;
  const { principal } = args;

  if (
    input.walletAddress !== principal.walletAddress ||
    input.settings !== principal.settingsPda
  ) {
    throw new EarnDepositConfirmError({
      status: 403,
      code: "principal_mismatch",
      message:
        "Confirmed yield deposit does not match the authenticated wallet session.",
    });
  }

  try {
    input = createCanonicalDepositInput(input);
  } catch (error) {
    throw new EarnDepositConfirmError({
      status: 400,
      code: "metadata_mismatch",
      message:
        error instanceof Error
          ? error.message
          : "Confirmed yield deposit metadata is invalid.",
    });
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (input.cluster !== configuredCluster) {
    throw new EarnDepositConfirmError({
      status: 400,
      code: "cluster_mismatch",
      message:
        "Confirmed yield deposit cluster does not match the configured Solana environment.",
    });
  }

  let confirmedSlot: bigint;
  try {
    confirmedSlot = await resolveConfirmedSignatureSlot({
      cluster: solanaEnv,
      operation: "deposit",
      signature: input.depositSignature,
    });
  } catch (error) {
    throw new EarnDepositConfirmError({
      status: 400,
      code: "unconfirmed_signature",
      message:
        error instanceof Error
          ? error.message
          : "Deposit transaction is not confirmed.",
    });
  }

  if (input.confirmedSlot !== confirmedSlot) {
    throw new EarnDepositConfirmError({
      status: 400,
      code: "slot_mismatch",
      message:
        "Confirmed yield deposit slot does not match the transaction status.",
    });
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
      throw new EarnDepositConfirmError({
        status: 400,
        code: "unconfirmed_policy_signature",
        message:
          error instanceof Error
            ? error.message
            : "Route policy setup transaction is not confirmed.",
      });
    }

    if (input.policyConfirmedSlot !== policyConfirmedSlot) {
      throw new EarnDepositConfirmError({
        status: 400,
        code: "policy_slot_mismatch",
        message:
          "Confirmed route policy setup slot does not match the transaction status.",
      });
    }

    let setupPolicyConfirmedSlot: bigint;
    try {
      setupPolicyConfirmedSlot = await resolveConfirmedSignatureSlot({
        cluster: solanaEnv,
        operation: "setup policy setup",
        signature: input.setupPolicySignature ?? "",
      });
    } catch (error) {
      throw new EarnDepositConfirmError({
        status: 400,
        code: "unconfirmed_setup_policy_signature",
        message:
          error instanceof Error
            ? error.message
            : "Setup policy transaction is not confirmed.",
      });
    }

    if (input.setupPolicyConfirmedSlot !== setupPolicyConfirmedSlot) {
      throw new EarnDepositConfirmError({
        status: 400,
        code: "setup_policy_slot_mismatch",
        message:
          "Confirmed setup policy slot does not match the transaction status.",
      });
    }
  }

  try {
    await recordEarnDepositOnboardingDepositSignature(input);
  } catch (error) {
    console.warn("[earn-deposit-confirm] failed to record onboarding deposit", {
      depositSignature: input.depositSignature,
      errorMessage:
        error instanceof Error ? error.message : "Unknown record error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: input.settings,
      walletAddress: input.walletAddress,
    });
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
    await markEarnDepositOnboardingAccountingFailed(
      input,
      "record_failed"
    ).catch((markError) => {
      console.warn("[earn-deposit-confirm] failed to mark accounting failure", {
        depositSignature: input.depositSignature,
        errorMessage:
          markError instanceof Error
            ? markError.message
            : "Unknown mark error.",
        errorName:
          markError instanceof Error ? markError.name : typeof markError,
        settings: input.settings,
        walletAddress: input.walletAddress,
      });
    });
    throw new EarnDepositConfirmError({
      status: 409,
      code: "record_failed",
      message:
        error instanceof Error
          ? error.message
          : "Failed to record confirmed earn deposit.",
    });
  }

  await markEarnDepositOnboardingComplete(input).catch((error) => {
    console.warn("[earn-deposit-confirm] failed to mark onboarding complete", {
      depositSignature: input.depositSignature,
      errorMessage:
        error instanceof Error ? error.message : "Unknown mark error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: input.settings,
      walletAddress: input.walletAddress,
    });
  });

  return serializePosition(position);
}
