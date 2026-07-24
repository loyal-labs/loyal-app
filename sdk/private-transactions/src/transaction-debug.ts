import {
  type AccountInfo,
  type Commitment,
  Connection,
  SendTransactionError,
  Transaction,
  PublicKey,
  type Signer,
} from "@solana/web3.js";
import type { Provider } from "@coral-xyz/anchor";
import { prettyStringify } from "./utils";
import type { RpcOptions } from "./types";

const MULTIPLE_ACCOUNTS_CHUNK_SIZE = 10;
export const DEFAULT_TRANSACTION_COMMITMENT: Commitment = "confirmed";

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
    dataLength: accountInfo.data?.length ?? null,
    rentEpoch: accountInfo.rentEpoch ?? null,
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

  if (error instanceof SendTransactionError) {
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

const COMMITMENT_ORDER: Record<string, number> = {
  processed: 0,
  confirmed: 1,
  finalized: 2,
};

function meetsCommitment(
  observed: string | null | undefined,
  required: Commitment,
): boolean {
  if (!observed) return false;
  const o = COMMITMENT_ORDER[observed];
  const r = COMMITMENT_ORDER[required];
  return o !== undefined && r !== undefined && o >= r;
}

/**
 * Poll `getSignatureStatuses` until the tx lands (success or failure)
 * or we can prove it was dropped. Never throws on "I haven't observed
 * a status yet" — that's the bug we're getting away from. Only throws
 * when the chain tells us the tx failed, or when the blockhash is
 * past its lastValidBlockHeight AND no status is on record.
 */
async function pollForLanding(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  commitment: Commitment,
): Promise<string> {
  const pollIntervalMs = 1_500;
  const maxWallClockMs = 90_000;
  const start = Date.now();

  while (Date.now() - start < maxWallClockMs) {
    let status:
      | Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number]
      | undefined = null;
    try {
      const res = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      status = res.value[0];
    } catch {
      // transient RPC error — keep polling
    }

    if (status?.err) {
      throw new Error(
        `Transaction failed on-chain: ${JSON.stringify(status.err)}`,
      );
    }
    if (meetsCommitment(status?.confirmationStatus, commitment)) {
      return signature;
    }

    // If the blockhash is past its validity window AND no status has
    // ever been recorded for the signature, the tx is definitively
    // dropped. Bail early so callers can surface a real error.
    let currentHeight: number | null = null;
    try {
      currentHeight = await connection.getBlockHeight(commitment);
    } catch {
      // ignore height-check errors; fall through to next poll
    }
    if (
      currentHeight !== null &&
      currentHeight > lastValidBlockHeight &&
      !status
    ) {
      throw new Error(
        `Transaction dropped: ${signature} (blockhash expired without landing)`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Transaction confirmation timed out after 90s: ${signature}`,
  );
}

/**
 * Sign, broadcast, and verify a transaction while keeping the
 * signature in hand across confirmation hiccups.
 *
 * The previous implementation delegated to `provider.sendAndConfirm`,
 * which in turn called `connection.confirmTransaction({signature,
 * blockhash, lastValidBlockHeight})`. With Seeker / Seed Vault the
 * user may spend 5–30s between tapping our preview sheet and
 * biometric-confirming on device; by the time Anchor starts its
 * confirmation poll, the RPC node's poll window has often lapsed and
 * `confirmTransaction` throws `TransactionExpiredBlockheightExceeded`
 * — even though the tx is on chain and has moved funds. Anchor
 * re-throws and the signature is lost, so callers surface "Shield
 * failed" on what was actually a success.
 *
 * We handle the send + confirm ourselves:
 *   1. Stamp blockhash + fee payer, sign via the provider's wallet.
 *   2. Broadcast via `sendRawTransaction` — we now own the signature.
 *   3. Poll `getSignatureStatuses` until landed / failed / dropped.
 * This keeps real failures loud while immunizing callers from the
 * "on-chain but our poll timed out" race.
 */
export async function sendAndConfirmWithDiagnostics(params: {
  label: string;
  provider: Provider;
  tx: Transaction;
  signers?: Signer[];
  rpcOptions?: RpcOptions;
  extraContext?: Record<string, unknown>;
}): Promise<string> {
  const { label, provider, tx, signers, rpcOptions, extraContext } = params;
  const connection = provider.connection;
  const wallet = provider.wallet;
  if (!wallet) {
    throw new Error(`[${label}] Provider has no wallet`);
  }

  // `RpcOptions` only exposes `preflightCommitment`; reuse it as the
  // confirm commitment. Anchor's default was "processed" for
  // preflight and "confirmed" for confirm — here we keep them in
  // lockstep at whatever the caller specified, defaulting to
  // "confirmed".
  const preflightCommitment: Commitment =
    (rpcOptions?.preflightCommitment as Commitment) ??
    DEFAULT_TRANSACTION_COMMITMENT;
  const confirmCommitment: Commitment = preflightCommitment;

  // Stamp blockhash + feePayer ourselves so we control what gets
  // signed and what `lastValidBlockHeight` the poller uses.
  const blockhashInfo = await connection.getLatestBlockhash(preflightCommitment);
  if (!tx.feePayer) tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = blockhashInfo.blockhash;
  tx.lastValidBlockHeight = blockhashInfo.lastValidBlockHeight;

  let signedTx: Transaction;
  try {
    signedTx = await wallet.signTransaction(tx);
  } catch (error) {
    // Signing failure is a real failure (user rejected, signer
    // hardware error). Don't log full tx diagnostics — they'd be
    // noise for a user-rejection flow.
    throw error;
  }
  for (const extraSigner of signers ?? []) {
    signedTx.partialSign(extraSigner);
  }

  let signature: string;
  try {
    const sendOptions: Parameters<Connection["sendRawTransaction"]>[1] = {
      skipPreflight: rpcOptions?.skipPreflight ?? false,
      preflightCommitment,
    };
    if (rpcOptions?.maxRetries !== undefined) {
      sendOptions.maxRetries = rpcOptions.maxRetries;
    }
    signature = await connection.sendRawTransaction(
      signedTx.serialize(),
      sendOptions
    );
  } catch (error) {
    await logFailedTransactionDiagnostics({
      label,
      connection,
      tx: signedTx,
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

  try {
    return await pollForLanding(
      connection,
      signature,
      blockhashInfo.lastValidBlockHeight,
      confirmCommitment,
    );
  } catch (error) {
    await logFailedTransactionDiagnostics({
      label,
      connection,
      tx: signedTx,
      error,
      extraContext: { ...extraContext, signature },
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
