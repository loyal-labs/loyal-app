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
  requireRecurringDelegation: boolean;
  smartAccountsProgramId: PublicKey;
}) {
  const probe = await probeEarnAutodepositArtifacts(args);

  if (!probe.policy.exists) {
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
