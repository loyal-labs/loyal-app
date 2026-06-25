import {
  SolanaTransactionLogError,
  compilePreparedOperation,
  translateAndThrowAnchorError,
} from "@loyal-labs/loyal-smart-accounts-core";
import { VersionedTransaction } from "@solana/web3.js";
import type {
  SendPreparedBatchWithWalletArgs,
  SendPreparedWithWalletArgs,
  WalletAdapterLike,
} from "./types";

function isInsufficientSolTopUpError(
  error: unknown
): error is SolanaTransactionLogError {
  return (
    error instanceof SolanaTransactionLogError &&
    error.message.includes("Top up at least")
  );
}

function translateSimulationLogs(
  logs: readonly string[] | null | undefined
): SolanaTransactionLogError | null {
  if (!logs?.length) {
    return null;
  }

  try {
    translateAndThrowAnchorError(
      Object.assign(new Error("Transaction simulation failed."), {
        logs: [...logs],
      })
    );
  } catch (error) {
    return isInsufficientSolTopUpError(error) ? error : null;
  }

  return null;
}

async function getPostFailureSimulationError(args: {
  connection: SendPreparedWithWalletArgs["connection"];
  transaction: VersionedTransaction;
}): Promise<SolanaTransactionLogError | null> {
  try {
    const simulation = await args.connection.simulateTransaction(
      args.transaction,
      {
        commitment: "confirmed",
        replaceRecentBlockhash: true,
        sigVerify: false,
      }
    );

    return translateSimulationLogs(simulation.value.logs);
  } catch {
    return null;
  }
}

async function getFirstPostFailureSimulationError(args: {
  connection: SendPreparedWithWalletArgs["connection"];
  transactions: readonly VersionedTransaction[];
}): Promise<SolanaTransactionLogError | null> {
  for (const transaction of args.transactions) {
    const simulationError = await getPostFailureSimulationError({
      connection: args.connection,
      transaction,
    });
    if (simulationError) {
      return simulationError;
    }
  }

  return null;
}

async function throwPostFailureSimulationErrorOrOriginal(args: {
  connection: SendPreparedWithWalletArgs["connection"];
  originalError: unknown;
  transaction: VersionedTransaction;
}): Promise<never> {
  const simulationError = await getPostFailureSimulationError({
    connection: args.connection,
    transaction: args.transaction,
  });

  throw simulationError ?? args.originalError;
}

async function throwFirstPostFailureSimulationErrorOrOriginal(args: {
  connection: SendPreparedWithWalletArgs["connection"];
  originalError: unknown;
  transactions: readonly VersionedTransaction[];
}): Promise<never> {
  const simulationError = await getFirstPostFailureSimulationError({
    connection: args.connection,
    transactions: args.transactions,
  });

  throw simulationError ?? args.originalError;
}

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
  }).catch((error) =>
    throwPostFailureSimulationErrorOrOriginal({
      connection,
      originalError: error,
      transaction,
    })
  );
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
      const error = new Error(
        `Transaction ${signature} failed to confirm: ${JSON.stringify(
          confirmation.value.err
        )}`
      );
      await throwPostFailureSimulationErrorOrOriginal({
        connection,
        originalError: error,
        transaction,
      });
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
  const signedTransactions = await wallet
    .signAllTransactions(transactions)
    .catch((error) =>
      throwFirstPostFailureSimulationErrorOrOriginal({
        connection,
        originalError: error,
        transactions,
      })
    );
  if (signedTransactions.length !== prepared.length) {
    throw new Error("Signed transaction count does not match prepared count.");
  }
  const signatures: string[] = [];

  for (const [index, signedTransaction] of signedTransactions.entries()) {
    const operation = prepared[index];
    if (!operation) {
      throw new Error("Signed transaction count does not match prepared count.");
    }

    const signature = await connection
      .sendRawTransaction(signedTransaction.serialize(), sendOptions)
      .catch((error) =>
        throwPostFailureSimulationErrorOrOriginal({
          connection,
          originalError: error,
          transaction: signedTransaction,
        })
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
        const error = new Error(
          `Transaction ${signature} failed to confirm: ${JSON.stringify(
            confirmation.value.err
          )}`
        );
        await throwPostFailureSimulationErrorOrOriginal({
          connection,
          originalError: error,
          transaction: signedTransaction,
        });
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
