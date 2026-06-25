import {
  compilePreparedOperation,
  generated,
  pda,
  toBigInt,
  translateAndThrowAnchorError,
} from "@loyal-labs/loyal-smart-accounts-core";
import { VersionedTransaction } from "@solana/web3.js";
import type {
  SendPreparedBatchWithWalletArgs,
  SendPreparedWithWalletArgs,
  WalletAdapterLike,
} from "./types";

const SQUADS_MISSING_ACCOUNT_ERROR_CODE = 0x1788;
const SQUADS_MISSING_ACCOUNT_ERROR_DECIMAL = SQUADS_MISSING_ACCOUNT_ERROR_CODE;

type PreparedOperation = SendPreparedWithWalletArgs["prepared"];
type PreparedConnection = SendPreparedWithWalletArgs["connection"];
type SimulatedTransactionValue = Awaited<
  ReturnType<PreparedConnection["simulateTransaction"]>
>["value"];

function createErrorWithCause(args: {
  cause: unknown;
  logs?: string[];
  message: string;
  name?: string;
}): Error {
  const error = new Error(args.message);
  if (args.name) {
    error.name = args.name;
  }
  (error as Error & { cause?: unknown; logs?: string[] }).cause = args.cause;
  if (args.logs) {
    (error as Error & { cause?: unknown; logs?: string[] }).logs = args.logs;
  }
  return error;
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

function simulationIndicatesMissingAccount(
  simulation: SimulatedTransactionValue,
  logs: string[],
  translatedError: Error | null
): boolean {
  if (translatedError?.name === "MissingAccount") {
    return true;
  }

  const haystack = [
    translatedError?.name,
    translatedError?.message,
    JSON.stringify(simulation.err),
    logs.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    /\bMissingAccount\b/i.test(haystack) ||
    /custom program error:\s*0x1788/i.test(haystack) ||
    new RegExp(`"Custom"\\s*:\\s*${SQUADS_MISSING_ACCOUNT_ERROR_DECIMAL}`).test(
      haystack
    )
  );
}

function isExecuteSettingsTransactionSyncInstruction(
  instruction: PreparedOperation["instructions"][number]
): boolean {
  if (
    instruction.data.length <
    generated.executeSettingsTransactionSyncInstructionDiscriminator.length
  ) {
    return false;
  }

  return generated.executeSettingsTransactionSyncInstructionDiscriminator.every(
    (byte, index) => instruction.data[index] === byte
  );
}

function formatPubkeys(pubkeys: readonly string[]): string {
  return pubkeys.length > 0 ? pubkeys.join(", ") : "none";
}

function describePolicyCreate(
  action: generated.SettingsAction & { __kind: "PolicyCreate" }
): string {
  if (action.policyCreationPayload.__kind !== "ProgramInteraction") {
    return "policy";
  }

  const [payload] = action.policyCreationPayload.fields;
  const constraintCount = payload.instructionsConstraints.length;
  if (constraintCount === 1) {
    return "setup policy";
  }
  if (constraintCount > 1) {
    return "route policy";
  }
  return "policy";
}

function policyPdaForSeed(args: {
  policySeed: bigint;
  programId: Parameters<typeof pda.getPolicyPda>[0]["programId"];
  settingsPda: Parameters<typeof pda.getPolicyPda>[0]["settingsPda"];
}): string | null {
  if (args.policySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  return pda
    .getPolicyPda({
      programId: args.programId,
      settingsPda: args.settingsPda,
      policySeed: Number(args.policySeed),
    })[0]
    .toBase58();
}

async function fetchNextPolicySeed(args: {
  connection: PreparedConnection;
  settingsPda: Parameters<typeof pda.getPolicyPda>[0]["settingsPda"];
}): Promise<bigint | null> {
  if (typeof args.connection.getAccountInfo !== "function") {
    return null;
  }

  const account = await args.connection.getAccountInfo(
    args.settingsPda,
    "confirmed"
  );
  if (!account) {
    return null;
  }

  const [settings] = generated.Settings.fromAccountInfo({
    ...account,
    data: Buffer.from(account.data),
  });
  const currentPolicySeed =
    settings.policySeed == null ? BigInt(0) : toBigInt(settings.policySeed);
  return currentPolicySeed + BigInt(1);
}

async function getPolicyCreateMissingAccountDiagnostic(args: {
  connection: PreparedConnection;
  prepared: PreparedOperation;
}): Promise<string | null> {
  for (const instruction of args.prepared.instructions) {
    if (!isExecuteSettingsTransactionSyncInstruction(instruction)) {
      continue;
    }

    let decoded: generated.ExecuteSettingsTransactionSyncInstructionArgs & {
      instructionDiscriminator: number[];
    };
    try {
      [decoded] = generated.executeSettingsTransactionSyncStruct.deserialize(
        Buffer.from(instruction.data)
      );
    } catch {
      continue;
    }

    const settingsPda = instruction.keys[0]?.pubkey;
    if (!settingsPda) {
      continue;
    }

    const remainingPolicyAccounts = instruction.keys
      .slice(4 + decoded.args.numSigners)
      .map((meta) => meta.pubkey.toBase58());
    const allInstructionAccounts = new Set(
      instruction.keys.map((meta) => meta.pubkey.toBase58())
    );
    const nextPolicySeed = await fetchNextPolicySeed({
      connection: args.connection,
      settingsPda,
    }).catch(() => null);

    for (const action of decoded.args.actions) {
      if (action.__kind !== "PolicyCreate") {
        continue;
      }

      const actionSeed = toBigInt(action.seed);
      const actionPolicyPda = policyPdaForSeed({
        policySeed: actionSeed,
        programId: instruction.programId,
        settingsPda,
      });
      const policyDescription = describePolicyCreate(action);

      if (nextPolicySeed != null) {
        const expectedPolicyPda = policyPdaForSeed({
          policySeed: nextPolicySeed,
          programId: instruction.programId,
          settingsPda,
        });
        if (
          expectedPolicyPda &&
          !allInstructionAccounts.has(expectedPolicyPda)
        ) {
          return (
            `Squads could not find the policy account required by PolicyCreate. ` +
            `Missing policy account ${expectedPolicyPda} for expected next policy seed ${nextPolicySeed.toString()}. ` +
            `The prepared Earn ${policyDescription} action uses seed ${actionSeed.toString()} ` +
            `and includes policy account(s): ${formatPubkeys(
              remainingPolicyAccounts
            )}. ` +
            `This usually means the route/setup policy stage is stale or a resumed onboarding flow is sending the setup-policy transaction before the route policy exists on chain.`
          );
        }
      }

      if (actionPolicyPda && !allInstructionAccounts.has(actionPolicyPda)) {
        return (
          `Squads could not find the policy account required by PolicyCreate. ` +
          `Missing policy account ${actionPolicyPda} for prepared ${policyDescription} seed ${actionSeed.toString()}. ` +
          `The transaction includes policy account(s): ${formatPubkeys(
            remainingPolicyAccounts
          )}.`
        );
      }

      if (actionPolicyPda) {
        return (
          `Squads reported MissingAccount while creating the prepared Earn ${policyDescription}. ` +
          `The transaction includes the action-derived policy PDA ${actionPolicyPda} for seed ${actionSeed.toString()}, ` +
          `so the most likely missing account is the current next policy PDA from on-chain settings. Refresh the Earn policy state and retry.`
        );
      }
    }
  }

  return null;
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
  if (
    translatedError &&
    !simulationIndicatesMissingAccount(simulation, logs, translatedError)
  ) {
    return attachCause(translatedError, args.error, logs);
  }

  if (simulationIndicatesMissingAccount(simulation, logs, translatedError)) {
    const diagnostic = await getPolicyCreateMissingAccountDiagnostic({
      connection: args.connection,
      prepared: args.prepared,
    });
    if (!diagnostic) {
      return null;
    }

    return createErrorWithCause({
      cause: args.error,
      logs,
      message: diagnostic,
      name: "SquadsMissingAccountSimulationError",
    });
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
  let signature: string;
  try {
    signature = await sendVersionedTransaction({
      wallet,
      connection,
      transaction,
      sendOptions,
    });
  } catch (error) {
    return throwWithSimulationDiagnostic({
      connection,
      error,
      prepared,
      transaction,
    });
  }

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
      return throwWithSimulationDiagnostic({
        connection,
        error,
        prepared,
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

  for (const [index, signedTransaction] of signedTransactions.entries()) {
    const operation = prepared[index];
    if (!operation) {
      throw new Error(
        "Signed transaction count does not match prepared count."
      );
    }

    let signature: string;
    try {
      signature = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        sendOptions
      );
    } catch (error) {
      return throwWithSimulationDiagnostic({
        connection,
        error,
        prepared: operation,
        transaction: signedTransaction,
      });
    }
    signatures.push(signature);
    await onTransactionSent?.({
      index,
      prepared: operation,
      signature,
    });

    const shouldConfirm =
      confirm === true || (confirm !== false && operation.requiresConfirmation);

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
        return throwWithSimulationDiagnostic({
          connection,
          error,
          prepared: operation,
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
