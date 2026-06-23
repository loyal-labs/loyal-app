import { compilePreparedOperation } from "@loyal-labs/loyal-smart-accounts-core";
import { VersionedTransaction } from "@solana/web3.js";
import type {
  SendPreparedBatchWithWalletArgs,
  SendPreparedWithWalletArgs,
  WalletAdapterLike,
} from "./types";

async function sendVersionedTransaction(args: {
  wallet: WalletAdapterLike;
  connection: SendPreparedWithWalletArgs["connection"];
  transaction: VersionedTransaction;
  sendOptions?: SendPreparedWithWalletArgs["sendOptions"];
}): Promise<string> {
  if (args.wallet.sendTransaction) {
    return args.wallet.sendTransaction(
      args.transaction,
      args.connection,
      args.sendOptions
    );
  }

  const signed = await args.wallet.signTransaction(args.transaction);
  return args.connection.sendRawTransaction(
    signed.serialize(),
    args.sendOptions
  );
}

export async function sendPreparedWithWallet({
  connection,
  wallet,
  prepared,
  confirm = "if-required",
  sendOptions,
}: SendPreparedWithWalletArgs): Promise<string> {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    prepared,
    blockhash: latestBlockhash.blockhash,
  });
  const signature = await sendVersionedTransaction({
    wallet,
    connection,
    transaction,
    sendOptions,
  });
  const shouldConfirm =
    confirm === true || (confirm !== false && prepared.requiresConfirmation);

  if (shouldConfirm) {
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );

    if (confirmation.value.err) {
      throw new Error(
        `Transaction ${signature} failed to confirm: ${JSON.stringify(
          confirmation.value.err
        )}`
      );
    }
  }

  return signature;
}

export async function sendPreparedBatchWithWallet({
  connection,
  wallet,
  prepared,
  confirm = "if-required",
  sendOptions,
  onTransactionConfirmed,
  onTransactionSent,
}: SendPreparedBatchWithWalletArgs): Promise<string[]> {
  if (!wallet.signAllTransactions) {
    throw new Error("Connected wallet does not support signAllTransactions.");
  }
  if (prepared.length === 0) {
    return [];
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transactions = prepared.map((operation) =>
    compilePreparedOperation({
      prepared: operation,
      blockhash: latestBlockhash.blockhash,
    })
  );
  const signedTransactions = await wallet.signAllTransactions(transactions);
  if (signedTransactions.length !== prepared.length) {
    throw new Error("Signed transaction count does not match prepared count.");
  }
  const signatures: string[] = [];

  for (const [index, signedTransaction] of signedTransactions.entries()) {
    const operation = prepared[index];
    if (!operation) {
      throw new Error("Signed transaction count does not match prepared count.");
    }

    const signature = await connection.sendRawTransaction(
      signedTransaction.serialize(),
      sendOptions
    );
    signatures.push(signature);
    await onTransactionSent?.({
      index,
      prepared: operation,
      signature,
    });

    const shouldConfirm =
      confirm === true ||
      (confirm !== false && operation.requiresConfirmation);

    if (shouldConfirm) {
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(
          `Transaction ${signature} failed to confirm: ${JSON.stringify(
            confirmation.value.err
          )}`
        );
      }
    }

    await onTransactionConfirmed?.({
      index,
      prepared: operation,
      signature,
    });
  }

  return signatures;
}

export function isWalletAdapterLike(
  value: unknown
): value is WalletAdapterLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "publicKey" in value &&
      "signTransaction" in value &&
      typeof (value as WalletAdapterLike).signTransaction === "function"
  );
}
