import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import {
  deriveRecurringDelegation,
  deriveSubscriptionAuthority,
  getKaminoUsdcEarnTargetForCluster,
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  autodepositEnabledPush,
  autodepositSweepScheduledPush,
  sendWalletPush,
} from "@/lib/push-notifications/wallet-push.server";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  assertEarnAutodepositArtifactsExist,
  withEarnAutodepositArtifactRetry,
} from "@/lib/yield-optimization/earn-autodeposit-artifacts.server";
import {
  buildEarnAutodepositSetupConfirmRequestBody,
  hydratePreparedEarnUsdcAutodepositSetup,
  parseEarnAutodepositSetupConfirmRequestBody,
  type EarnAutodepositSetupConfirmResponse,
  type WireSmartAccountPreparedEarnUsdcAutodepositSetup,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  recordConfirmedAutodepositDelegation,
  recordPendingAutodepositSetup,
  scheduleBootstrapEarnAutodepositSweep,
  type BalanceSweepTargetRecord,
  type ConfirmedEarnAutodepositSetupInput,
  type EarnAutodepositBootstrapWalletBalanceSnapshot,
  type PendingEarnAutodepositScheduledSweepRecord,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Mobile twin of `yield-optimization/autodeposit/setup/confirm`. The device
// echoes the serialized prepared setup it signed + signature/slot + the chosen
// threshold; this route rebuilds the canonical confirm payload server-side. The
// canonicalization + bootstrap-sweep scheduling mirror the session route — keep
// in sync.
const EARN_DEPOSIT_VAULT_INDEX = 1 as const;
const MONTH_PERIOD_SECONDS = BigInt(30 * 24 * 60 * 60);
const BOOTSTRAP_BALANCE_SOURCE = "app_autodeposit_setup_confirm";
const BOOTSTRAP_BALANCE_SOURCE_COMMITMENT = "confirmed";

const connectionCache = new Map<SolanaEnv, Connection>();

type MobileSetupConfirmFields = {
  preparedSetup: WireSmartAccountPreparedEarnUsdcAutodepositSetup;
  setupSignature: string;
  confirmedSlot: string;
  walletBalanceFloorRaw: bigint;
};

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

function serializeScheduledSweep(
  sweep: PendingEarnAutodepositScheduledSweepRecord
): {
  classification: string;
  confidence: string;
  eligibleAfter: string;
  id: string;
  lotCount?: number;
  originalAmountRaw: string;
  reason: string;
  remainingAmountRaw: string;
  slotId?: string;
  status: string;
} {
  return {
    classification: sweep.classification,
    confidence: sweep.confidence,
    eligibleAfter: sweep.eligibleAfter.toISOString(),
    id: sweep.id.toString(),
    lotCount: sweep.lotCount,
    originalAmountRaw: sweep.originalAmountRaw.toString(),
    reason: sweep.reason,
    remainingAmountRaw: sweep.remainingAmountRaw.toString(),
    slotId: sweep.slotId.toString(),
    status: sweep.status,
  };
}

async function readBootstrapWalletBalanceSnapshot(args: {
  connection: Connection;
  input: ConfirmedEarnAutodepositSetupInput;
}): Promise<
  | {
      snapshot: EarnAutodepositBootstrapWalletBalanceSnapshot;
      status: "ok";
    }
  | {
      reason: string;
      status: "skipped";
    }
> {
  const walletUsdcAta = new PublicKey(args.input.walletUsdcAta);
  const account = await args.connection.getAccountInfoAndContext(
    walletUsdcAta,
    BOOTSTRAP_BALANCE_SOURCE_COMMITMENT
  );

  if (!account.value) {
    return { reason: "wallet_usdc_ata_missing", status: "skipped" };
  }

  if (!account.value.owner.equals(TOKEN_PROGRAM_ID)) {
    return { reason: "wallet_usdc_ata_invalid_owner", status: "skipped" };
  }

  let tokenAccount: ReturnType<typeof unpackAccount>;
  try {
    tokenAccount = unpackAccount(
      walletUsdcAta,
      account.value,
      TOKEN_PROGRAM_ID
    );
  } catch {
    return { reason: "wallet_usdc_ata_invalid_data", status: "skipped" };
  }

  const tokenMint = tokenAccount.mint.toBase58();
  if (tokenMint !== args.input.liquidityMint) {
    return { reason: "wallet_usdc_ata_non_usdc", status: "skipped" };
  }

  const tokenOwner = tokenAccount.owner.toBase58();
  if (tokenOwner !== args.input.walletAddress) {
    return { reason: "wallet_usdc_ata_wallet_mismatch", status: "skipped" };
  }

  const accountDataHash = createHash("sha256")
    .update(account.value.data)
    .digest("hex");
  const observedAt = new Date();

  return {
    snapshot: {
      accountDataHash,
      amountRaw: tokenAccount.amount,
      mint: tokenMint,
      observedAt,
      observedSlot: BigInt(account.context.slot),
      owner: tokenOwner,
      rawEvidence: {
        accountLamports: account.value.lamports.toString(),
        accountOwner: account.value.owner.toBase58(),
        bootstrap: true,
        setupSignature: args.input.setupSignature,
      },
      source: BOOTSTRAP_BALANCE_SOURCE,
      sourceCommitment: BOOTSTRAP_BALANCE_SOURCE_COMMITMENT,
    },
    status: "ok",
  };
}

function parseMobileSetupConfirmFields(
  body: unknown
): MobileSetupConfirmFields {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object.");
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.preparedSetup !== "object" ||
    record.preparedSetup === null
  ) {
    throw new Error("preparedSetup is required.");
  }
  if (typeof record.setupSignature !== "string" || !record.setupSignature) {
    throw new Error("setupSignature is required.");
  }
  if (typeof record.confirmedSlot !== "string" || !record.confirmedSlot) {
    throw new Error("confirmedSlot is required.");
  }
  if (
    typeof record.walletBalanceFloorRaw !== "string" ||
    !/^\d+$/.test(record.walletBalanceFloorRaw.trim())
  ) {
    throw new Error(
      "walletBalanceFloorRaw must be an unsigned integer string."
    );
  }
  return {
    preparedSetup:
      record.preparedSetup as WireSmartAccountPreparedEarnUsdcAutodepositSetup,
    setupSignature: record.setupSignature,
    confirmedSlot: record.confirmedSlot,
    walletBalanceFloorRaw: BigInt(record.walletBalanceFloorRaw.trim()),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", "Invalid request body.");
  }

  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileWalletRequest({
      body,
      // Accepts the flow's prepare signature too — the device signs one auth
      // message per flow (see authenticateMobileWalletRequest).
      purpose: [
        "earn-autodeposit-setup-confirm",
        "earn-autodeposit-setup-prepare",
      ],
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let fields: MobileSetupConfirmFields;
  try {
    fields = parseMobileSetupConfirmFields(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  let settingsPda: string;
  try {
    const user = await getOrCreateCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const existing = await findReadyCurrentUserSmartAccount({
      userId: user.id,
    });
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
  } catch (error) {
    console.error("[mobile-earn-autodeposit-setup-confirm] resolve failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown resolve error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "resolve_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  let input: ConfirmedEarnAutodepositSetupInput;
  try {
    const prepared = hydratePreparedEarnUsdcAutodepositSetup(
      fields.preparedSetup
    );
    const confirmBody = buildEarnAutodepositSetupConfirmRequestBody({
      confirmedSlot: fields.confirmedSlot,
      preparedSetup: prepared,
      signature: fields.setupSignature,
      walletBalanceFloorRaw: fields.walletBalanceFloorRaw,
    });
    input = parseEarnAutodepositSetupConfirmRequestBody(confirmBody);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid prepared setup."
    );
  }

  if (input.walletAddress !== walletAddress || input.settings !== settingsPda) {
    return jsonError(
      403,
      "principal_mismatch",
      "Confirmed autodeposit setup does not match the authenticated wallet."
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
  const connection = getConnection(solanaEnv);
  const serverEnv = getServerEnv();
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
  input = { ...input, confirmedSlot };

  if (
    input.setupStage === "create_policy" ||
    input.setupStage === "create_recurring_delegation"
  ) {
    try {
      await withEarnAutodepositArtifactRetry(async () => {
        await assertEarnAutodepositArtifactsExist({
          connection,
          policyAccount: input.policyAccount,
          recurringDelegation: input.recurringDelegation,
          requireRecurringDelegation:
            input.setupStage === "create_recurring_delegation",
          smartAccountsProgramId: new PublicKey(
            serverEnv.loyalSmartAccounts.programId
          ),
        });
      });
    } catch (error) {
      return jsonError(
        409,
        "artifact_missing",
        error instanceof Error
          ? error.message
          : "Confirmed Autodeposit setup artifacts are missing."
      );
    }
  }

  if (input.setupStage === "initialize_subscription_authority") {
    return NextResponse.json({
      confirmedSlot: confirmedSlot.toString(),
    });
  }

  const target =
    input.setupStage === "create_recurring_delegation"
      ? await recordConfirmedAutodepositDelegation(input)
      : await recordPendingAutodepositSetup(input);
  let bootstrapSweep: EarnAutodepositSetupConfirmResponse["bootstrapSweep"];
  if (input.setupStage === "create_recurring_delegation") {
    try {
      const snapshotResult = await readBootstrapWalletBalanceSnapshot({
        connection,
        input,
      });
      if (snapshotResult.status === "skipped") {
        bootstrapSweep = snapshotResult;
      } else {
        const result = await scheduleBootstrapEarnAutodepositSweep({
          snapshot: snapshotResult.snapshot,
          target,
        });
        if (result.status === "skipped") {
          bootstrapSweep = result;
        } else {
          bootstrapSweep = {
            status: result.status,
            sweep: serializeScheduledSweep(result.sweep),
          };
        }
      }
    } catch (error) {
      console.warn("[mobile-autodeposit-setup-confirm] bootstrap failed", {
        errorMessage:
          error instanceof Error ? error.message : "Unknown bootstrap error.",
        policyAccount: input.policyAccount,
        setupSignature: input.setupSignature,
        walletAddress: input.walletAddress,
      });
      bootstrapSweep = {
        reason:
          error instanceof Error
            ? error.message
            : "Bootstrap scheduling failed.",
        status: "failed",
      };
    }
  }

  if (input.setupStage === "create_recurring_delegation") {
    // Transactional push (ASK-1651). When the bootstrap sweep already found
    // idle USDC, the "about to move" push implies auto-deposit is on — send
    // one push, not two.
    const scheduledSweep =
      bootstrapSweep?.status === "scheduled" ? bootstrapSweep.sweep : undefined;
    await sendWalletPush(
      input.walletAddress,
      scheduledSweep
        ? autodepositSweepScheduledPush(
            BigInt(scheduledSweep.remainingAmountRaw)
          )
        : autodepositEnabledPush()
    );
  }

  return NextResponse.json({
    confirmedSlot: confirmedSlot.toString(),
    ...(bootstrapSweep ? { bootstrapSweep } : {}),
    target: serializeTarget(target),
  });
}
