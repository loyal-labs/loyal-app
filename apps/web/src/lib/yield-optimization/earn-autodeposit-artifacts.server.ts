import "server-only";

import {
  resolveLoyalClusterForSolanaEnv,
  SUBSCRIPTIONS_PROGRAM_ID,
} from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";

import { getDeploymentPolicySignerPublicKey } from "./deployment-policy-signer.server";
import {
  backfillAutodepositTargetStageProofs,
  type AutodepositStageProof,
  type BalanceSweepTargetRecord,
} from "./earn-autodeposit-repository.server";

type AutodepositArtifactProbeAccount = {
  exists: boolean;
  invalidOwner: string | null;
};

export type EarnAutodepositArtifactProbe = {
  policy: AutodepositArtifactProbeAccount;
  recurringDelegation: AutodepositArtifactProbeAccount;
};

const AUTODEPOSIT_ARTIFACT_RETRY_ATTEMPTS = 8;
const AUTODEPOSIT_ARTIFACT_RETRY_DELAY_MS = 350;

function waitForAutodepositArtifactRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function isRetryableEarnAutodepositArtifactError(
  error: unknown
): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /does not exist|not found|unable to find|unavailable/i.test(message);
}

export async function withEarnAutodepositArtifactRetry<T>(
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < AUTODEPOSIT_ARTIFACT_RETRY_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (
        !isRetryableEarnAutodepositArtifactError(error) ||
        attempt === AUTODEPOSIT_ARTIFACT_RETRY_ATTEMPTS - 1
      ) {
        throw error;
      }

      await waitForAutodepositArtifactRetry(
        AUTODEPOSIT_ARTIFACT_RETRY_DELAY_MS
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Autodeposit artifact verification failed.");
}

function probeAccount(
  account: Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>[number],
  expectedOwner: PublicKey
): AutodepositArtifactProbeAccount {
  if (!account) {
    return { exists: false, invalidOwner: null };
  }

  return {
    exists: true,
    invalidOwner: account.owner.equals(expectedOwner)
      ? null
      : account.owner.toBase58(),
  };
}

export async function probeEarnAutodepositArtifacts(args: {
  connection: Connection;
  policyAccount: string;
  recurringDelegation: string;
  smartAccountsProgramId: PublicKey;
}): Promise<EarnAutodepositArtifactProbe> {
  const [policyAccountInfo, recurringDelegationInfo] =
    await args.connection.getMultipleAccountsInfo(
      [
        new PublicKey(args.policyAccount),
        new PublicKey(args.recurringDelegation),
      ],
      "confirmed"
    );

  return {
    policy: probeAccount(policyAccountInfo, args.smartAccountsProgramId),
    recurringDelegation: probeAccount(
      recurringDelegationInfo,
      SUBSCRIPTIONS_PROGRAM_ID
    ),
  };
}

// One RPC page is far beyond any fresh artifact's transaction history at heal
// time — these accounts are read right after (attempted) setup.
const AUTODEPOSIT_PROOF_SIGNATURE_PAGE_LIMIT = 1000;

// Oldest successful transaction that touched the account. For an autodeposit
// artifact that is its creating transaction — exactly the signature/slot the
// lost confirm would have recorded.
async function resolveArtifactCreationProof(
  connection: Connection,
  account: string
): Promise<AutodepositStageProof | null> {
  const signatures = await connection.getSignaturesForAddress(
    new PublicKey(account),
    { limit: AUTODEPOSIT_PROOF_SIGNATURE_PAGE_LIMIT },
    "confirmed"
  );

  for (let index = signatures.length - 1; index >= 0; index -= 1) {
    const entry = signatures[index];
    if (entry.err === null) {
      return {
        confirmedSlot: BigInt(entry.slot),
        signature: entry.signature,
      };
    }
  }

  return null;
}

// Heals a pending target whose stage transaction landed on-chain while its
// confirm never reached the DB: the flow died in between, and retries skip
// already-existing stages, so the proof is never re-posted — leaving the row
// permanently unable to satisfy the recorded-proof promotion guard. When BOTH
// artifacts verify against the canonical derivation (same check the session
// confirm route runs), the missing signature/slot is backfilled from chain
// history so promotion can proceed on the same read.
//
// Best-effort by design: any verification or lookup failure returns null and
// must never break the state read. Returns the updated target, or null when
// nothing was (or could be) healed.
export async function healPendingEarnAutodepositArtifactProofs(args: {
  connection: Connection;
  smartAccountsProgramId: PublicKey;
  target: BalanceSweepTargetRecord;
}): Promise<BalanceSweepTargetRecord | null> {
  const { target } = args;
  const missingPolicyProof =
    target.policySignature == null || target.policyConfirmedSlot == null;
  const missingDelegationProof =
    target.recurringDelegationSignature == null ||
    target.recurringDelegationConfirmedSlot == null;

  if (!missingPolicyProof && !missingDelegationProof) {
    return null;
  }
  const nonce = target.recurringDelegationNonce;
  if (!target.recurringDelegation || nonce == null) {
    // Without the recorded nonce the delegation PDA cannot be re-derived, so
    // the artifacts cannot be verified as this target's — do not backfill.
    return null;
  }

  try {
    const vaultsClient = createSmartAccountVaultsClient({
      connection: args.connection,
      programId: args.smartAccountsProgramId,
    });
    await vaultsClient.assertEarnUsdcAutodepositCanonicalArtifacts({
      amountRaw: target.maxAmountPerPeriod,
      cluster: resolveLoyalClusterForSolanaEnv(
        resolveLoyalWebSolanaEnvFromEnv(process.env)
      ),
      nonce,
      policy: new PublicKey(target.policyAccount),
      policySeed: target.policySeed,
      policySigner: getDeploymentPolicySignerPublicKey(),
      recurringDelegation: new PublicKey(target.recurringDelegation),
      settingsPda: new PublicKey(target.settings),
      walletAddress: new PublicKey(target.wallet),
    });

    const [policyProof, recurringDelegationProof] = await Promise.all([
      missingPolicyProof
        ? resolveArtifactCreationProof(args.connection, target.policyAccount)
        : Promise.resolve(null),
      missingDelegationProof
        ? resolveArtifactCreationProof(
            args.connection,
            target.recurringDelegation
          )
        : Promise.resolve(null),
    ]);
    if (!policyProof && !recurringDelegationProof) {
      return null;
    }

    return await backfillAutodepositTargetStageProofs({
      policyAccount: target.policyAccount,
      policyProof,
      recurringDelegationProof,
      settings: target.settings,
      vaultIndex: target.vaultIndex,
      walletAddress: target.wallet,
    });
  } catch (error) {
    console.warn("[earn-autodeposit] artifact proof heal skipped", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown heal error.",
      policyAccount: target.policyAccount,
      wallet: target.wallet,
    });
    return null;
  }
}

export async function assertEarnAutodepositArtifactsExist(args: {
  connection: Connection;
  policyAccount: string;
  recurringDelegation: string;
  requirePolicy?: boolean;
  requireRecurringDelegation: boolean;
  smartAccountsProgramId: PublicKey;
}) {
  const probe = await probeEarnAutodepositArtifacts(args);

  const requirePolicy = args.requirePolicy ?? true;
  if (requirePolicy && !probe.policy.exists) {
    throw new Error("Confirmed Autodeposit policy account does not exist.");
  }
  if (probe.policy.invalidOwner) {
    throw new Error("Confirmed Autodeposit policy has an unexpected owner.");
  }

  if (!args.requireRecurringDelegation) {
    return probe;
  }

  if (!probe.recurringDelegation.exists) {
    throw new Error(
      "Confirmed Autodeposit recurring delegation account does not exist."
    );
  }
  if (probe.recurringDelegation.invalidOwner) {
    throw new Error(
      "Confirmed Autodeposit recurring delegation has an unexpected owner."
    );
  }

  return probe;
}
