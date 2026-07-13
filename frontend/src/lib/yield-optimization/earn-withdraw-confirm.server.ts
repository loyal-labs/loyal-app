import "server-only";

import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { pollRpcRead } from "@/lib/yield-optimization/earn-deposit-confirm.server";
import { verifyEarnFullExitZeroBalances } from "@/lib/yield-optimization/earn-full-exit-zero-proof.server";
import { assertSafeUsdcEarnReserveMetadata } from "@/lib/yield-optimization/earn-reserve-target.server";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import {
  findEarnCleanupVaultState,
  findReconciledActiveYieldPositionForVault,
  recordConfirmedYieldWithdrawal,
  type ConfirmedYieldWithdrawalInput,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";
import { reconcileEarnVaultPosition } from "@/lib/yield-optimization/earn-position-reconciliation.server";

// Shared core for confirming an Earn withdrawal, used by BOTH the session
// (`yield-optimization/withdrawals/confirm`) and mobile
// (`mobile/earn/withdraw/confirm`) routes. The canonicalization here is
// security-critical (it re-derives every PDA/reserve from the settings and
// rejects any client-supplied metadata that doesn't match), so it must not
// drift between the two entry points — hence the single shared module.
const EARN_DEPOSIT_VAULT_INDEX = 1;

export type EarnWithdrawConfirmPrincipal = {
  walletAddress: string;
  smartAccountAddress: string;
  settingsPda: string;
};

export class EarnWithdrawConfirmError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EarnWithdrawConfirmError";
    this.status = status;
    this.code = code;
  }
}

const connectionCache = new Map<SolanaEnv, Connection>();

// Every rejection here leaves the read-model stale while the on-chain
// withdrawal already happened — never let one pass silently (the launch-night
// deposit-confirm 400s were invisible for exactly this reason).
function rejectWithdrawConfirm(args: {
  status: number;
  code: string;
  message: string;
  context: Record<string, unknown>;
}): never {
  console.error("[earn-withdraw-confirm] rejected", {
    code: args.code,
    message: args.message,
    status: args.status,
    ...args.context,
  });
  throw new EarnWithdrawConfirmError(args.status, args.code, args.message);
}

type ConfirmedWithdrawalTransactionProof = {
  reserveDebitAmountRaw: bigint;
  vaultIdleDeltaRaw: bigint;
  vaultIdleTokenAccount: string;
  walletTransferAmountRaw: bigint;
};

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

function readTokenBalanceAmountRaw(balance: TokenBalance | undefined): bigint {
  const amount = balance?.uiTokenAmount.amount;
  return typeof amount === "string" && /^\d+$/.test(amount)
    ? BigInt(amount)
    : BigInt(0);
}

function getParsedTransactionAccountKey(
  transaction: ParsedTransactionWithMeta,
  accountIndex: number
): string | null {
  const account = transaction.transaction.message.accountKeys[accountIndex];
  return account ? account.pubkey.toBase58() : null;
}

function getParsedTokenBalanceDeltaRaw(args: {
  fallbackOwner?: string;
  mint: string;
  tokenAccount?: string;
  transaction: ParsedTransactionWithMeta;
}): bigint {
  const preBalances = args.transaction.meta?.preTokenBalances ?? [];
  const postBalances = args.transaction.meta?.postTokenBalances ?? [];
  const indexes = new Set<number>();

  for (const balance of [...preBalances, ...postBalances]) {
    if (balance.mint === args.mint) {
      indexes.add(balance.accountIndex);
    }
  }

  let deltaRaw = BigInt(0);
  for (const accountIndex of indexes) {
    const pre = preBalances.find(
      (balance) =>
        balance.accountIndex === accountIndex && balance.mint === args.mint
    );
    const post = postBalances.find(
      (balance) =>
        balance.accountIndex === accountIndex && balance.mint === args.mint
    );
    const tokenAccount = getParsedTransactionAccountKey(
      args.transaction,
      accountIndex
    );
    const owner = post?.owner ?? pre?.owner ?? null;
    const tokenAccountMatches =
      Boolean(args.tokenAccount) && tokenAccount === args.tokenAccount;
    const ownerMatches =
      !args.tokenAccount &&
      Boolean(args.fallbackOwner) &&
      owner === args.fallbackOwner;

    if (!tokenAccountMatches && !ownerMatches) {
      continue;
    }

    deltaRaw += readTokenBalanceAmountRaw(post) - readTokenBalanceAmountRaw(pre);
  }

  return deltaRaw;
}

async function resolveConfirmedWithdrawalTransactionProof(args: {
  cluster: SolanaEnv;
  input: ConfirmedYieldWithdrawalInput;
}): Promise<ConfirmedWithdrawalTransactionProof> {
  const transaction = await pollRpcRead(async () => {
    const parsed = await getConnection(args.cluster).getParsedTransaction(
      args.input.withdrawalSignature,
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }
    );
    // Parsed transactions propagate later than signature statuses — a null
    // here is usually lag, not a missing transaction.
    return parsed?.meta ? parsed : null;
  });

  if (!transaction || !transaction.meta) {
    throw new Error("Confirmed withdrawal transaction details are unavailable.");
  }
  if (transaction.meta.err) {
    throw new Error("Withdrawal transaction proof has an execution error.");
  }
  if (BigInt(transaction.slot) !== args.input.confirmedSlot) {
    throw new Error(
      "Confirmed withdrawal transaction slot does not match the recorded slot."
    );
  }

  const liquidityMint = new PublicKey(args.input.liquidityMint);
  const walletUsdcAta = getAssociatedTokenAddressSync(
    liquidityMint,
    new PublicKey(args.input.walletAddress),
    false,
    TOKEN_PROGRAM_ID
  ).toBase58();
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    liquidityMint,
    new PublicKey(args.input.vaultPubkey),
    true,
    TOKEN_PROGRAM_ID
  ).toBase58();
  const walletAtaDeltaRaw = getParsedTokenBalanceDeltaRaw({
    mint: args.input.liquidityMint,
    tokenAccount: walletUsdcAta,
    transaction,
  });
  const walletOwnerDeltaRaw =
    walletAtaDeltaRaw > BigInt(0)
      ? walletAtaDeltaRaw
      : getParsedTokenBalanceDeltaRaw({
          fallbackOwner: args.input.walletAddress,
          mint: args.input.liquidityMint,
          transaction,
        });
  const walletTransferAmountRaw =
    walletAtaDeltaRaw > BigInt(0) ? walletAtaDeltaRaw : walletOwnerDeltaRaw;

  if (walletTransferAmountRaw <= BigInt(0)) {
    throw new Error(
      "Confirmed withdrawal transaction does not transfer USDC to the authenticated wallet."
    );
  }

  const vaultUsdcDeltaRaw = getParsedTokenBalanceDeltaRaw({
    mint: args.input.liquidityMint,
    tokenAccount: vaultUsdcAta,
    transaction,
  });
  const vaultIdleDeltaRaw =
    vaultUsdcDeltaRaw > BigInt(0) ? vaultUsdcDeltaRaw : BigInt(0);
  const sourceType = args.input.sourceType ?? "reserve";
  const reserveDebitAmountRaw =
    sourceType === "reserve"
      ? walletTransferAmountRaw + vaultIdleDeltaRaw
      : BigInt(0);

  return {
    reserveDebitAmountRaw,
    vaultIdleDeltaRaw,
    vaultIdleTokenAccount: vaultUsdcAta,
    walletTransferAmountRaw,
  };
}

function applyConfirmedWithdrawalTransactionProof(args: {
  input: ConfirmedYieldWithdrawalInput;
  proof: ConfirmedWithdrawalTransactionProof;
}): ConfirmedYieldWithdrawalInput {
  const sourceType = args.input.sourceType ?? "reserve";

  return {
    ...args.input,
    confirmedVaultIdleDeltaRaw: args.proof.vaultIdleDeltaRaw,
    confirmedVaultIdleTokenAccount: args.proof.vaultIdleTokenAccount,
    confirmedWalletTransferAmountRaw: args.proof.walletTransferAmountRaw,
    withdrawnAmountRaw: args.proof.walletTransferAmountRaw,
    ...(sourceType === "reserve"
      ? {
          confirmedReserveDebitAmountRaw: args.proof.reserveDebitAmountRaw,
          sourceAmountRaw:
            args.input.sourceAmountRaw ?? args.proof.reserveDebitAmountRaw,
        }
      : {}),
  };
}

// Re-derives the canonical withdrawal metadata from the settings PDA and
// asserts every client-supplied field matches. Throws on any mismatch.
export function createCanonicalWithdrawalInput(
  requestInput: ConfirmedYieldWithdrawalInput
): ConfirmedYieldWithdrawalInput {
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
    ...(hasSetupPolicyMetadata
      ? {
          setupPolicyAccount: expectedSetupPolicyAccount.toBase58(),
          setupPolicyId: expectedSetupPolicySeed,
          setupPolicySeed: expectedSetupPolicySeed,
        }
      : {}),
    targetReserve: target.targetReserve,
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
  if (hasSetupPolicyMetadata) {
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
  assertCanonicalField(
    requestInput.targetReserve,
    canonicalInput.targetReserve,
    "targetReserve"
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
  if (requestInput.autodepositClose) {
    throw new Error(
      "Withdrawal confirmation cannot include policy close metadata; close policies only after zero-balance verification."
    );
  }

  return canonicalInput;
}

async function resolveConfirmedSignatureSlot(args: {
  cluster: SolanaEnv;
  operation: "autodeposit close" | "withdrawal";
  signature: string;
}): Promise<bigint> {
  // Same RPC-lag hazard as the deposit confirm: a status read can land on a
  // node that has not seen the transaction yet — poll before rejecting.
  const slot = await pollRpcRead(async () => {
    const { value } = await getConnection(args.cluster).getSignatureStatuses(
      [args.signature],
      { searchTransactionHistory: true }
    );
    const status = value[0];

    if (status?.err) {
      throw new Error(`${args.operation} transaction failed on-chain.`);
    }

    if (
      !status ||
      (status.confirmationStatus !== "confirmed" &&
        status.confirmationStatus !== "finalized") ||
      typeof status.slot !== "number"
    ) {
      return null;
    }

    return BigInt(status.slot);
  });

  if (slot === null) {
    throw new Error(`${args.operation} transaction is not confirmed.`);
  }

  return slot;
}

export function serializeWithdrawPosition(position: UserYieldPositionRecord) {
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
    currentTotalAmountRaw: position.currentAmountRaw.toString(),
    principalAmountRaw: position.principalAmountRaw.toString(),
    status: position.status,
  };
}

export type EarnWithdrawConfirmationStatus =
  | "withdrawal_recorded"
  | "full_exit_incomplete"
  | "policy_close_required";

export type EarnWithdrawConfirmationResult = {
  blockingTokenAccounts: Array<{
    address: string;
    amountRaw: string;
    mint: string;
  }>;
  position: ReturnType<typeof serializeWithdrawPosition>;
  remainingHoldings: Array<{
    amountRaw: string;
    kind: "idle" | "kamino";
    liquidityMint: string;
    market: string | null;
    reserve: string | null;
  }>;
  status: EarnWithdrawConfirmationStatus;
};

function toSafeContextSlot(slot: bigint): number {
  const value = Number(slot);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Confirmed withdrawal slot is outside the safe RPC range.");
  }
  return value;
}

// Validates + records a confirmed Earn withdrawal against the authenticated
// principal. Throws `EarnWithdrawConfirmError` (with an HTTP status) on any
// validation failure; returns the serialized post-withdrawal position.
export async function recordConfirmedEarnWithdrawal(args: {
  principal: EarnWithdrawConfirmPrincipal;
  input: ConfirmedYieldWithdrawalInput;
  solanaEnv: SolanaEnv;
}): Promise<EarnWithdrawConfirmationResult> {
  const { principal, solanaEnv } = args;

  const rejectionContext = {
    settings: args.input.settings,
    walletAddress: args.input.walletAddress,
    withdrawalSignature: args.input.withdrawalSignature,
  };

  if (
    args.input.walletAddress !== principal.walletAddress ||
    args.input.settings !== principal.settingsPda
  ) {
    rejectWithdrawConfirm({
      status: 403,
      code: "principal_mismatch",
      message:
        "Confirmed yield withdrawal does not match the authenticated wallet.",
      context: rejectionContext,
    });
  }

  let input: ConfirmedYieldWithdrawalInput;
  try {
    input = createCanonicalWithdrawalInput(args.input);
  } catch (error) {
    rejectWithdrawConfirm({
      status: 400,
      code: "metadata_mismatch",
      message:
        error instanceof Error
          ? error.message
          : "Confirmed yield withdrawal metadata is invalid.",
      context: rejectionContext,
    });
  }

  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (input.cluster !== configuredCluster) {
    rejectWithdrawConfirm({
      status: 400,
      code: "cluster_mismatch",
      message:
        "Confirmed yield withdrawal cluster does not match the configured Solana environment.",
      context: { ...rejectionContext, cluster: input.cluster },
    });
  }

  let confirmedSlot: bigint;
  try {
    confirmedSlot = await resolveConfirmedSignatureSlot({
      cluster: solanaEnv,
      operation: "withdrawal",
      signature: input.withdrawalSignature,
    });
  } catch (error) {
    rejectWithdrawConfirm({
      status: 400,
      code: "unconfirmed_signature",
      message:
        error instanceof Error
          ? error.message
          : "Withdrawal transaction is not confirmed.",
      context: rejectionContext,
    });
  }

  if (input.confirmedSlot !== confirmedSlot) {
    // The client-supplied slot can be its confirmation context slot (RPC-lag
    // fallback), not the landing slot. The server-resolved status slot is
    // canonical — rejecting on this mismatch strands the withdrawal out of
    // the read-model (balance shows too high).
    console.warn("[earn-withdraw-confirm] corrected client slot", {
      ...rejectionContext,
      clientSlot: input.confirmedSlot.toString(),
      resolvedSlot: confirmedSlot.toString(),
    });
    input = { ...input, confirmedSlot };
  }

  try {
    const proof = await resolveConfirmedWithdrawalTransactionProof({
      cluster: solanaEnv,
      input,
    });
    input = applyConfirmedWithdrawalTransactionProof({ input, proof });
  } catch (error) {
    rejectWithdrawConfirm({
      status: 400,
      code: "invalid_transaction_proof",
      message:
        error instanceof Error
          ? error.message
          : "Confirmed withdrawal transaction proof is invalid.",
      context: rejectionContext,
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
      message.includes("Withdrawal source") ||
      message.includes("Withdrawal target does not match") ||
      message.includes("Withdrawal exceeds")
    ) {
      rejectWithdrawConfirm({
        status: 409,
        code: "withdrawal_conflict",
        message,
        context: {
          settings: input.settings,
          walletAddress: input.walletAddress,
          withdrawalSignature: input.withdrawalSignature,
        },
      });
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
    throw new EarnWithdrawConfirmError(500, "record_failed", message);
  }

  const connection = getConnection(solanaEnv);
  const cluster = normalizeLoyalCluster(input.cluster);

  if (input.mode !== "full") {
    await reconcileEarnVaultPosition({
      authority: input.walletAddress,
      cluster,
      connection,
      force: true,
      settings: input.settings,
      vaultPubkey: input.vaultPubkey,
    }).catch((error) => {
      console.warn("[earn-withdraw-confirm] partial reconcile failed", {
        cluster: input.cluster,
        errorMessage:
          error instanceof Error ? error.message : "Unknown reconcile error.",
        errorName: error instanceof Error ? error.name : typeof error,
        settings: input.settings,
        signature: input.withdrawalSignature,
        vaultIndex: input.vaultIndex,
        walletAddress: input.walletAddress,
      });
    });

    return {
      blockingTokenAccounts: [],
      position: serializeWithdrawPosition(position),
      remainingHoldings: [],
      status: "withdrawal_recorded",
    };
  }

  if (input.isFinalStep === false) {
    return {
      blockingTokenAccounts: [],
      position: serializeWithdrawPosition(position),
      remainingHoldings: [],
      status: "full_exit_incomplete",
    };
  }

  try {
    const minContextSlot = toSafeContextSlot(input.confirmedSlot);
    const cleanupState = await findEarnCleanupVaultState({
      authority: input.walletAddress,
      settings: input.settings,
      vaultIndex: input.vaultIndex,
      vaultPubkey: input.vaultPubkey,
    });
    if (!cleanupState) {
      throw new Error(
        "Active Earn policy state is unavailable for full-exit verification."
      );
    }

    const serverEnv = getServerEnv();
    const proof = await verifyEarnFullExitZeroBalances({
      cluster,
      connection,
      minContextSlot,
      policy: serializeRoutePolicyState(
        cleanupState.routePolicy,
        cleanupState.setupPolicy
      ),
      programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
      settingsPda: new PublicKey(input.settings),
    });
    let reconciledPosition = position;
    if (proof.status === "policy_close_required") {
      await reconcileEarnVaultPosition({
        authority: input.walletAddress,
        cluster,
        connection,
        force: true,
        minContextSlot: toSafeContextSlot(BigInt(proof.observedSlot)),
        purpose: "post_withdrawal_zero_proof",
        settings: input.settings,
        vaultPubkey: input.vaultPubkey,
      });
      reconciledPosition =
        (await findReconciledActiveYieldPositionForVault({
          cluster,
          settings: input.settings,
          vaultIndex: input.vaultIndex,
          walletAddress: input.walletAddress,
        })) ?? position;
    }

    console.info("[earn-withdraw-confirm] full exit verification", {
      blockingTokenAccountCount: proof.blockingTokenAccounts.length,
      cluster: input.cluster,
      idleAmountRaw: proof.idleAmountRaw,
      idleReadsAgree: proof.idleReadsAgree,
      observedSlot: proof.observedSlot,
      remainingHoldingCount: proof.remainingHoldings.length,
      settings: input.settings,
      signature: input.withdrawalSignature,
      status: proof.status,
      vaultIndex: input.vaultIndex,
      walletAddress: input.walletAddress,
    });

    return {
      blockingTokenAccounts: proof.blockingTokenAccounts,
      position: serializeWithdrawPosition(reconciledPosition),
      remainingHoldings: proof.remainingHoldings.map((holding) => ({
        amountRaw: holding.amountRaw,
        kind: holding.kind,
        liquidityMint: holding.liquidityMint,
        market: holding.market,
        reserve: holding.reserve,
      })),
      status: proof.status,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Post-withdraw balance verification failed.";
    console.error("[earn-withdraw-confirm] full exit verification retryable", {
      cluster: input.cluster,
      errorMessage: message,
      errorName: error instanceof Error ? error.name : typeof error,
      minContextSlot: input.confirmedSlot.toString(),
      settings: input.settings,
      signature: input.withdrawalSignature,
      stack: error instanceof Error ? error.stack : undefined,
      status: "full_exit_verification_retryable",
      vaultIndex: input.vaultIndex,
      walletAddress: input.walletAddress,
    });
    throw new EarnWithdrawConfirmError(
      503,
      "full_exit_verification_retryable",
      message
    );
  }
}
