import {
  compilePreparedOperation,
  translateAndThrowAnchorError,
} from "@loyal-labs/loyal-smart-accounts-core";
import bs58 from "bs58";
import type { VersionedTransaction } from "@solana/web3.js";
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

const SUBMITTED_SIGNATURE_STATUS_MAX_ATTEMPTS = 3;
const SUBMITTED_SIGNATURE_STATUS_RETRY_DELAY_MS = 500;
const SIGNED_TRANSACTION_SEND_MAX_ATTEMPTS = 3;
const SIGNED_TRANSACTION_SEND_RETRY_BASE_DELAY_MS = 250;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const placeholder = Object.assign(
    new Error("Transaction simulation failed."),
    { logs }
  );
  try {
    translateAndThrowAnchorError(placeholder);
  } catch (error) {
    // The translator rethrows the placeholder unchanged when the logs carry no
    // recognizable failure — which is what a clean diagnostic simulation looks
    // like (e.g. the user rejected in the wallet and the transaction itself is
    // fine). Surfacing the placeholder there would replace the real error with
    // a fabricated "Transaction simulation failed.", so keep the original.
    if (error === placeholder) {
      return null;
    }
    return error instanceof Error ? error : null;
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
        // The original blockhash may be the reason the wallet/RPC rejected
        // the transaction. Replace it only for this unsigned diagnostic so a
        // freshness failure does not hide the underlying instruction error.
        replaceRecentBlockhash: true,
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
    if (
      error &&
      typeof error === "object" &&
      (error as { transactionWasSubmitted?: unknown })
        .transactionWasSubmitted === true
    ) {
      throw error;
    }
    return throwWithSimulationDiagnostic({
      ...args,
      error,
    });
  }
}

function getSignedTransactionSignature(
  transaction: VersionedTransaction
): string {
  const signature = transaction.signatures[0];
  if (!signature || signature.every((byte) => byte === 0)) {
    throw new Error("Wallet returned a transaction without a payer signature.");
  }
  return bs58.encode(signature);
}

function isDeterministicPreflightRejection(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  return [
    "blockhash not found",
    "block height exceeded",
    "transaction expired",
    "simulation failed",
    "transaction simulation failed",
  ].some((marker) => message.includes(marker));
}

async function sendSignedTransactionWithReconciliation(args: {
  connection: PreparedConnection;
  sendOptions?: SendPreparedWithWalletArgs["sendOptions"];
  transaction: VersionedTransaction;
}): Promise<string> {
  const expectedSignature = getSignedTransactionSignature(args.transaction);
  const serializedTransaction = args.transaction.serialize();
  let lastSendError: unknown;

  // A signed Solana transaction is identified by its payer signature, so
  // rebroadcasting these exact bytes is idempotent. Retry only this known
  // payload after an ambiguous transport failure; never rebuild or re-sign it.
  for (
    let attempt = 0;
    attempt < SIGNED_TRANSACTION_SEND_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await args.connection.sendRawTransaction(
        serializedTransaction,
        args.sendOptions
      );
    } catch (sendError) {
      lastSendError = sendError;
      try {
        const { value } = await args.connection.getSignatureStatuses(
          [expectedSignature],
          { searchTransactionHistory: true }
        );
        const status = value[0] ?? null;
        if (status?.err) {
          throw new Error(
            `Transaction ${expectedSignature} failed: ${JSON.stringify(
              status.err
            )}`
          );
        }
        if (status) {
          return expectedSignature;
        }
      } catch (statusError) {
        if (
          statusError instanceof Error &&
          statusError.message.startsWith(
            `Transaction ${expectedSignature} failed:`
          )
        ) {
          throw statusError;
        }
        // A secondary status-RPC failure cannot prove the signed transaction
        // was absent. A bounded exact-byte rebroadcast remains safe.
      }

      if (isDeterministicPreflightRejection(sendError)) {
        throw sendError;
      }

      if (attempt + 1 < SIGNED_TRANSACTION_SEND_MAX_ATTEMPTS) {
        await wait(SIGNED_TRANSACTION_SEND_RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  const error = new Error(
    `Transaction ${expectedSignature} was signed and may have been submitted, but its send outcome is unresolved. Refresh chain state before retrying.`
  );
  Object.assign(error, {
    cause: lastSendError,
    transactionSignature: expectedSignature,
    transactionWasSubmitted: true,
  });
  throw error;
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
  return sendSignedTransactionWithReconciliation({
    connection: args.connection,
    sendOptions: args.sendOptions,
    transaction: signed,
  });
}

// Resolves with the confirmation's slot when the transport reported one —
// the slot is authoritative here, while status probes can lag the
// confirmation on a busy RPC indexer.
async function confirmSubmittedTransaction(args: {
  blockhash: string;
  connection: PreparedConnection;
  lastValidBlockHeight: number;
  prepared?: PreparedOperation;
  signature: string;
  transaction?: VersionedTransaction;
}): Promise<number | undefined> {
  try {
    const confirmation = await args.connection.confirmTransaction(
      {
        signature: args.signature,
        blockhash: args.blockhash,
        lastValidBlockHeight: args.lastValidBlockHeight,
      },
      "confirmed"
    );

    if (confirmation.value.err) {
      throw new Error(
        `Transaction ${args.signature} failed to confirm: ${JSON.stringify(
          confirmation.value.err
        )}`
      );
    }
    return confirmation.context.slot;
  } catch (confirmationError) {
    // Confirmation transports can time out after a transaction has landed.
    // Reconcile the returned signature before reporting failure; callers must
    // never interpret an ambiguous confirmation as permission to resend.
    let allSuccessfulStatusProbesWereAbsent = true;
    let successfulStatusProbeCount = 0;
    for (
      let attempt = 0;
      attempt < SUBMITTED_SIGNATURE_STATUS_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const { value } = await args.connection.getSignatureStatuses(
          [args.signature],
          { searchTransactionHistory: true }
        );
        successfulStatusProbeCount += 1;
        const status = value[0] ?? null;
        if (status?.err) {
          throw new Error(
            `Transaction ${args.signature} failed: ${JSON.stringify(
              status.err
            )}`
          );
        }
        if (status) {
          allSuccessfulStatusProbesWereAbsent = false;
        }
        if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        ) {
          return status.slot;
        }
      } catch (statusError) {
        if (
          statusError instanceof Error &&
          statusError.message.startsWith(
            `Transaction ${args.signature} failed:`
          )
        ) {
          throw statusError;
        }
        // A secondary RPC failure is not evidence that the transaction was
        // absent. Keep polling because the transport or index can recover.
        allSuccessfulStatusProbesWereAbsent = false;
      }

      if (attempt + 1 < SUBMITTED_SIGNATURE_STATUS_MAX_ATTEMPTS) {
        await wait(SUBMITTED_SIGNATURE_STATUS_RETRY_DELAY_MS);
      }
    }

    const signatureAbsent =
      successfulStatusProbeCount > 0 && allSuccessfulStatusProbesWereAbsent;
    if (signatureAbsent && args.prepared && args.transaction) {
      const diagnostic = await getSimulationDiagnosticError({
        connection: args.connection,
        error: confirmationError,
        prepared: args.prepared,
        transaction: args.transaction,
      });
      if (diagnostic) {
        throw diagnostic;
      }
    }

    const error = new Error(
      `Transaction ${args.signature} was submitted, but its confirmation is unresolved. Refresh chain state before retrying.`
    );
    Object.assign(error, {
      cause: confirmationError,
      transactionSignature: args.signature,
      transactionWasSubmitted: true,
    });
    throw error;
  }
}

export async function sendPreparedWithWallet({
  connection,
  wallet,
  prepared,
  confirm = "if-required",
  onTransactionConfirmed,
  onTransactionSent,
  sendOptions,
}: SendPreparedWithWalletArgs): Promise<string> {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    prepared,
    blockhash: latestBlockhash.blockhash,
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

  await onTransactionSent?.({ prepared, signature });

  const shouldConfirm =
    confirm === true || (confirm !== false && prepared.requiresConfirmation);

  if (shouldConfirm) {
    const slot = await confirmSubmittedTransaction({
      blockhash: latestBlockhash.blockhash,
      connection,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      prepared,
      signature,
      transaction,
    });
    await onTransactionConfirmed?.({ prepared, signature, slot });
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
    compilePreparedOperation({
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
        const signature = await withSimulationDiagnostic(
          () =>
            sendSignedTransactionWithReconciliation({
              connection,
              sendOptions,
              transaction: signedTransaction,
            }),
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
        let slot: number | undefined;
        if (sent.shouldConfirm) {
          slot = await confirmSubmittedTransaction({
            blockhash: latestBlockhash.blockhash,
            connection,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            prepared: sent.operation,
            signature: sent.signature,
            transaction: sent.transaction,
          });
        }

        await onTransactionConfirmed?.({
          index: sent.index,
          prepared: sent.operation,
          signature: sent.signature,
          slot,
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

    const signature = await withSimulationDiagnostic(
      () =>
        sendSignedTransactionWithReconciliation({
          connection,
          sendOptions,
          transaction: signedTransaction,
        }),
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

    let slot: number | undefined;
    if (shouldConfirm) {
      slot = await confirmSubmittedTransaction({
        blockhash: latestBlockhash.blockhash,
        connection,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        prepared: operation,
        signature,
        transaction: signedTransaction,
      });
    }

    await onTransactionConfirmed?.({
      index,
      prepared: operation,
      signature,
      slot,
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
