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

import { fetchEarnRefundScan, type EarnRefundPrepareRequest } from "./earn-api";
import { signAndSendPreparedOperations } from "./send-prepared";

export type EarnRefundResult = {
  signature: string;
};

// Build and execute one rent refund on-device. The passive scan is only an
// authenticated product/read-model guard; the SDK re-reads the public chain
// accounts that determine the actual close/refund transaction.
export async function executeEarnRefund(args: {
  signer: Signer;
  request: EarnRefundPrepareRequest;
}): Promise<EarnRefundResult> {
  const { cluster, programId, scan } = await fetchEarnRefundScan(
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
