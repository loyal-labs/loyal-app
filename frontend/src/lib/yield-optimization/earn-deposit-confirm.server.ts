import "server-only";

import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  Connection,
  PublicKey,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";

import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import {
  assertSafeUsdcEarnReserveMetadata,
  findEarnReserveTargetIneligibility,
} from "@/lib/yield-optimization/earn-reserve-target.server";
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

// The verification reads below can land on RPC nodes that lag behind the
// client's own confirmation (launch night 2026-07-08: ~70 valid confirms were
// rejected 400 this way and their on-chain deposits went invisible). Poll
// briefly before treating a missing status/transaction as a rejection.
const RPC_VERIFY_ATTEMPTS = 6;
const RPC_VERIFY_DELAY_MS = 500;

export async function pollRpcRead<T>(
  read: () => Promise<T | null>
): Promise<T | null> {
  for (let attempt = 1; attempt <= RPC_VERIFY_ATTEMPTS; attempt += 1) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    if (attempt < RPC_VERIFY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RPC_VERIFY_DELAY_MS));
    }
  }
  return null;
}

// Every rejection here strands a confirmed on-chain deposit outside the
// read-model until the earn-deposit-reconcile cron adopts it — so a rejection
// must never be silent (the launch-night 400s were).
function rejectConfirm(args: {
  status: number;
  code: string;
  message: string;
  context: Record<string, unknown>;
}): never {
  console.error("[earn-deposit-confirm] rejected", {
    code: args.code,
    message: args.message,
    status: args.status,
    ...args.context,
  });
  throw new EarnDepositConfirmError(args);
}

type ConfirmedDepositTransactionProof = {
  principalAmountRaw: bigint;
};

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

function readTokenBalanceAmountRaw(balance: TokenBalance | undefined): bigint {
  const amount = balance?.uiTokenAmount.amount;
  return typeof amount === "string" && /^\d+$/.test(amount)
    ? BigInt(amount)
    : BigInt(0);
}

function getParsedTokenBalanceDeltasByOwner(args: {
  mint: string;
  transaction: ParsedTransactionWithMeta;
}): Map<string, bigint> {
  const preBalances = args.transaction.meta?.preTokenBalances ?? [];
  const postBalances = args.transaction.meta?.postTokenBalances ?? [];
  const indexes = new Set<number>();

  for (const balance of [...preBalances, ...postBalances]) {
    if (balance.mint === args.mint) {
      indexes.add(balance.accountIndex);
    }
  }

  const deltasByOwner = new Map<string, bigint>();
  for (const accountIndex of indexes) {
    const pre = preBalances.find(
      (balance) =>
        balance.accountIndex === accountIndex && balance.mint === args.mint
    );
    const post = postBalances.find(
      (balance) =>
        balance.accountIndex === accountIndex && balance.mint === args.mint
    );
    const owner = post?.owner ?? pre?.owner ?? null;

    if (!owner) {
      continue;
    }

    deltasByOwner.set(
      owner,
      (deltasByOwner.get(owner) ?? BigInt(0)) +
        readTokenBalanceAmountRaw(post) -
        readTokenBalanceAmountRaw(pre)
    );
  }

  return deltasByOwner;
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
  // Best-effort alarm, never a gate: the deposit already landed on-chain, so
  // rejecting the confirm would only make it invisible. Prepare-time routing
  // refuses ineligible reserves; a confirm that still names one means a
  // client bypassed prepare or the guard has a hole (ASK-1764).
  void findEarnReserveTargetIneligibility({
    cluster,
    reserve: target.targetReserve,
  })
    .then((reason) => {
      if (reason) {
        console.error(
          "[earn-deposit-confirm] confirmed deposit targets an ineligible reserve",
          {
            cluster,
            market: target.market,
            reason,
            reserve: target.targetReserve,
          }
        );
      }
    })
    .catch(() => undefined);
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

// A route policy can exist on-chain without DB rows (the deposit that created
// it landed but its confirm failed), so a reuse confirm has no recorded
// creation signature to cite. Recover it from the chain: the policy account's
// oldest successful transaction is the one that created it.
export async function resolvePolicyCreationSignatureFromChain(args: {
  cluster: SolanaEnv;
  policyAccount: string;
}): Promise<{ signature: string; slot: string } | null> {
  try {
    const connection = getConnection(args.cluster);
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(args.policyAccount),
      { limit: 1000 },
      "confirmed"
    );
    const creation = [...signatures]
      .reverse()
      .find((entry) => entry.err === null);
    if (!creation) {
      return null;
    }
    return { signature: creation.signature, slot: creation.slot.toString() };
  } catch {
    // Best-effort recovery; the caller falls back to the original error.
    return null;
  }
}

async function resolveConfirmedSignatureSlot(args: {
  cluster: SolanaEnv;
  operation: "deposit" | "route policy setup" | "setup policy setup";
  signature: string;
}): Promise<bigint> {
  const slot = await pollRpcRead(async () => {
    const { value } = await getConnection(args.cluster).getSignatureStatuses(
      [args.signature],
      { searchTransactionHistory: true }
    );
    const status = value[0];

    if (status?.err) {
      // Executed and failed on-chain — permanent, no point polling.
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

async function resolveConfirmedDepositTransactionProof(args: {
  cluster: SolanaEnv;
  input: ConfirmedYieldDepositInput;
}): Promise<ConfirmedDepositTransactionProof> {
  const transaction = await pollRpcRead(async () => {
    const parsed = await getConnection(args.cluster).getParsedTransaction(
      args.input.depositSignature,
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
    throw new Error("Confirmed deposit transaction details are unavailable.");
  }
  if (transaction.meta.err) {
    throw new Error("Deposit transaction proof has an execution error.");
  }
  if (BigInt(transaction.slot) !== args.input.confirmedSlot) {
    throw new Error(
      "Confirmed deposit transaction slot does not match the recorded slot."
    );
  }

  const deltasByOwner = getParsedTokenBalanceDeltasByOwner({
    mint: args.input.depositMint,
    transaction,
  });
  const fundingOwners = [
    ...new Set([
      args.input.walletAddress,
      args.input.smartAccountAddress,
      args.input.vaultPubkey,
    ]),
  ];
  const principalAmountRaw = fundingOwners.reduce((total, owner) => {
    const deltaRaw = deltasByOwner.get(owner) ?? BigInt(0);
    return deltaRaw < BigInt(0) ? total - deltaRaw : total;
  }, BigInt(0));

  if (principalAmountRaw <= BigInt(0)) {
    throw new Error(
      "Confirmed deposit transaction does not debit USDC from the wallet or Earn vault."
    );
  }

  return { principalAmountRaw };
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

  const rejectionContext = {
    depositSignature: input.depositSignature,
    settings: input.settings,
    walletAddress: input.walletAddress,
  };

  if (
    input.walletAddress !== principal.walletAddress ||
    input.settings !== principal.settingsPda
  ) {
    rejectConfirm({
      status: 403,
      code: "principal_mismatch",
      message:
        "Confirmed yield deposit does not match the authenticated wallet session.",
      context: rejectionContext,
    });
  }

  try {
    input = createCanonicalDepositInput(input);
  } catch (error) {
    rejectConfirm({
      status: 400,
      code: "metadata_mismatch",
      message:
        error instanceof Error
          ? error.message
          : "Confirmed yield deposit metadata is invalid.",
      context: rejectionContext,
    });
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (input.cluster !== configuredCluster) {
    rejectConfirm({
      status: 400,
      code: "cluster_mismatch",
      message:
        "Confirmed yield deposit cluster does not match the configured Solana environment.",
      context: { ...rejectionContext, cluster: input.cluster },
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
    rejectConfirm({
      status: 400,
      code: "unconfirmed_signature",
      message:
        error instanceof Error
          ? error.message
          : "Deposit transaction is not confirmed.",
      context: rejectionContext,
    });
  }

  if (input.confirmedSlot !== confirmedSlot) {
    // The client-supplied slot can be its confirmation context slot (the
    // client's RPC-lag fallback), not the landing slot. The server-resolved
    // status slot is canonical — rejecting on this mismatch stranded valid
    // launch-night deposits invisibly.
    console.warn("[earn-deposit-confirm] corrected client slot", {
      ...rejectionContext,
      clientSlot: input.confirmedSlot.toString(),
      resolvedSlot: confirmedSlot.toString(),
    });
    input = { ...input, confirmedSlot };
  }

  let depositProof: ConfirmedDepositTransactionProof;
  try {
    depositProof = await resolveConfirmedDepositTransactionProof({
      cluster: solanaEnv,
      input,
    });
  } catch (error) {
    rejectConfirm({
      status: 400,
      code: "invalid_deposit_proof",
      message:
        error instanceof Error
          ? error.message
          : "Deposit transaction amount proof is invalid.",
      context: rejectionContext,
    });
  }
  input = {
    ...input,
    principalAmountRaw: depositProof.principalAmountRaw,
  };

  if (input.policyInitialization === "create") {
    let policyConfirmedSlot: bigint;
    try {
      policyConfirmedSlot = await resolveConfirmedSignatureSlot({
        cluster: solanaEnv,
        operation: "route policy setup",
        signature: input.policySignature,
      });
    } catch (error) {
      rejectConfirm({
        status: 400,
        code: "unconfirmed_policy_signature",
        message:
          error instanceof Error
            ? error.message
            : "Route policy setup transaction is not confirmed.",
        context: { ...rejectionContext, policySignature: input.policySignature },
      });
    }

    if (input.policyConfirmedSlot !== policyConfirmedSlot) {
      console.warn("[earn-deposit-confirm] corrected client policy slot", {
        ...rejectionContext,
        clientSlot: input.policyConfirmedSlot?.toString() ?? null,
        resolvedSlot: policyConfirmedSlot.toString(),
      });
      input = { ...input, policyConfirmedSlot };
    }

    let setupPolicyConfirmedSlot: bigint;
    try {
      setupPolicyConfirmedSlot = await resolveConfirmedSignatureSlot({
        cluster: solanaEnv,
        operation: "setup policy setup",
        signature: input.setupPolicySignature ?? "",
      });
    } catch (error) {
      rejectConfirm({
        status: 400,
        code: "unconfirmed_setup_policy_signature",
        message:
          error instanceof Error
            ? error.message
            : "Setup policy transaction is not confirmed.",
        context: {
          ...rejectionContext,
          setupPolicySignature: input.setupPolicySignature ?? null,
        },
      });
    }

    if (input.setupPolicyConfirmedSlot !== setupPolicyConfirmedSlot) {
      console.warn("[earn-deposit-confirm] corrected client setup policy slot", {
        ...rejectionContext,
        clientSlot: input.setupPolicyConfirmedSlot?.toString() ?? null,
        resolvedSlot: setupPolicyConfirmedSlot.toString(),
      });
      input = { ...input, setupPolicyConfirmedSlot };
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
