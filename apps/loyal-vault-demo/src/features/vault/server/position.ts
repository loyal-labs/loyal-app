/**
 * Wallet-scoped position reads.
 *
 * The position read owns its accounting: the wallet's USDC/LP accounts, the
 * pending-withdrawal receipt, the escrow account AND the vault accounting
 * inputs are read in a single finalized batch, so a payout is never computed
 * from an older cached vault snapshot against a newer receipt or supply.
 * Failures stay typed — an RPC problem is never reported as a zero balance and
 * a missing wallet is reported rather than being read as zeros.
 */

import {
  findRequestWithdrawVaultReceiptPda,
  getRequestWithdrawVaultReceiptDecoder,
  REQUEST_WITHDRAW_VAULT_RECEIPT_DISCRIMINATOR,
} from "@voltr/vault-sdk";
import { findAssociatedTokenPda } from "@solana-program/token";

import {
  receiptEffectiveAssetRaw,
  type VaultSnapshot,
} from "../domain/accounting";
import type {
  PositionObservation,
  VaultObservation,
  RawAmount,
  ReadUnavailable,
  ValuationContext,
} from "../domain/types";
import {
  buildCoherentVaultCore,
  deriveIdleAuthority,
  decodeSplTokenAccount,
  deriveVaultBatchAddresses,
  type BatchAddress,
} from "./coherent-batch";
import { RPC_BOUNDS, VAULT_IDENTITY, parseWalletParam } from "./config";
import { getVaultRpc, type AccountData } from "./rpc";
import { createObservationCache } from "./single-flight";
import { projectServicedVaultObservation } from "./vault-observation";

type DecodedReceipt = ReturnType<
  ReturnType<typeof getRequestWithdrawVaultReceiptDecoder>["decode"]
>;

const receiptDecoder = getRequestWithdrawVaultReceiptDecoder();

export type PositionRead =
  | { ok: true; observation: PositionObservation; snapshot: VaultSnapshot; vaultObservation: VaultObservation; feePayerUsable: boolean }
  | { ok: false; unavailable: ReadUnavailable };

function rawAmount(raw: bigint, mint: string, decimals: number): RawAmount {
  return { raw: raw.toString(), mint, decimals };
}

async function readPosition(wallet: string): Promise<PositionRead> {
  const observationStartedAt = performance.now();
  const rpc = getVaultRpc();
  const genesis = await rpc.getGenesisHash();
  if (!genesis.ok) {
    return {
      ok: false,
      unavailable: {
        unavailable: true,
        reason: `cluster check failed: ${genesis.error}`,
        kind: "rpc-error",
      },
    };
  }

  const [vaultBatch, idleAuthority] = await Promise.all([
    deriveVaultBatchAddresses(),
    deriveIdleAuthority(),
  ]);
  const [usdcAta] = await findAssociatedTokenPda({
    owner: wallet as never,
    mint: VAULT_IDENTITY.assetMint,
    tokenProgram: VAULT_IDENTITY.tokenProgram,
  });
  const [lpAta] = await findAssociatedTokenPda({
    owner: wallet as never,
    mint: VAULT_IDENTITY.lpMint,
    tokenProgram: VAULT_IDENTITY.tokenProgram,
  });
  const [receiptPda] = await findRequestWithdrawVaultReceiptPda({
    vault: VAULT_IDENTITY.vault,
    userTransferAuthority: wallet as never,
  });
  const [escrowAta] = await findAssociatedTokenPda({
    owner: receiptPda,
    mint: VAULT_IDENTITY.lpMint,
    tokenProgram: VAULT_IDENTITY.tokenProgram,
  });

  // ONE batch: accounting inputs and wallet cash accounts at a single slot.
  const batch: ReadonlyArray<BatchAddress> = [
    ...vaultBatch,
    { key: "wallet", address: wallet },
    { key: "walletUsdcAta", address: usdcAta },
    { key: "walletLpAta", address: lpAta },
    { key: "withdrawalReceipt", address: receiptPda },
    { key: "escrowLpAta", address: escrowAta },
  ];
  const response = await rpc.getMultipleAccounts(
    batch.map((entry) => entry.address)
  );
  if (!response.ok) {
    return {
      ok: false,
      unavailable: {
        unavailable: true,
        reason: `position batch read failed: ${response.error} (${response.kind})`,
        kind: "rpc-error",
      },
    };
  }
  const byKey = new Map<string, AccountData | null>();
  batch.forEach((entry, index) =>
    byKey.set(entry.key, response.value[index] ?? null)
  );
  const slot = response.contextSlot ?? -1;

  const core = buildCoherentVaultCore(
    vaultBatch,
    response.value.slice(0, vaultBatch.length),
    slot,
    { idleAuthority }
  );
  if (!core.ok) {
    return {
      ok: false,
      unavailable: { unavailable: true, reason: core.reason, kind: core.kind },
    };
  }
  const { vault } = core.core;
  const snapshot: VaultSnapshot = {
    assetTotalValue: core.core.assetTotalValue,
    lpSupply: core.core.lpSupplyRaw,
    lpDecimals: core.core.lpDecimals,
    accumulatedLpAdminFees: vault.feeState.accumulatedLpAdminFees,
    accumulatedLpManagerFees: vault.feeState.accumulatedLpManagerFees,
    accumulatedLpProtocolFees: vault.feeState.accumulatedLpProtocolFees,
    deadWeight: vault.deadWeight,
    lastManagementFeeUpdateTs: vault.feeUpdate.lastManagementFeeUpdateTs,
    managementFeeBps:
      vault.feeConfiguration.managerManagementFee +
      vault.feeConfiguration.adminManagementFee +
      vault.feeConfiguration.protocolManagementFee,
    issuanceFeeBps: vault.feeConfiguration.issuanceFee,
    redemptionFeeBps: vault.feeConfiguration.redemptionFee,
    lastUpdatedLockedProfit: vault.lockedProfitState.lastUpdatedLockedProfit,
    lastReport: vault.lockedProfitState.lastReport,
    lockedProfitDegradationDuration:
      vault.vaultConfiguration.lockedProfitDegradationDuration,
    slot: core.core.slot,
    observedAtSec: core.core.chainTimeSec,
  };

  const disclosures: string[] = [];
  const walletAccount = byKey.get("wallet");
  if (!walletAccount) {
    return {
      ok: false,
      unavailable: {
        unavailable: true,
        reason: `wallet ${wallet} does not exist on ${VAULT_IDENTITY.cluster}; no balances are invented for it`,
        kind: "account-missing",
      },
    };
  }

  const optionalTokenBalance = (
    key: string,
    expected: { mint: string; authority?: string; label: string }
  ): bigint | null => {
    const account = byKey.get(key);
    if (!account) return null; // an absent optional token account is a real zero
    const decoded = decodeSplTokenAccount(account, expected);
    if (!decoded.ok) {
      disclosures.push(decoded.reason);
      return null;
    }
    return decoded.amountRaw;
  };
  const usdcRaw = optionalTokenBalance("walletUsdcAta", {
    mint: VAULT_IDENTITY.assetMint,
    authority: wallet,
    label: "wallet USDC account",
  });
  const lpRaw = optionalTokenBalance("walletLpAta", {
    mint: VAULT_IDENTITY.lpMint,
    authority: wallet,
    label: "wallet LP account",
  });
  const escrowRaw = optionalTokenBalance("escrowLpAta", {
    mint: VAULT_IDENTITY.lpMint,
    authority: receiptPda,
    label: "escrow LP account",
  });

  let receipt: PositionObservation["receipt"] = null;
  let escrowedLp: RawAmount | null = null;
  const escrowTokenAccountBalance: RawAmount | null =
    escrowRaw === null
      ? null
      : rawAmount(escrowRaw, VAULT_IDENTITY.lpMint, core.core.lpDecimals);

  const receiptAccount = byKey.get("withdrawalReceipt");
  if (receiptAccount) {
    if (receiptAccount.owner !== VAULT_IDENTITY.voltrProgram) {
      disclosures.push(
        `withdrawal receipt ${receiptAccount.address} is owned by ${receiptAccount.owner}, not the Voltr program`
      );
    } else {
      let decoded: DecodedReceipt | null = null;
      try {
        if (
          !REQUEST_WITHDRAW_VAULT_RECEIPT_DISCRIMINATOR.every(
            (byte, index) => receiptAccount.data[index] === byte
          )
        )
          throw new Error("receipt discriminator mismatch");
        decoded = receiptDecoder.decode(receiptAccount.data) as DecodedReceipt;
      } catch (error) {
        disclosures.push(
          `withdrawal receipt decode failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      if (decoded) {
        const version = (decoded as { version?: number | bigint }).version;
        if (version !== undefined && BigInt(version) !== 0n) {
          disclosures.push(
            `withdrawal receipt ${
              receiptAccount.address
            } has unsupported version ${String(version)}`
          );
        } else if (
          decoded.vault !== VAULT_IDENTITY.vault ||
          decoded.user !== wallet
        ) {
          disclosures.push(
            `withdrawal receipt ${receiptAccount.address} binds vault ${decoded.vault}/user ${decoded.user}, not this vault/wallet`
          );
        } else {
          const effective = receiptEffectiveAssetRaw(snapshot, decoded);
          const secondsRemainingBig =
            decoded.withdrawableFromTs > snapshot.observedAtSec
              ? decoded.withdrawableFromTs - snapshot.observedAtSec
              : 0n;
          escrowedLp = rawAmount(
            decoded.amountLpEscrowed,
            VAULT_IDENTITY.lpMint,
            core.core.lpDecimals
          );
          if (
            !escrowTokenAccountBalance ||
            escrowTokenAccountBalance.raw !== escrowedLp.raw
          ) {
            disclosures.push(
              `escrow token account holds ${
                escrowTokenAccountBalance?.raw ?? "no"
              } LP while the receipt escrows ${escrowedLp.raw}`
            );
          }
          receipt = {
            receiptAddress: receiptAccount.address,
            user: decoded.user,
            escrowedLp,
            assetAtRequestRaw: effective.atRequestRaw,
            assetAtPresentRaw: effective.atPresentRaw,
            assetEffectiveRaw: effective.effectiveRaw,
            withdrawableFromTs: decoded.withdrawableFromTs.toString(),
            withdrawableFromTsIso: new Date(
              Number(decoded.withdrawableFromTs) * 1000
            ).toISOString(),
            eligibility: secondsRemainingBig === 0n ? "eligible" : "waiting",
            secondsRemaining: secondsRemainingBig.toString(),
            escrowedLpCountedInWalletBalance: false,
          };
        }
      }
    }
  }

  if (!receiptAccount && (escrowRaw ?? 0n) > 0n)
    disclosures.push("escrow LP exists without a withdrawal receipt");
  if (disclosures.length > 0)
    return {
      ok: false,
      unavailable: {
        unavailable: true,
        kind: "decode-error",
        reason: disclosures.join("; "),
      },
    };

  const valuation: ValuationContext = {
    quoteUnit: "USDC",
    source: "token-account",
    slot,
    observedAt: new Date(Number(core.core.chainTimeSec) * 1000).toISOString(),
  };

  return {
    ok: true,
    snapshot,
    feePayerUsable: walletAccount.owner === "11111111111111111111111111111111" && walletAccount.data.length === 0,
    vaultObservation: (await projectServicedVaultObservation(core.core, observationStartedAt)).observation,
    observation: {
      schemaVersion: "loyal-vault-demo.position-observation/1",
      wallet,
      solLamports: walletAccount.lamports.toString(),
      usdc: {
        balance: rawAmount(
          usdcRaw ?? 0n,
          VAULT_IDENTITY.assetMint,
          VAULT_IDENTITY.assetDecimals
        ),
        accountAddress:
          usdcRaw === null ? null : byKey.get("walletUsdcAta")!.address,
      },
      lp: {
        balance: rawAmount(
          lpRaw ?? 0n,
          VAULT_IDENTITY.lpMint,
          core.core.lpDecimals
        ),
        accountAddress:
          lpRaw === null ? null : byKey.get("walletLpAta")!.address,
      },
      escrowedLp,
      escrowTokenAccountBalance,
      receipt,
      valuation,
      freshness: {
        observedSlot: slot,
        observedAt: valuation.observedAt,
        snapshotCoherent: true,
        componentSlots: { batch: slot, vaultSnapshot: core.core.slot },
      },
      unavailable: disclosures,
    },
  };
}

const caches = new Map<
  string,
  ReturnType<typeof createObservationCache<PositionRead>>
>();

function cacheFor(wallet: string) {
  let cache = caches.get(wallet);
  if (!cache) {
    cache = createObservationCache<PositionRead>({
      load: () => readPosition(wallet),
      ttlMs: RPC_BOUNDS.positionCacheTtlMs,
      failureBackoffMs: RPC_BOUNDS.failureBackoffMs,
      isFailure: (read) => !read.ok,
    });
    caches.set(wallet, cache);
  }
  return cache;
}

/** Cached, single-flight, wallet-scoped position observation. */
export async function getPositionObservation(
  walletValue: string | null
): Promise<PositionRead> {
  const parsed = parseWalletParam(walletValue);
  if (!parsed.ok) {
    return {
      ok: false,
      unavailable: {
        unavailable: true,
        reason: parsed.reason,
        kind: "invalid-input",
      },
    };
  }
  return cacheFor(parsed.wallet).read();
}
