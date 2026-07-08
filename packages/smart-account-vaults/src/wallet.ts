import {
  compilePreparedOperation,
  translateAndThrowAnchorError,
} from "@loyal-labs/loyal-smart-accounts-core";
import type { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  getPreparedSimulationDiagnosticError,
  simulationIndicatesMissingAccount,
} from "./simulation-diagnostics";
import type {
  SendPreparedBatchWithWalletArgs,
  SendPreparedWithWalletArgs,
  WalletAdapterLike,
} from "./types";

type PreparedOperation = SendPreparedWithWalletArgs["prepared"];
type PreparedConnection = SendPreparedWithWalletArgs["connection"];
type SimulatedTransactionValue = Awaited<
  ReturnType<PreparedConnection["simulateTransaction"]>
>["value"];

export function compilePreparedTransaction(args: {
  blockhash: string;
  feePayer?: PublicKey;
  prepared: PreparedOperation;
}): VersionedTransaction {
  return compilePreparedOperation({
    blockhash: args.blockhash,
    prepared: args.feePayer
      ? { ...args.prepared, payer: args.feePayer }
      : args.prepared,
  });
}

function attachCause(error: Error, cause: unknown, logs?: string[]): Error {
  (error as Error & { cause?: unknown; logs?: string[] }).cause ??= cause;
  if (logs) {
    (error as Error & { cause?: unknown; logs?: string[] }).logs = logs;
  }
  return error;
}

function translateSimulationLogs(logs: string[]): Error | null {
  if (logs.length === 0) {
    return null;
  }

  try {
    translateAndThrowAnchorError(
      Object.assign(new Error("Transaction simulation failed."), { logs })
    );
  } catch (error) {
    return error instanceof Error ? error : null;
  }
}

function stringifySimulationErr(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function getPreSendSimulationError(args: {
  connection: PreparedConnection;
  prepared: PreparedOperation;
  simulation: SimulatedTransactionValue;
  transaction: VersionedTransaction;
}): Promise<Error | null> {
  if (!args.simulation.err) {
    return null;
  }

  const logs = args.simulation.logs ?? [];
  const simulationError = Object.assign(
    new Error(
      `Transaction simulation failed before send: ${stringifySimulationErr(
        args.simulation.err
      )}`
    ),
    { logs }
  );
  const translatedError = translateSimulationLogs(logs);
  const preparedDiagnostic = await getPreparedSimulationDiagnosticError({
    connection: args.connection,
    logs,
    originalError: simulationError,
    prepared: args.prepared,
    simulationErr: args.simulation.err,
    transaction: args.transaction,
    translatedError,
  });
  if (preparedDiagnostic) {
    return preparedDiagnostic;
  }

  if (translatedError) {
    return attachCause(translatedError, simulationError, logs);
  }

  return simulationError;
}

async function simulatePreparedTransactionBeforeSend(args: {
  connection: PreparedConnection;
  prepared: PreparedOperation;
  transaction: VersionedTransaction;
}): Promise<void> {
  if (typeof args.connection.simulateTransaction !== "function") {
    return;
  }

  const { value: simulation } = await args.connection.simulateTransaction(
    args.transaction,
    {
      commitment: "confirmed",
      replaceRecentBlockhash: false,
      sigVerify: false,
    }
  );
  const simulationError = await getPreSendSimulationError({
    ...args,
    simulation,
  });
  if (simulationError) {
    throw simulationError;
  }
}

async function getSimulationDiagnosticError(args: {
  connection: PreparedConnection;
  error: unknown;
  prepared: PreparedOperation;
  transaction: VersionedTransaction;
}): Promise<Error | null> {
  if (typeof args.connection.simulateTransaction !== "function") {
    return null;
  }

  let simulation: SimulatedTransactionValue;
  try {
    ({ value: simulation } = await args.connection.simulateTransaction(
      args.transaction,
      {
        commitment: "confirmed",
        replaceRecentBlockhash: false,
        sigVerify: false,
      }
    ));
  } catch (simulationError) {
    console.warn("[smart-account-vaults] post-failure simulation failed", {
      errorMessage:
        simulationError instanceof Error
          ? simulationError.message
          : "Unknown simulation error.",
      errorName:
        simulationError instanceof Error
          ? simulationError.name
          : typeof simulationError,
      operation: args.prepared.operation,
    });
    return null;
  }

  const logs = simulation.logs ?? [];
  const translatedError = translateSimulationLogs(logs);
  const preparedDiagnostic = await getPreparedSimulationDiagnosticError({
    connection: args.connection,
    logs,
    originalError: args.error,
    prepared: args.prepared,
    simulationErr: simulation.err,
    transaction: args.transaction,
    translatedError,
  });
  if (preparedDiagnostic) {
    return preparedDiagnostic;
  }

  if (
    translatedError &&
    !simulationIndicatesMissingAccount({
      logs,
      simulationErr: simulation.err,
      translatedError,
    })
  ) {
    return attachCause(translatedError, args.error, logs);
  }

  if (
    simulationIndicatesMissingAccount({
      logs,
      simulationErr: simulation.err,
      translatedError,
    })
  ) {
    const diagnostic = await getPreparedSimulationDiagnosticError({
      connection: args.connection,
      logs,
      originalError: args.error,
      prepared: args.prepared,
      simulationErr: simulation.err,
      transaction: args.transaction,
      translatedError,
    });
    return diagnostic;
  }

  if (translatedError) {
    return attachCause(translatedError, args.error, logs);
  }

  return null;
}

async function throwWithSimulationDiagnostic(args: {
  connection: PreparedConnection;
  error: unknown;
  prepared: PreparedOperation;
  transaction: VersionedTransaction;
}): Promise<never> {
  const diagnostic = await getSimulationDiagnosticError(args);
  throw diagnostic ?? args.error;
}

async function withSimulationDiagnostic<T>(
  fn: () => Promise<T>,
  args: {
    connection: PreparedConnection;
    prepared: PreparedOperation;
    transaction: VersionedTransaction;
  }
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return throwWithSimulationDiagnostic({
      ...args,
      error,
    });
  }
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
  const transaction = compilePreparedTransaction({
    prepared,
    blockhash: latestBlockhash.blockhash,
  });
  await simulatePreparedTransactionBeforeSend({
    connection,
    prepared,
    transaction,
  });
  const signature = await withSimulationDiagnostic(
    () =>
      sendVersionedTransaction({
        wallet,
        connection,
        transaction,
        sendOptions,
      }),
    {
      connection,
      prepared,
      transaction,
    }
  );

  const shouldConfirm =
    confirm === true || (confirm !== false && prepared.requiresConfirmation);

  if (shouldConfirm) {
    await withSimulationDiagnostic(
      async () => {
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
      },
      {
        connection,
        prepared,
        transaction,
      }
    );
  }

  return signature;
}

export async function sendPreparedBatchWithWallet({
  connection,
  wallet,
  prepared,
  confirm = "if-required",
  sendMode = "confirm-each",
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
    compilePreparedTransaction({
      prepared: operation,
      blockhash: latestBlockhash.blockhash,
    })
  );
  let signedTransactions: VersionedTransaction[];
  try {
    signedTransactions = await wallet.signAllTransactions(transactions);
  } catch (error) {
    for (const [index, transaction] of transactions.entries()) {
      const operation = prepared[index];
      if (!operation) {
        continue;
      }
      const diagnostic = await getSimulationDiagnosticError({
        connection,
        error,
        prepared: operation,
        transaction,
      });
      if (diagnostic) {
        throw diagnostic;
      }
    }
    throw error;
  }
  if (signedTransactions.length !== prepared.length) {
    throw new Error("Signed transaction count does not match prepared count.");
  }
  const signatures: string[] = [];

  if (sendMode === "send-all-before-confirm") {
    const sentTransactions: {
      index: number;
      operation: PreparedOperation;
      shouldConfirm: boolean;
      signature: string;
      transaction: VersionedTransaction;
    }[] = [];
    let sendFailure: unknown;

    for (const [index, signedTransaction] of signedTransactions.entries()) {
      const operation = prepared[index];
      if (!operation) {
        throw new Error(
          "Signed transaction count does not match prepared count."
        );
      }

      try {
        await simulatePreparedTransactionBeforeSend({
          connection,
          prepared: operation,
          transaction: signedTransaction,
        });
        const signature = await withSimulationDiagnostic(
          () =>
            connection.sendRawTransaction(
              signedTransaction.serialize(),
              sendOptions
            ),
          {
            connection,
            prepared: operation,
            transaction: signedTransaction,
          }
        );
        signatures.push(signature);
        sentTransactions.push({
          index,
          operation,
          shouldConfirm:
            confirm === true ||
            (confirm !== false && operation.requiresConfirmation),
          signature,
          transaction: signedTransaction,
        });
        await onTransactionSent?.({
          index,
          prepared: operation,
          signature,
        });
      } catch (error) {
        sendFailure = error;
        break;
      }
    }

    const confirmationResults = await Promise.allSettled(
      sentTransactions.map(async (sent) => {
        if (sent.shouldConfirm) {
          await withSimulationDiagnostic(
            async () => {
              const confirmation = await connection.confirmTransaction(
                {
                  signature: sent.signature,
                  blockhash: latestBlockhash.blockhash,
                  lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                },
                "confirmed"
              );

              if (confirmation.value.err) {
                throw new Error(
                  `Transaction ${
                    sent.signature
                  } failed to confirm: ${JSON.stringify(
                    confirmation.value.err
                  )}`
                );
              }
            },
            {
              connection,
              prepared: sent.operation,
              transaction: sent.transaction,
            }
          );
        }

        await onTransactionConfirmed?.({
          index: sent.index,
          prepared: sent.operation,
          signature: sent.signature,
        });
      })
    );
    const confirmationFailure = confirmationResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (confirmationFailure) {
      throw confirmationFailure.reason;
    }
    if (sendFailure) {
      throw sendFailure;
    }

    return signatures;
  }

  for (const [index, signedTransaction] of signedTransactions.entries()) {
    const operation = prepared[index];
    if (!operation) {
      throw new Error(
        "Signed transaction count does not match prepared count."
      );
    }

    await simulatePreparedTransactionBeforeSend({
      connection,
      prepared: operation,
      transaction: signedTransaction,
    });
    const signature = await withSimulationDiagnostic(
      () =>
        connection.sendRawTransaction(
          signedTransaction.serialize(),
          sendOptions
        ),
      {
        connection,
        prepared: operation,
        transaction: signedTransaction,
      }
    );
    signatures.push(signature);
    await onTransactionSent?.({
      index,
      prepared: operation,
      signature,
    });

    const shouldConfirm =
      confirm === true || (confirm !== false && operation.requiresConfirmation);

    if (shouldConfirm) {
      await withSimulationDiagnostic(
        async () => {
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
        },
        {
          connection,
          prepared: operation,
          transaction: signedTransaction,
        }
      );
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
