/**
 * Server side of POST /api/transactions/prepare.
 *
 * Everything the client receives is derived from server-side reads: the pinned
 * identity table, one coherent wallet-scoped position batch, the shared vault
 * observation, and a fresh blockhash. A client-supplied snapshot is never an
 * input, so a prepared transaction can never be quoted against state the
 * server did not just read.
 *
 * This module holds no signing material: the wallet is a required-signer
 * descriptor, and the encoded transaction leaves here with a zeroed signature
 * slot. The connected wallet signs; the browser owns submission and recovery.
 */

import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import type { Address } from "@solana/kit";

import {
  buildUnsignedTransaction,
  auditWire,
  claimPreflight,
  claimPreview,
  deriveCanonicalUserAccounts,
  depositPreflight,
  depositPreview,
  parsePrepareRequest,
  requestWithdrawPreflight,
  requestWithdrawPreview,
  type CanonicalInstruction,
  type Prerequisite,
  type PreparePreview,
  type PrepareRequestParse,
  type VaultAction,
} from "../domain/transactions";
import type { RawAmount } from "../domain/types";
import type { VaultSnapshot } from "../domain/accounting";
import { RPC_BOUNDS, VAULT_IDENTITY } from "./config";
import { assertPinnedCluster, getTransactionRpc } from "./transaction-rpc";
import { getPositionObservation } from "./position";

export type PreparedTransaction = Readonly<{
  wireBase64: string;
  messageSha256: string;
  wireByteLength: number;
  feePayer: string;
  requiredSigners: readonly string[];
  signaturesZeroed: boolean;
  blockhash: string;
  /** Decimal string: JSON cannot carry a u64 block height. */
  lastValidBlockHeight: string;
  instructions: readonly CanonicalInstruction[];
}>;

export type ObservationIdentity = Readonly<{
  vaultSlot: number;
  vaultObservedAt: string;
  positionSlot: number;
  positionObservedAt: string;
  snapshotCoherent: boolean;
  /** Both observations derive from the same wallet-scoped account batch. */
  navStatus: string;
  navDetail: string;
  idleCustody: RawAmount | null;
  workerObservation: Readonly<{ state: "available" | "unavailable"; detail: string }>;
}>;

export type PrepareSuccess = Readonly<{
  schemaVersion: "loyal-vault-demo.transaction-preparation/1";
  action: VaultAction;
  wallet: string;
  cluster: typeof VAULT_IDENTITY.cluster;
  bound: Readonly<{
    vault: string;
    voltrProgram: string;
    assetMint: string;
    assetDecimals: number;
    lpMint: string;
    lpDecimals: number;
  }>;
  transaction: PreparedTransaction;
  preview: PreparePreview;
  prerequisites: readonly Prerequisite[];
  observation: ObservationIdentity;
  quote: Readonly<{
    preparedAt: string;
    validForBlockHeight: string;
    expiresWhen: string;
    maxStalenessMs: number;
  }>;
  warnings: readonly string[];
}>;

export type PrepareFailureKind = "invalid-input" | "preflight-refused" | "read-error";

export type PrepareFailure = Readonly<{
  error: Readonly<{ kind: PrepareFailureKind; reason: string; field?: string }>;
  prerequisites?: readonly Prerequisite[];
}>;

export type PrepareOutcome =
  | { ok: true; httpStatus: 200; response: PrepareSuccess }
  | { ok: false; httpStatus: 400 | 409 | 503; failure: PrepareFailure };

function invalid(reason: string, field?: string): PrepareOutcome {
  return { ok: false, httpStatus: 400, failure: { error: { kind: "invalid-input", reason, field } } };
}

function refused(reason: string, prerequisites: readonly Prerequisite[]): PrepareOutcome {
  return { ok: false, httpStatus: 409, failure: { error: { kind: "preflight-refused", reason }, prerequisites } };
}

function readError(reason: string): PrepareOutcome {
  return { ok: false, httpStatus: 503, failure: { error: { kind: "read-error", reason } } };
}

function optionalRaw(balance: RawAmount, accountAddress: string | null): bigint | null {
  // A missing token account is a real absence, never a fabricated zero.
  return accountAddress === null ? null : BigInt(balance.raw);
}

/**
 * Prepares one unsigned transaction for a validated request. The returned
 * preview carries the exact amounts the instruction moves, clearly-labelled
 * estimates for what the program alone decides, the wallet's SOL cost, and the
 * blockhash validity horizon.
 */
export async function prepareTransaction(body: unknown): Promise<PrepareOutcome> {
  const parsed: PrepareRequestParse = parsePrepareRequest(body);
  if (!parsed.ok) return invalid(parsed.reason, parsed.field);
  const request = parsed.request;
  if (!PublicKey.isOnCurve(request.wallet)) return invalid("Wallet must be an on-curve signing address.", "wallet");

  const cluster = await assertPinnedCluster();
  if (!cluster.ok) {
    return readError(`cluster check failed: ${cluster.error}`);
  }

  const positionRead = await getPositionObservation(request.wallet);
  if (!positionRead.ok) {
    return readError(`wallet position unavailable: ${positionRead.unavailable.reason}`);
  }
  if (!positionRead.feePayerUsable) return invalid("Wallet must be a system-owned fee payer.", "wallet");

  const blockhash = await getTransactionRpc().getLatestBlockhash();
  if (!blockhash.ok) {
    return readError(`blockhash unavailable: ${blockhash.error}`);
  }

  const position = positionRead.observation;
  const vault = positionRead.vaultObservation;
  const snapshot: VaultSnapshot = positionRead.snapshot;
  const walletUsdcAtaExists = position.usdc.accountAddress !== null;
  const walletLpAtaExists = position.lp.accountAddress !== null;
  const walletUsdcRaw = optionalRaw(position.usdc.balance, position.usdc.accountAddress);
  const walletLpRaw = optionalRaw(position.lp.balance, position.lp.accountAddress);
  const idleRaw = BigInt(vault.idleCustody.raw);
  const maxCapRaw = BigInt(vault.terms.maxCapRaw);
  const assetTotalValueRaw = BigInt(vault.assetTotalValue.raw);
  const navStatus = vault.navFreshness.status;
  const navDetail = vault.navFreshness.detail;
  const lpDecimals = vault.identity.lpDecimals;

  let preflight: ReturnType<typeof depositPreflight>;
  let preview: PreparePreview;
  let instructionAmount: bigint | null = request.amountRaw;
  let withdrawAll = request.withdrawAll;

  if (request.action === "deposit") {
    // Standing servicing is required for this managed vault. An unsigned quote
    // must not bypass the same availability gate as the deposit UI.
    if (vault.serviceState.deposits === "unavailable") {
      return refused(vault.serviceState.depositsReason, [{
        key: "withdrawal-service",
        state: "unavailable",
        detail: vault.serviceState.depositsReason,
        blocks: true,
      }]);
    }
    preflight = depositPreflight({
      amountRaw: request.amountRaw,
      walletUsdcRaw,
      walletUsdcAtaExists,
      vaultIdleRaw: idleRaw,
      assetTotalValueRaw,
      maxCapRaw,
      navStatus,
      navDetail,
    });
    if (!preflight.ok) return refused(preflight.reason, preflight.prerequisites);
    preview = depositPreview({
      snapshot,
      amountRaw: request.amountRaw,
      createsLpAta: !walletLpAtaExists,
    });
  } else if (request.action === "request-withdraw") {
    if (position.receipt !== null) {
      return refused("Claim the existing withdrawal before requesting another.", [{
        key: "pending-withdrawal", state: "waiting", blocks: true,
        detail: "An existing withdrawal receipt is already bound to this wallet.",
      }]);
    }
    const lpAmount = request.withdrawAll ? (walletLpRaw ?? 0n) : request.amountRaw!;
    preflight = requestWithdrawPreflight({
      amountLpRaw: lpAmount,
      withdrawAll: request.withdrawAll,
      walletLpRaw,
      walletLpAtaExists,
    });
    if (!preflight.ok) return refused(preflight.reason, preflight.prerequisites);
    instructionAmount = lpAmount;
    preview = requestWithdrawPreview({ snapshot, amountLpRaw: lpAmount, withdrawAll: request.withdrawAll,
      withdrawalWaitingPeriodSeconds: BigInt(vault.terms.withdrawalWaitingPeriodSeconds) });
  } else {
    const receipt = position.receipt;
    const escrowedLpRaw = receipt === null ? null : BigInt(receipt.escrowedLp.raw);
    preflight = claimPreflight({
      receiptExists: receipt !== null,
      receiptOwnedByWallet: receipt !== null,
      receiptAddress: receipt?.receiptAddress ?? (await deriveReceiptAddress(request.wallet)),
      escrowedLpRaw,
      escrowTokenBalanceRaw: position.escrowTokenAccountBalance === null ? null : BigInt(position.escrowTokenAccountBalance.raw),
      assetEffectiveRaw: receipt?.assetEffectiveRaw ?? null,
      withdrawableFromTs: receipt === null ? null : BigInt(receipt.withdrawableFromTs),
      chainTimeSec: snapshot.observedAtSec,
      idleRaw,
    });
    if (!preflight.ok) return refused(preflight.reason, preflight.prerequisites);
    instructionAmount = null;
    withdrawAll = false;
    preview = claimPreview({
      escrowedLpRaw: escrowedLpRaw!,
      assetAtRequestRaw: receipt!.assetAtRequestRaw,
      assetEffectiveRaw: receipt!.assetEffectiveRaw,
      lpDecimals,
      createsUsdcAta: !walletUsdcAtaExists,
    });
  }

  if (BigInt(position.solLamports) < BigInt(preview.sol.totalLamports)) {
    return refused("Wallet SOL is below the estimated network fee and account rent.", [{
      key: "wallet-sol", state: "insufficient", blocks: true,
      detail: `Estimated ${preview.sol.totalLamports} lamports required; wallet has ${position.solLamports}.`,
    }]);
  }
  const built = await buildUnsignedTransaction({
    wallet: request.wallet,
    action: request.action,
    amountRaw: instructionAmount,
    withdrawAll,
    blockhash: blockhash.value.blockhash,
    lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
    walletUsdcAtaExists,
    walletLpAtaExists,
  });
  if (!built.ok) return readError(built.reason);
  const audit = auditWire(built.transaction.wireBase64);
  if (!audit.ok) return readError(audit.reason);
  const messageSha256 = createHash("sha256").update(Buffer.from(audit.messageBase64, "base64")).digest("hex");

  const warnings: string[] = [];
  if (navStatus !== "fresh") warnings.push(`vault NAV is not fresh at this snapshot: ${navDetail}`);
  if (vault.unavailable.length > 0) warnings.push(`vault observation reported unavailable facts: ${vault.unavailable.join("; ")}`);
  for (const entry of preflight.prerequisites) {
    if (!entry.blocks && entry.state !== "ok") warnings.push(`${entry.key}: ${entry.detail}`);
  }

  return {
    ok: true,
    httpStatus: 200,
    response: {
      schemaVersion: "loyal-vault-demo.transaction-preparation/1",
      action: request.action,
      wallet: request.wallet,
      cluster: VAULT_IDENTITY.cluster,
      bound: {
        vault: VAULT_IDENTITY.vault,
        voltrProgram: VAULT_IDENTITY.voltrProgram,
        assetMint: VAULT_IDENTITY.assetMint,
        assetDecimals: VAULT_IDENTITY.assetDecimals,
        lpMint: VAULT_IDENTITY.lpMint,
        lpDecimals,
      },
      transaction: {
        wireBase64: built.transaction.wireBase64,
        messageSha256,
        wireByteLength: built.transaction.wireByteLength,
        feePayer: built.transaction.feePayer,
        requiredSigners: built.transaction.requiredSigners,
        signaturesZeroed: built.transaction.signaturesZeroed,
        blockhash: built.transaction.blockhash,
        lastValidBlockHeight: built.transaction.lastValidBlockHeight.toString(),
        instructions: built.transaction.instructions,
      },
      preview,
      prerequisites: preflight.prerequisites,
      observation: {
        vaultSlot: vault.freshness.observedSlot,
        vaultObservedAt: vault.freshness.observedAt,
        positionSlot: position.freshness.observedSlot,
        positionObservedAt: position.freshness.observedAt,
        snapshotCoherent: position.freshness.snapshotCoherent && vault.freshness.snapshotCoherent &&
          position.freshness.observedSlot === vault.freshness.observedSlot,
        navStatus,
        navDetail,
        idleCustody: vault.idleCustody,
        workerObservation: {
          state: vault.serviceState.deposits,
          detail: `${vault.serviceState.depositsReason} ${vault.serviceState.withdrawalsNote}`,
        },
      },
      quote: {
        preparedAt: new Date().toISOString(),
        validForBlockHeight: blockhash.value.lastValidBlockHeight.toString(),
        expiresWhen: `the quoted blockhash stops being accepted after block ${blockhash.value.lastValidBlockHeight}, and the preview figures are only as current as the slots disclosed above: re-quote before signing when either is older than ${RPC_BOUNDS.maxStalenessMs}ms`,
        maxStalenessMs: RPC_BOUNDS.maxStalenessMs,
      },
      warnings,
    },
  };
}

async function deriveReceiptAddress(wallet: Address): Promise<string> {
  const accounts = await deriveCanonicalUserAccounts(wallet);
  return accounts.receipt;
}
