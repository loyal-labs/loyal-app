import "server-only";

import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
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
import { resolveEarnProductAsset } from "@/lib/yield-optimization/earn-product-mints.shared";
import { type ConfirmedYieldWithdrawalInput } from "@/lib/yield-optimization/yield-deposit-repository.server";
import {
  applyConfirmedWithdrawalTransactionProof,
  type ConfirmedWithdrawalTransactionProof,
} from "@/lib/yield-optimization/earn-withdraw-proof.shared";

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

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(cluster);
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

    deltaRaw +=
      readTokenBalanceAmountRaw(post) - readTokenBalanceAmountRaw(pre);
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
    throw new Error(
      "Confirmed withdrawal transaction details are unavailable."
    );
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
  // ATA addresses depend on the mint's token program (CASH/USDG/PYUSD are
  // Token-2022); resolving through the product catalog also rejects
  // unsupported mints before any balance evidence is read.
  const productAsset = resolveEarnProductAsset({
    cluster: resolveLoyalClusterForSolanaEnv(args.cluster),
    mint: liquidityMint,
  });
  const walletLiquidityAta = getAssociatedTokenAddressSync(
    liquidityMint,
    new PublicKey(args.input.walletAddress),
    false,
    productAsset.tokenProgramId
  ).toBase58();
  const vaultLiquidityAta = getAssociatedTokenAddressSync(
    liquidityMint,
    new PublicKey(args.input.vaultPubkey),
    true,
    productAsset.tokenProgramId
  ).toBase58();
  const walletAtaDeltaRaw = getParsedTokenBalanceDeltaRaw({
    mint: args.input.liquidityMint,
    tokenAccount: walletLiquidityAta,
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
      "Confirmed withdrawal transaction does not transfer the withdrawal mint to the authenticated wallet."
    );
  }

  const vaultLiquidityDeltaRaw = getParsedTokenBalanceDeltaRaw({
    mint: args.input.liquidityMint,
    tokenAccount: vaultLiquidityAta,
    transaction,
  });
  const sourceType = args.input.sourceType ?? "reserve";
  let reserveDebitAmountRaw = BigInt(0);
  let vaultIdleDeltaRaw = BigInt(0);
  if (sourceType === "idle") {
    if (
      vaultLiquidityDeltaRaw >= BigInt(0) ||
      -vaultLiquidityDeltaRaw !== walletTransferAmountRaw
    ) {
      throw new Error(
        "Confirmed idle withdrawal does not debit the selected vault token account by the wallet credit amount."
      );
    }
  } else if (sourceType === "reserve") {
    vaultIdleDeltaRaw =
      vaultLiquidityDeltaRaw > BigInt(0) ? vaultLiquidityDeltaRaw : BigInt(0);
    reserveDebitAmountRaw = walletTransferAmountRaw + vaultIdleDeltaRaw;
  }

  return {
    reserveDebitAmountRaw,
    vaultIdleDeltaRaw,
    vaultIdleTokenAccount: vaultLiquidityAta,
    walletTransferAmountRaw,
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
  const productAsset = resolveEarnProductAsset({
    cluster,
    mint: requestInput.liquidityMint,
  });
  const sourceType = requestInput.sourceType ?? "reserve";
  let target: {
    liquidityMint: string;
    market: string | null;
    sourceTokenAccount: string | null;
    targetReserve: string;
  };
  if (sourceType === "idle") {
    const vaultLiquidityAta = getAssociatedTokenAddressSync(
      productAsset.mint,
      expectedVault,
      true,
      productAsset.tokenProgramId
    ).toBase58();
    if (requestInput.market !== null) {
      throw new Error("Earn idle withdrawal market must be null.");
    }
    if (requestInput.sourceTokenAccount !== vaultLiquidityAta) {
      throw new Error(
        "Earn idle withdrawal source token account does not match the vault mint account."
      );
    }
    if (
      requestInput.sourceMint !== undefined &&
      requestInput.sourceMint !== null &&
      requestInput.sourceMint !== productAsset.mint.toBase58()
    ) {
      throw new Error(
        "Earn idle withdrawal source mint does not match the withdrawal mint."
      );
    }
    if (requestInput.targetReserve !== vaultLiquidityAta) {
      throw new Error(
        "Earn idle withdrawal target does not match the vault mint account."
      );
    }
    target = {
      liquidityMint: productAsset.mint.toBase58(),
      market: null,
      sourceTokenAccount: vaultLiquidityAta,
      targetReserve: vaultLiquidityAta,
    };
  } else if (sourceType === "reserve") {
    if (!requestInput.market) {
      throw new Error("Earn reserve withdrawal market is required.");
    }
    new PublicKey(requestInput.market);
    new PublicKey(requestInput.targetReserve);
    target = {
      liquidityMint: productAsset.mint.toBase58(),
      market: requestInput.market,
      sourceTokenAccount: requestInput.sourceTokenAccount ?? null,
      targetReserve: requestInput.targetReserve,
    };
  } else {
    throw new Error("Earn withdrawal source type is invalid.");
  }
  const canonicalInput = {
    ...normalizedRequestInput,
    cluster,
    liquidityMint: target.liquidityMint,
    market: target.market,
    sourceTokenAccount: target.sourceTokenAccount,
    sourceType,
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
    requestInput.sourceTokenAccount ?? null,
    canonicalInput.sourceTokenAccount ?? null,
    "sourceTokenAccount"
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

export function serializeVerifiedWithdrawPosition(
  input: ConfirmedYieldWithdrawalInput,
  verifiedAt = new Date()
) {
  const sourceAmountRaw = input.sourceAmountRaw ?? input.withdrawnAmountRaw;
  const currentAmountRaw =
    input.mode === "full" && input.isFinalStep !== false
      ? BigInt(0)
      : sourceAmountRaw > input.withdrawnAmountRaw
      ? sourceAmountRaw - input.withdrawnAmountRaw
      : BigInt(0);
  return {
    currentHolding: {
      amountRaw: currentAmountRaw.toString(),
      liquidityMint: input.liquidityMint,
      market: input.market,
      observedAt: verifiedAt.toISOString(),
      observedSlot: input.confirmedSlot.toString(),
      provenance: {
        lastHoldingEventId: null,
        lastRebalanceDecisionId: null,
      },
      reserve: input.targetReserve,
    },
    id: input.withdrawalSignature,
    initialHolding: {
      liquidityMint: input.liquidityMint,
      market: input.market,
      reserve: input.targetReserve,
      supplyApyBps: null,
    },
    currentTotalAmountRaw: currentAmountRaw.toString(),
    principalAmountRaw: currentAmountRaw.toString(),
    status: "active" as const,
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
  position: ReturnType<typeof serializeVerifiedWithdrawPosition>;
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

// Validates a confirmed Earn withdrawal against the authenticated principal.
// LaserStream is the only writer of the resulting Earn state.
export async function verifyConfirmedEarnWithdrawal(args: {
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

  const connection = getConnection(solanaEnv);
  const cluster = normalizeLoyalCluster(input.cluster);
  const position = serializeVerifiedWithdrawPosition(input);

  if (input.mode !== "full") {
    return {
      blockingTokenAccounts: [],
      position,
      remainingHoldings: [],
      status: "withdrawal_recorded",
    };
  }

  if (input.isFinalStep === false) {
    return {
      blockingTokenAccounts: [],
      position,
      remainingHoldings: [],
      status: "full_exit_incomplete",
    };
  }

  try {
    const minContextSlot = toSafeContextSlot(input.confirmedSlot);
    const serverEnv = getServerEnv();
    const proof = await verifyEarnFullExitZeroBalances({
      cluster,
      connection,
      minContextSlot,
      policy: {
        account: input.policyAccount,
        seed: input.policySeed.toString(),
        setupPolicy:
          input.setupPolicyAccount && input.setupPolicySeed
            ? {
                account: input.setupPolicyAccount,
                seed: input.setupPolicySeed.toString(),
              }
            : null,
        vaultIndex: input.vaultIndex,
        vaultPubkey: input.vaultPubkey,
      },
      programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
      settingsPda: new PublicKey(input.settings),
    });
    console.info("[earn-withdraw-confirm] full exit verification", {
      blockingTokenAccountCount: proof.blockingTokenAccounts.length,
      cleanupTokenAccountCount: proof.cleanupTokenAccounts.length,
      cluster: input.cluster,
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
      position,
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
