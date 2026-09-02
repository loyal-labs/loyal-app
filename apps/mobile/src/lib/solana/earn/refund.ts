import {
  normalizeLoyalCluster,
  SUBSCRIPTIONS_PROGRAM_ID,
  subscriptionRevokeDelegationData,
} from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import {
  type EarnRefundPrepareRequest,
  type EarnRefundScanResponse,
  fetchEarnAutodepositState,
  fetchEarnState,
} from "./earn-api";
import { signAndSendPreparedOperations } from "./send-prepared";

export type EarnRefundResult = {
  signature: string;
};

function blockedReason(args: {
  activeAutodeposit: boolean;
  activeAutoswap: boolean;
  activePosition: boolean;
  automationStateAuthoritative: boolean;
  protectedPolicy: boolean;
}): string | null {
  if (args.activePosition) {
    return "Active Earn position";
  }
  if (!args.automationStateAuthoritative) {
    return "Autoswap state is still syncing";
  }
  if (args.activeAutodeposit) {
    return "Active Autodeposit policy";
  }
  if (args.activeAutoswap) {
    return "Active Autoswap policy";
  }
  if (args.protectedPolicy) {
    return "Active Earn vault policy";
  }
  return null;
}

// Scan public chain accounts on-device. The state endpoint contributes only
// product activity identities that cannot be inferred from immutable account
// bytes (for example whether an Autoswap pair is still enrolled); candidate
// discovery, ownership checks, and refund classification happen here.
export async function scanEarnRefunds(
  walletAddress: string
): Promise<EarnRefundScanResponse> {
  const [state, autodepositState] = await Promise.all([
    fetchEarnState(walletAddress),
    fetchEarnAutodepositState(walletAddress),
  ]);
  if (!(state.settingsPda && state.smartAccountAddress)) {
    return {
      cluster: state.cluster,
      programId: state.programId,
      scan: null,
    };
  }

  const connection = getConnection();
  const wallet = new PublicKey(walletAddress);
  const settingsPda = new PublicKey(state.settingsPda);
  const cluster = normalizeLoyalCluster(state.cluster);
  const client = createSmartAccountVaultsClient({
    connection,
    programId: new PublicKey(state.programId),
  });
  const [candidates, vaultSnapshot] = await Promise.all([
    client.fetchEarnRefundCandidates({
      cluster,
      settingsPda,
      walletAddress: wallet,
    }),
    client.fetchEarnVaultRefundSnapshot({ cluster, settingsPda }),
  ]);
  if (!candidates.vaultPda.equals(vaultSnapshot.vaultPda)) {
    throw new Error(
      "Refund inventory does not match the connected Earn vault."
    );
  }

  const activePosition =
    state.position !== null ||
    vaultSnapshot.tokenAccounts.some(
      (account) => !account.isUsdc && account.amountRaw > BigInt(0)
    );
  const activeAutodepositPolicy =
    autodepositState.autodeposit?.policyAccount ?? null;
  const activeRecurringDelegation =
    autodepositState.autodeposit?.recurringDelegation ?? null;
  const activeAutoswapPolicies = new Set(state.autoswapPolicyAccounts);
  const protectedPolicies = new Set(state.protectedPolicyAccounts);
  const automationStateAuthoritative = state.autoswapStateAuthoritative;

  const policies = candidates.policies.map((candidate) => {
    const account = candidate.account.toBase58();
    const reason = blockedReason({
      activeAutodeposit: account === activeAutodepositPolicy,
      activeAutoswap: activeAutoswapPolicies.has(account),
      activePosition,
      automationStateAuthoritative,
      protectedPolicy: protectedPolicies.has(account),
    });
    return {
      account,
      accountIndex: candidate.accountIndex,
      blockedReason: reason,
      canRefund: reason === null,
      lamports: candidate.lamports,
      seed: candidate.seed.toString(),
    };
  });
  const recurringDelegations = candidates.recurringDelegations.map(
    (candidate) => {
      const account = candidate.account.toBase58();
      const reason =
        account === activeRecurringDelegation
          ? "Active Autodeposit recurring delegation"
          : !automationStateAuthoritative
          ? "Autoswap state is still syncing"
          : null;
      return {
        account,
        blockedReason: reason,
        canRefund: reason === null,
        lamports: candidate.lamports,
      };
    }
  );
  const totalRefundableLamports =
    Number(vaultSnapshot.lamports) +
    vaultSnapshot.tokenAccounts.reduce(
      (sum, account) => sum + account.lamports,
      0
    );
  const vaultReason = blockedReason({
    activeAutodeposit: activeAutodepositPolicy !== null,
    activeAutoswap: activeAutoswapPolicies.size > 0,
    activePosition,
    automationStateAuthoritative,
    protectedPolicy: protectedPolicies.size > 0,
  });

  return {
    cluster: state.cluster,
    programId: state.programId,
    scan: {
      policies,
      recurringDelegations,
      settingsPda: state.settingsPda,
      vault: {
        account: vaultSnapshot.vaultPda.toBase58(),
        accountIndex: 1,
        blockedReason: vaultReason,
        canRefund: vaultReason === null && totalRefundableLamports > 0,
        lamports: Number(vaultSnapshot.lamports),
        totalRefundableLamports,
      },
    },
  };
}

// Re-scan immediately before preparing so a stale activity row cannot close an
// account that became active after it was rendered. Every actual transaction
// is then built, submitted, and confirmed on-device.
export async function executeEarnRefund(args: {
  signer: Signer;
  request: EarnRefundPrepareRequest;
}): Promise<EarnRefundResult> {
  const { cluster, programId, scan } = await scanEarnRefunds(
    args.signer.publicKey.toBase58()
  );
  if (!(scan && cluster && programId)) {
    throw new Error("Refund context is unavailable. Refresh and try again.");
  }
  const client = createSmartAccountVaultsClient({
    connection: getConnection(),
    programId: new PublicKey(programId),
  });
  const settingsPda = new PublicKey(scan.settingsPda);
  const request = args.request;
  let prepared;
  if (request.kind === "vault") {
    if (!scan.vault?.canRefund) {
      throw new Error(
        scan.vault?.blockedReason ?? "Earn vault is not refundable."
      );
    }
    prepared = (
      await client.prepareEarnVaultAccountsRefund({
        cluster: normalizeLoyalCluster(cluster),
        feePayer: args.signer.publicKey,
        settingsPda,
        walletAddress: args.signer.publicKey,
      })
    ).prepared;
  } else if (request.kind === "policy") {
    const policy = scan.policies.find(
      (candidate) => candidate.account === request.policyAccount
    );
    if (!policy?.canRefund) {
      throw new Error(
        policy?.blockedReason ?? "Earn policy is not refundable."
      );
    }
    prepared = await client.prepareClosePoliciesSync({
      feePayer: args.signer.publicKey,
      policies: [new PublicKey(policy.account)],
      settingsPda,
      signers: [args.signer.publicKey],
    });
  } else {
    const delegation = scan.recurringDelegations.find(
      (candidate) => candidate.account === request.recurringDelegation
    );
    if (!delegation?.canRefund) {
      throw new Error(
        delegation?.blockedReason ?? "Recurring delegation is not refundable."
      );
    }
    prepared = {
      instructions: [
        new TransactionInstruction({
          data: Buffer.from(subscriptionRevokeDelegationData()),
          keys: [
            {
              isSigner: true,
              isWritable: true,
              pubkey: args.signer.publicKey,
            },
            {
              isSigner: false,
              isWritable: true,
              pubkey: new PublicKey(delegation.account),
            },
          ],
          programId: SUBSCRIPTIONS_PROGRAM_ID,
        }),
      ],
      lookupTableAccounts: [],
      operation: "earnRecurringDelegationRentRefund",
      payer: args.signer.publicKey,
      programId: SUBSCRIPTIONS_PROGRAM_ID,
      requiresConfirmation: true,
    };
  }

  const [sent] = await signAndSendPreparedOperations({
    connection: getConnection(),
    signer: args.signer,
    operations: [prepared],
  });
  return { signature: sent.signature };
}
