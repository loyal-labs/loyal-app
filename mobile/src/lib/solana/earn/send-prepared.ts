import {
  type Connection,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import type { Signer } from "@/lib/wallet/signer";

import type { HydratedPreparedOperation } from "./wire";

export type SentTransaction = { signature: string; confirmedSlot: string };

async function resolveConfirmedSlot(
  connection: Connection,
  signature: string,
): Promise<string> {
  const { value } = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const status = value[0];
  if (
    !status ||
    status.err ||
    (status.confirmationStatus !== "confirmed" &&
      status.confirmationStatus !== "finalized") ||
    typeof status.slot !== "number"
  ) {
    throw new Error("Transaction is not confirmed.");
  }
  return String(status.slot);
}

// Compiles a hydrated prepared operation into a v0 transaction, signs it with
// the device wallet, sends it, and waits for confirmation. The wallet may prompt
// (Seed Vault) for each operation, so callers send stages sequentially.
export async function signAndSendPreparedOperation(args: {
  connection: Connection;
  signer: Signer;
  operation: HydratedPreparedOperation;
}): Promise<SentTransaction> {
  const { connection, signer, operation } = args;
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: operation.payer,
    recentBlockhash: blockhash,
    instructions: operation.instructions,
  }).compileToV0Message(operation.lookupTableAccounts);
  const transaction = new VersionedTransaction(message);
  await signer.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false },
  );
  await connection.confirmTransaction(
    { blockhash, lastValidBlockHeight, signature },
    "confirmed",
  );
  const confirmedSlot = await resolveConfirmedSlot(connection, signature);
  return { signature, confirmedSlot };
}
