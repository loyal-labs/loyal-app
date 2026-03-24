import {
  type AccountInfo,
  Connection,
  SendTransactionError,
  Transaction,
  PublicKey,
  type Signer,
} from "@solana/web3.js";
import type { AnchorProvider } from "@coral-xyz/anchor";
import { prettyStringify } from "./utils";
import type { RpcOptions } from "./types";

const MULTIPLE_ACCOUNTS_CHUNK_SIZE = 10;

function describeAccountInfo(
  accountInfo: AccountInfo<Buffer> | null | undefined
): {
  exists: boolean;
  owner: string | null;
  executable: boolean | null;
  lamports: number | null;
  dataLength: number | null;
  rentEpoch: number | null;
} {
  if (!accountInfo) {
    return {
      exists: false,
      owner: null,
      executable: null,
      lamports: null,
      dataLength: null,
      rentEpoch: null,
    };
  }

  return {
    exists: true,
    owner: accountInfo.owner.toBase58(),
    executable: accountInfo.executable,
    lamports: accountInfo.lamports,
    dataLength: accountInfo.data.length,
    rentEpoch: accountInfo.rentEpoch,
  };
}

function extractInlineTransactionLogs(error: unknown): string[] | undefined {
  const logs =
    (error as { logs?: string[]; transactionLogs?: string[] })?.logs ??
    (error as { logs?: string[]; transactionLogs?: string[] })?.transactionLogs;

  return Array.isArray(logs) ? logs : undefined;
}

async function getTransactionErrorLogs(
  error: unknown,
  connection: Connection
): Promise<string[] | undefined> {
  const inlineLogs = extractInlineTransactionLogs(error);
  if (inlineLogs) {
    return inlineLogs;
  }

  if (
    error instanceof SendTransactionError &&
    typeof error.signature === "string" &&
    error.signature.length > 0
  ) {
    try {
      const fetchedLogs = await error.getLogs(connection);
      if (Array.isArray(fetchedLogs)) {
        return fetchedLogs;
      }
    } catch (fetchError) {
      console.error(
        "[tx-debug] failed to fetch logs via SendTransactionError.getLogs()",
        {
          errorName: (fetchError as { name?: string })?.name ?? "UnknownError",
          errorMessage:
            (fetchError as { message?: string })?.message ?? String(fetchError),
        }
      );
    }
  }

  return undefined;
}

function collectTransactionAccounts(tx: Transaction): PublicKey[] {
  const uniqueAccounts = new Map<string, PublicKey>();

  if (tx.feePayer) {
    uniqueAccounts.set(tx.feePayer.toBase58(), tx.feePayer);
  }

  for (const instruction of tx.instructions) {
    uniqueAccounts.set(instruction.programId.toBase58(), instruction.programId);

    for (const key of instruction.keys) {
      uniqueAccounts.set(key.pubkey.toBase58(), key.pubkey);
    }
  }

  return [...uniqueAccounts.values()];
}

function describeTransaction(tx: Transaction): {
  feePayer: string | null;
  recentBlockhash: string | null;
  lastValidBlockHeight: number | null | undefined;
  signatureBase64: string | null;
  instructionCount: number;
  accountKeys: {
    index: number;
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }[];
  instructions: {
    index: number;
    programId: string;
    programIdIndex: number;
    dataLength: number;
    dataBase64: string;
    keys: {
      index: number;
      accountIndex: number;
      pubkey: string;
      isSigner: boolean;
      isWritable: boolean;
    }[];
  }[];
} {
  const compiledMessage = tx.compileMessage();
  const accountKeys = compiledMessage.accountKeys;
  const signedWritableCount =
    compiledMessage.header.numRequiredSignatures -
    compiledMessage.header.numReadonlySignedAccounts;
  const unsignedWritableEndExclusive =
    accountKeys.length - compiledMessage.header.numReadonlyUnsignedAccounts;

  const isAccountWritable = (index: number): boolean => {
    if (index < compiledMessage.header.numRequiredSignatures) {
      return index < signedWritableCount;
    }

    return index < unsignedWritableEndExclusive;
  };

  return {
    feePayer: tx.feePayer?.toBase58() ?? null,
    recentBlockhash: tx.recentBlockhash ?? null,
    lastValidBlockHeight: tx.lastValidBlockHeight,
    signatureBase64: tx.signature
      ? Buffer.from(tx.signature).toString("base64")
      : null,
    instructionCount: tx.instructions.length,
    accountKeys: accountKeys.map((account, index) => ({
      index,
      pubkey: account.toBase58(),
      isSigner: index < compiledMessage.header.numRequiredSignatures,
      isWritable: isAccountWritable(index),
    })),
    instructions: tx.instructions.map((instruction, index) => ({
      index,
      programId: instruction.programId.toBase58(),
      programIdIndex: accountKeys.findIndex((account) =>
        account.equals(instruction.programId)
      ),
      dataLength: instruction.data.length,
      dataBase64: Buffer.from(instruction.data).toString("base64"),
      keys: instruction.keys.map((key, keyIndex) => ({
        index: keyIndex,
        accountIndex: accountKeys.findIndex((account) =>
          account.equals(key.pubkey)
        ),
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
    })),
  };
}

async function getMultipleAccountsInfoInChunks(
  connection: Connection,
  accounts: PublicKey[]
): Promise<(AccountInfo<Buffer> | null)[]> {
  if (accounts.length === 0) {
    return [];
  }

  const chunks: PublicKey[][] = [];
  for (
    let start = 0;
    start < accounts.length;
    start += MULTIPLE_ACCOUNTS_CHUNK_SIZE
  ) {
    chunks.push(accounts.slice(start, start + MULTIPLE_ACCOUNTS_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map((chunk) => connection.getMultipleAccountsInfo(chunk))
  );

  return results.flat();
}

export async function logFailedTransactionDiagnostics(params: {
  label: string;
  connection: Connection;
  tx: Transaction;
  error: unknown;
  extraContext?: Record<string, unknown>;
}): Promise<void> {
  const { label, connection, tx, error, extraContext } = params;
  const txAccounts = collectTransactionAccounts(tx);
  const [errorLogs, accountInfos] = await Promise.all([
    getTransactionErrorLogs(error, connection),
    getMultipleAccountsInfoInChunks(connection, txAccounts),
  ]);

  console.error(
    `[${label}] sendAndConfirm failed`,
    prettyStringify({
      errorName: (error as { name?: string })?.name ?? "UnknownError",
      errorMessage: (error as { message?: string })?.message ?? String(error),
      errorLogs,
      extraContext,
      transaction: describeTransaction(tx),
      accountSnapshots: txAccounts.map((account, index) => ({
        pubkey: account,
        ...describeAccountInfo(accountInfos[index] ?? null),
      })),
    })
  );

  try {
    const simulation = await connection.simulateTransaction(tx);
    console.error(
      `[${label}] simulateTransaction result`,
      prettyStringify({
        contextSlot: simulation.context.slot,
        err: simulation.value.err,
        logs: simulation.value.logs,
        unitsConsumed: simulation.value.unitsConsumed,
        loadedAccountsDataSize: simulation.value.loadedAccountsDataSize,
        returnData: simulation.value.returnData,
      })
    );
  } catch (simulationError) {
    const simulationLogs = await getTransactionErrorLogs(
      simulationError,
      connection
    );
    console.error(
      `[${label}] simulateTransaction failed`,
      prettyStringify({
        errorName:
          (simulationError as { name?: string })?.name ?? "UnknownError",
        errorMessage:
          (simulationError as { message?: string })?.message ??
          String(simulationError),
        logs: simulationLogs,
      })
    );
  }
}

export async function sendAndConfirmWithDiagnostics(params: {
  label: string;
  provider: AnchorProvider;
  tx: Transaction;
  signers?: Signer[];
  rpcOptions?: RpcOptions;
  extraContext?: Record<string, unknown>;
}): Promise<string> {
  const { label, provider, tx, signers, rpcOptions, extraContext } = params;

  try {
    return await provider.sendAndConfirm!(tx, signers, rpcOptions);
  } catch (error) {
    await logFailedTransactionDiagnostics({
      label,
      connection: provider.connection,
      tx,
      error,
      extraContext,
    }).catch((debugError) => {
      console.error(`[${label}] failed to log transaction diagnostics`, {
        errorName: (debugError as { name?: string })?.name ?? "UnknownError",
        errorMessage:
          (debugError as { message?: string })?.message ?? String(debugError),
      });
    });
    throw error;
  }
}
