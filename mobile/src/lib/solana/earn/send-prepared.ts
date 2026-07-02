import {
  ComputeBudgetProgram,
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

// Earn txs carried NO priority fee, so under network load they'd sit unincluded
// until the blockhash expired ("Signature has expired"). A modest priority fee
// lets them compete for block space. We don't set a compute-unit LIMIT (the
// prepared instructions don't, and their default has been landing), so the
// per-tx fee stays well under ~0.0002 SOL.
const PRIORITY_FEE_MICRO_LAMPORTS = 100_000;
// Solana's max serialized transaction size. The backend prepares txs up to this
// limit, so prepending the priority-fee instruction (~44 bytes) can push a fat
// first-deposit tx over it — Seed Vault then refuses to sign (result=1007) and
// the RPC would reject it anyway. When that happens, send without the fee:
// landing slowly beats not signing at all.
const MAX_TRANSACTION_BYTES = 1232;
// How often to re-broadcast the signed tx while waiting for confirmation.
const REBROADCAST_INTERVAL_MS = 2000;

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

// Waits for confirmation and resolves the landing slot for the read-model.
// Tolerant of RPC propagation lag and false blockheight-expiries (a WS
// notification missed for a tx that actually landed).
async function confirmSentTransaction(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<SentTransaction> {
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
    // strategy gave up — the signature status is the source of truth, so check
    // it before failing.
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

  const slot = await pollConfirmedSlot(
    connection,
    signature,
    CONFIRMED_SLOT_MAX_ATTEMPTS,
  );
  return { signature, confirmedSlot: slot ?? String(contextSlot) };
}

// Compiles a hydrated prepared operation into a v0 transaction, signs it with
// the device wallet, sends it (with a priority fee + rebroadcast so it lands
// under load), and waits for confirmation. The wallet may prompt (Seed Vault)
// for each operation, so callers send stages sequentially.
export async function signAndSendPreparedOperation(args: {
  connection: Connection;
  signer: Signer;
  operation: HydratedPreparedOperation;
}): Promise<SentTransaction> {
  const { connection, signer, operation } = args;
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const compile = (withPriorityFee: boolean) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: operation.payer,
        recentBlockhash: blockhash,
        instructions: withPriorityFee
          ? [
              ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
              }),
              ...operation.instructions,
            ]
          : operation.instructions,
      }).compileToV0Message(operation.lookupTableAccounts),
    );
  let transaction = compile(true);
  if (transaction.serialize().length > MAX_TRANSACTION_BYTES) {
    transaction = compile(false);
  }
  await signer.signTransaction(transaction);
  const rawTransaction = transaction.serialize();
  // First send runs preflight so a genuinely invalid tx fails fast; resends skip
  // it. `maxRetries: 0` — we own the rebroadcast cadence below, not the RPC.
  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 0,
  });

  // Under load, RPCs drop a pending tx and `confirmTransaction` never re-sends —
  // it just waits out the blockhash and reports expiry. Re-broadcast the signed
  // raw tx every couple seconds (in parallel with confirmation) so it stays in
  // front of leaders until it lands.
  let rebroadcasting = true;
  const rebroadcast = (async () => {
    while (rebroadcasting) {
      await delay(REBROADCAST_INTERVAL_MS);
      if (!rebroadcasting) {
        return;
      }
      try {
        await connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch {
        // Best-effort — the confirmation path below is the source of truth.
      }
    }
  })();

  try {
    return await confirmSentTransaction(
      connection,
      signature,
      blockhash,
      lastValidBlockHeight,
    );
  } finally {
    rebroadcasting = false;
    await rebroadcast.catch(() => undefined);
  }
}
