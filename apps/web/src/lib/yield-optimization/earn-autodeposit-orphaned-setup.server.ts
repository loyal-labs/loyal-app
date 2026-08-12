import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";

import {
  activateAutodepositTargetWithBackfilledSetup,
  findCurrentEarnAutodepositState,
  type BalanceSweepTargetRecord,
} from "./earn-autodeposit-repository.server";

/**
 * Heal for the orphaned-setup trap: the SDK's setup prepare throws when the
 * policy, recurring delegation, AND token approval all already exist on-chain
 * (nothing left to sign). That state is reachable when the on-chain setup
 * succeeded but the stage confirms were lost in flight, leaving the target
 * row stuck in a pending lifecycle — the app then shows the Create sheet and
 * every retry rethrows, which is user-unrecoverable (e.g. wallet BgFJ…syuk,
 * target 779: policy created Jul 8, confirm never landed). The heal backfills
 * the lost confirmations from chain history and activates the row, so prepare
 * can answer with the existing `autodeposit_already_active` contract.
 */

// Thrown by prepareEarnUsdcAutodepositSetup in @loyal-labs/smart-account-vaults
// when every setup artifact already exists on-chain.
const AUTODEPOSIT_SETUP_ALREADY_COMPLETE_MESSAGE =
  "Autodeposit policy and recurring delegation already exist.";

export function isAutodepositSetupAlreadyCompleteError(
  error: unknown
): boolean {
  return (
    error instanceof Error &&
    error.message === AUTODEPOSIT_SETUP_ALREADY_COMPLETE_MESSAGE
  );
}

// Pagination guard; setup accounts of a pending target have a handful of
// transactions (no sweeps ever ran), so one page is the norm.
const MAX_SIGNATURE_PAGES = 20;

// Oldest successful transaction touching `address` = its creation. Pages run
// newest -> oldest, so keep overwriting with each page's last non-failed
// entry.
async function findCreationSignature(
  connection: Connection,
  address: string
): Promise<{ signature: string; slot: bigint } | null> {
  let before: string | undefined;
  let oldest: { signature: string; slot: bigint } | null = null;
  for (let page = 0; page < MAX_SIGNATURE_PAGES; page++) {
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(address),
      { before, limit: 1000 },
      "confirmed"
    );
    if (signatures.length === 0) {
      break;
    }
    for (const entry of signatures) {
      if (!entry.err) {
        oldest = { signature: entry.signature, slot: BigInt(entry.slot) };
      }
    }
    before = signatures[signatures.length - 1]?.signature;
    if (signatures.length < 1000) {
      break;
    }
  }
  return oldest;
}

/**
 * Backfills lost setup confirmations from chain history and activates the
 * target. Call only after the SDK reported the setup fully exists on-chain
 * (see isAutodepositSetupAlreadyCompleteError). Returns the activated target,
 * or null when there is nothing to heal (no pending row, or chain history
 * could not supply the missing confirmations) — callers fall back to their
 * existing error path.
 */
export async function activateOrphanedEarnAutodepositSetup(args: {
  connection: Connection;
  settings: string;
  vaultIndex: 1;
  walletAddress: string;
}): Promise<BalanceSweepTargetRecord | null> {
  const current = await findCurrentEarnAutodepositState({
    settings: args.settings,
    vaultIndex: args.vaultIndex,
    walletAddress: args.walletAddress,
  });
  const target = current?.target;
  if (
    !target ||
    (target.lifecycleStatus !== "pending_policy" &&
      target.lifecycleStatus !== "pending_delegation")
  ) {
    return null;
  }

  const policyConfirmation =
    target.policySignature && target.policyConfirmedSlot != null
      ? {
          signature: target.policySignature,
          slot: target.policyConfirmedSlot,
        }
      : await findCreationSignature(args.connection, target.policyAccount);
  if (!policyConfirmation) {
    return null;
  }

  let delegationConfirmation: { signature: string; slot: bigint } | null =
    target.recurringDelegationSignature &&
    target.recurringDelegationConfirmedSlot != null
      ? {
          signature: target.recurringDelegationSignature,
          slot: target.recurringDelegationConfirmedSlot,
        }
      : null;
  if (!delegationConfirmation && target.recurringDelegation) {
    delegationConfirmation = await findCreationSignature(
      args.connection,
      target.recurringDelegation
    );
  }
  if (!delegationConfirmation) {
    return null;
  }

  const activated = await activateAutodepositTargetWithBackfilledSetup({
    policyAccount: target.policyAccount,
    policyConfirmedSlot: policyConfirmation.slot,
    policySignature: policyConfirmation.signature,
    recurringDelegationConfirmedSlot: delegationConfirmation.slot,
    recurringDelegationSignature: delegationConfirmation.signature,
    settings: args.settings,
    vaultIndex: args.vaultIndex,
    walletAddress: args.walletAddress,
  });
  return activated?.lifecycleStatus === "active" && activated.active
    ? activated
    : null;
}
