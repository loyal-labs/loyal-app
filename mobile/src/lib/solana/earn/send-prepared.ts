import {
  type Connection,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import type { Signer } from "@/lib/wallet/signer";

import type { HydratedPreparedOperation } from "./wire";

export type SentTransaction = { signature: string; confirmedSlot: string };

// `confirmTransaction` (WebSocket/blockheight strategy) and a follow-up
// `getSignatureStatuses` read can land on different load-balanced RPC nodes, so
// the status read can briefly lag behind ("processed"/null) for a tx that is
// already confirmed. Re-read a few times before giving up so an already-landed
// transaction is never reported as failed.
const CONFIRMED_SLOT_MAX_ATTEMPTS = 8;
const CONFIRMED_SLOT_RETRY_MS = 600;
// Same lag can follow a (possibly false) blockheight-expiry — give the status a
// few quick reads before surfacing the expiry.
const POST_EXPIRY_ATTEMPTS = 3;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// One status read. Returns the landing slot when confirmed/finalized, null when
// the node hasn't caught up yet, and throws only on a real on-chain failure.
async function readConfirmedSlot(
  connection: Connection,
  signature: string,
): Promise<string | null> {
  const { value } = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const status = value[0];
  if (status?.err) {
    throw new Error("Transaction failed on-chain.");
  }
  if (
    status &&
    typeof status.slot === "number" &&
    (status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized")
  ) {
    return String(status.slot);
  }
  return null;
}

// Polls the signature status up to `attempts` times, tolerating RPC propagation
// lag. Returns the landing slot, or null if it never reads as confirmed.
async function pollConfirmedSlot(
  connection: Connection,
  signature: string,
  attempts: number,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const slot = await readConfirmedSlot(connection, signature);
    if (slot !== null) {
      return slot;
    }
    if (attempt < attempts - 1) {
      await delay(CONFIRMED_SLOT_RETRY_MS);
    }
  }
  return null;
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

  let contextSlot: number | null = null;
  try {
    const confirmation = await connection.confirmTransaction(
      { blockhash, lastValidBlockHeight, signature },
      "confirmed",
    );
    if (confirmation.value.err) {
      throw new Error("Transaction failed on-chain.");
    }
    contextSlot = confirmation.context.slot;
  } catch (error) {
    // A real on-chain failure must surface as-is. Otherwise the blockheight
    // strategy gave up (it can throw a *false* expiry when the WS confirmation
    // notification is missed for a tx that actually landed) — the signature
    // status is the source of truth, so check it before failing.
    if (
      error instanceof Error &&
      error.message === "Transaction failed on-chain."
    ) {
      throw error;
    }
    const slot = await pollConfirmedSlot(
      connection,
      signature,
      POST_EXPIRY_ATTEMPTS,
    );
    if (slot !== null) {
      return { signature, confirmedSlot: slot };
    }
    throw error;
  }

  // Confirmed by the strategy. Resolve the landing slot for the read-model,
  // tolerating propagation lag; if the status read never catches up, fall back
  // to the confirmation slot rather than failing an already-confirmed tx.
  const slot = await pollConfirmedSlot(
    connection,
    signature,
    CONFIRMED_SLOT_MAX_ATTEMPTS,
  );
  return { signature, confirmedSlot: slot ?? String(contextSlot) };
}
