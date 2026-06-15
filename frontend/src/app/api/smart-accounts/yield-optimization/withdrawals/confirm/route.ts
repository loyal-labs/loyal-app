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
import { parseEarnWithdrawalConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import { recordClosedAutodepositTarget } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import { assertSafeUsdcEarnReserveMetadata } from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  recordConfirmedYieldWithdrawal,
  type ConfirmedYieldWithdrawalInput,
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
      `${label} does not match the canonical earn withdrawal metadata.`
    );
  }
}

function toSafePolicySeed(policySeed: bigint): number {
  if (policySeed <= BigInt(0) || policySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("policySeed is outside the supported earn policy range.");
  }

  return Number(policySeed);
}

function createCanonicalWithdrawalInput(
  requestInput: ConfirmedYieldWithdrawalInput
): ConfirmedYieldWithdrawalInput {
  const cluster = normalizeLoyalCluster(requestInput.cluster);
  const normalizedRequestInput = { ...requestInput, cluster };
  const settings = new PublicKey(requestInput.settings);
  const expectedPolicyAccount = pda.getPolicyPda({
    settingsPda: settings,
    policySeed: toSafePolicySeed(requestInput.policySeed),
  })[0];
  const expectedVault = pda.getSmartAccountPda({
    settingsPda: settings,
    accountIndex: EARN_DEPOSIT_VAULT_INDEX,
  })[0];
  const target = assertSafeUsdcEarnReserveMetadata({
    cluster,
    liquidityMint: requestInput.liquidityMint,
    market: requestInput.market,
    targetReserve: requestInput.targetReserve,
  });
  const canonicalInput = {
    ...normalizedRequestInput,
    cluster,
    liquidityMint: target.liquidityMint,
    market: target.market,
    policyAccount: expectedPolicyAccount.toBase58(),
    policyId: requestInput.policySeed,
    policySeed: requestInput.policySeed,
    targetReserve: target.targetReserve,
    vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
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
  if (requestInput.mode !== "full" && requestInput.autodepositClose) {
    throw new Error(
      "autodepositClose can only be confirmed with full withdrawals."
    );
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
  operation: "autodeposit close" | "withdrawal";
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
    throw new Error(
      `Confirmed ${args.operation} transaction slot is unavailable.`
    );
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

  let input: ConfirmedYieldWithdrawalInput;
  try {
    input = parseEarnWithdrawalConfirmRequestBody(await request.json());
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
      "Confirmed yield withdrawal does not match the authenticated wallet session."
    );
  }

  try {
    input = createCanonicalWithdrawalInput(input);
  } catch (error) {
    return jsonError(
      400,
      "metadata_mismatch",
      error instanceof Error
        ? error.message
        : "Confirmed yield withdrawal metadata is invalid."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (input.cluster !== configuredCluster) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Confirmed yield withdrawal cluster does not match the configured Solana environment."
    );
  }

  let confirmedSlot: bigint;
  try {
    confirmedSlot = await resolveConfirmedSignatureSlot({
      cluster: solanaEnv,
      operation: "withdrawal",
      signature: input.withdrawalSignature,
    });
  } catch (error) {
    return jsonError(
      400,
      "unconfirmed_signature",
      error instanceof Error
        ? error.message
        : "Withdrawal transaction is not confirmed."
    );
  }

  if (input.confirmedSlot !== confirmedSlot) {
    return jsonError(
      400,
      "slot_mismatch",
      "Confirmed yield withdrawal slot does not match the transaction status."
    );
  }

  if (input.mode === "full" && input.autodepositClose) {
    let autodepositCloseConfirmedSlot: bigint;
    try {
      autodepositCloseConfirmedSlot = await resolveConfirmedSignatureSlot({
        cluster: solanaEnv,
        operation: "autodeposit close",
        signature: input.autodepositClose.closeSignature,
      });
    } catch (error) {
      return jsonError(
        400,
        "unconfirmed_autodeposit_close_signature",
        error instanceof Error
          ? error.message
          : "Autodeposit close transaction is not confirmed."
      );
    }

    if (
      input.autodepositClose.confirmedSlot !== autodepositCloseConfirmedSlot
    ) {
      return jsonError(
        400,
        "autodeposit_close_slot_mismatch",
        "Confirmed autodeposit close slot does not match the transaction status."
      );
    }

    await recordClosedAutodepositTarget({
      cluster: input.cluster,
      closeSignature: input.autodepositClose.closeSignature,
      confirmedSlot: input.autodepositClose.confirmedSlot,
      delegatedSigner: input.autodepositClose.delegatedSigner,
      policyAccount: input.autodepositClose.policyAccount,
      recurringDelegation: input.autodepositClose.recurringDelegation,
      settings: input.settings,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: input.vaultPubkey,
      walletAddress: input.walletAddress,
    });
  }

  let position: UserYieldPositionRecord;
  try {
    position = await recordConfirmedYieldWithdrawal(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Confirmed yield withdrawal could not be recorded.";
    if (
      message.startsWith("Duplicate withdrawal ") ||
      message.includes("Withdrawal target does not match") ||
      message.includes("Withdrawal exceeds")
    ) {
      return jsonError(409, "withdrawal_conflict", message);
    }

    console.error("[earn-withdraw-confirm] record failed", {
      cluster: input.cluster,
      errorMessage: message,
      errorName: error instanceof Error ? error.name : typeof error,
      settings: input.settings,
      signature: input.withdrawalSignature,
      stack: error instanceof Error ? error.stack : undefined,
      vaultIndex: input.vaultIndex,
      walletAddress: input.walletAddress,
    });
    return jsonError(500, "record_failed", message);
  }

  return NextResponse.json({
    position: serializePosition(position),
  });
}
