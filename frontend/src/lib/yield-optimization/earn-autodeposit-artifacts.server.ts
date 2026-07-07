import "server-only";

import { SUBSCRIPTIONS_PROGRAM_ID } from "@loyal-labs/actions";
import { Connection, PublicKey } from "@solana/web3.js";

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
