import "server-only";

import type { LoyalCluster } from "@loyal-labs/actions";
import { PublicKey, type Connection } from "@solana/web3.js";

import { verifyEarnFullExitZeroBalances } from "./earn-full-exit-zero-proof.server";
import { serializeRoutePolicyState } from "./earn-state-serializers.server";
import type { EarnCleanupVaultState } from "./yield-deposit-repository.server";

export class EarnCleanupConfirmError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EarnCleanupConfirmError";
    this.status = status;
    this.code = code;
  }
}

function retryableVerificationError(error: unknown): EarnCleanupConfirmError {
  return new EarnCleanupConfirmError(
    503,
    "full_exit_verification_retryable",
    error instanceof Error
      ? error.message
      : "Earn cleanup could not be verified. Retry confirmation."
  );
}

export async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<bigint> {
  try {
    const { value } = await args.connection.getSignatureStatuses(
      [args.signature],
      { searchTransactionHistory: true }
    );
    const status = value[0] ?? null;
    if (status?.err) {
      throw new EarnCleanupConfirmError(
        400,
        "cleanup_transaction_failed",
        "Earn cleanup transaction failed on-chain."
      );
    }
    if (
      typeof status?.slot === "number" &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      return BigInt(status.slot);
    }

    const transaction = await args.connection.getTransaction(args.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction?.meta?.err) {
      throw new EarnCleanupConfirmError(
        400,
        "cleanup_transaction_failed",
        "Earn cleanup transaction failed on-chain."
      );
    }
    if (typeof transaction?.slot === "number") {
      return BigInt(transaction.slot);
    }

    throw new EarnCleanupConfirmError(
      503,
      "full_exit_verification_retryable",
      "Confirmed transaction slot is unavailable."
    );
  } catch (error) {
    if (error instanceof EarnCleanupConfirmError) {
      throw error;
    }
    throw retryableVerificationError(error);
  }
}

export async function verifyPolicyAccountsClosed(args: {
  accounts: string[];
  connection: Connection;
  minContextSlot: number;
}): Promise<void> {
  try {
    const { context, value } =
      await args.connection.getMultipleAccountsInfoAndContext(
        args.accounts.map((account) => new PublicKey(account)),
        { commitment: "confirmed", minContextSlot: args.minContextSlot }
      );
    if (context.slot < args.minContextSlot) {
      throw new EarnCleanupConfirmError(
        503,
        "full_exit_verification_retryable",
        "Earn policy close proof was observed before the cleanup confirmation slot."
      );
    }
    if (value.some((account) => account !== null)) {
      throw new EarnCleanupConfirmError(
        503,
        "full_exit_verification_retryable",
        "One or more Earn policy accounts remain open on-chain."
      );
    }
  } catch (error) {
    if (error instanceof EarnCleanupConfirmError) {
      throw error;
    }
    throw retryableVerificationError(error);
  }
}

export async function assertEarnFullExitProven(args: {
  cleanupState: Pick<EarnCleanupVaultState, "routePolicy" | "setupPolicy">;
  cluster: LoyalCluster;
  connection: Connection;
  minContextSlot: number;
  policyAccounts: string[];
  programId: PublicKey;
  settingsPda: PublicKey;
}): Promise<void> {
  try {
    const proof = await verifyEarnFullExitZeroBalances({
      cluster: args.cluster,
      connection: args.connection,
      minContextSlot: args.minContextSlot,
      policy: serializeRoutePolicyState(
        args.cleanupState.routePolicy,
        args.cleanupState.setupPolicy
      ),
      programId: args.programId,
      settingsPda: args.settingsPda,
    });
    if (proof.status !== "policy_close_required") {
      throw new EarnCleanupConfirmError(
        409,
        "full_exit_incomplete",
        "Earn balances remain after cleanup; the position stays active."
      );
    }

    await verifyPolicyAccountsClosed({
      accounts: args.policyAccounts,
      connection: args.connection,
      minContextSlot: args.minContextSlot,
    });
  } catch (error) {
    if (error instanceof EarnCleanupConfirmError) {
      throw error;
    }
    throw retryableVerificationError(error);
  }
}
