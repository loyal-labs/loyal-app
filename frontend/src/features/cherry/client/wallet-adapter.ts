import {
  WalletConnectionError,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  type SendTransactionOptions,
} from "@solana/wallet-adapter-base";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
  type MessageAddressTableLookup,
  type MessageCompiledInstruction,
  type Signer,
  type VersionedMessage,
} from "@solana/web3.js";
import nacl from "tweetnacl";

import type { CherryWalletAdapter as CherryWalletAdapterType } from "@cherrydotfun/miniapp-sdk/solana";

import {
  createCherryOperationLease,
  type CherryOperationLease,
} from "./runtime-contract";

type SupportedTransaction = Transaction | VersionedTransaction;

export class CherrySignedTransactionValidationError extends Error {
  constructor(
    readonly code:
      | "BATCH_LENGTH_CHANGED"
      | "INVALID_WALLET_SIGNATURE"
      | "MESSAGE_CHANGED"
      | "MISSING_WALLET_SIGNATURE"
      | "PRIOR_SIGNATURE_CHANGED"
      | "TRANSACTION_TYPE_CHANGED",
    message: string
  ) {
    super(message);
    this.name = "CherrySignedTransactionValidationError";
  }
}

/**
 * Loads the browser-only Cherry adapter on demand. The returned adapter keeps
 * Cherry's connect and signing surface, but Loyal remains the only RPC
 * submitter and validates the signed transaction before any broadcast.
 */
export async function createLoyalCherryWalletAdapter(
  operationLease: CherryOperationLease = createCherryOperationLease()
): Promise<CherryWalletAdapterType> {
  const { CherryWalletAdapter } = await import(
    "@cherrydotfun/miniapp-sdk/solana"
  );

  return new (class LoyalCherryWalletAdapter extends CherryWalletAdapter {
    override async connect(): Promise<void> {
      const generation = operationLease.capture();
      await super.connect();
      if (!operationLease.isCurrent(generation)) {
        await super.disconnect();
        throw new WalletConnectionError("Cherry connection was interrupted.");
      }
    }

    override async disconnect(): Promise<void> {
      operationLease.invalidate();
      await super.disconnect();
    }

    override async signMessage(message: Uint8Array): Promise<Uint8Array> {
      const generation = operationLease.capture();
      const wallet = requireConnectedWallet(this.publicKey);
      const signature = await super.signMessage(message);
      try {
        requireCurrentOperation(
          operationLease,
          generation,
          wallet,
          this.publicKey
        );
        return signature;
      } catch (error) {
        throw new WalletSignMessageError(
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        );
      }
    }

    override async signTransaction<T extends SupportedTransaction>(
      transaction: T
    ): Promise<T> {
      const generation = operationLease.capture();
      const wallet = requireConnectedWallet(this.publicKey);
      const expected = cloneTransaction(transaction) as T;
      const signed = await super.signTransaction(transaction);

      try {
        requireCurrentOperation(
          operationLease,
          generation,
          wallet,
          this.publicKey
        );
        validateCherrySignedTransaction(expected, signed, wallet);
        return signed;
      } catch (error) {
        throw new WalletSignTransactionError(
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        );
      }
    }

    override async signAllTransactions<T extends SupportedTransaction>(
      transactions: T[]
    ): Promise<T[]> {
      const generation = operationLease.capture();
      const wallet = requireConnectedWallet(this.publicKey);
      const expected = transactions.map(
        (transaction) => cloneTransaction(transaction) as T
      );
      const signed = await super.signAllTransactions(transactions);

      try {
        requireCurrentOperation(
          operationLease,
          generation,
          wallet,
          this.publicKey
        );
        if (signed.length !== transactions.length) {
          throw new CherrySignedTransactionValidationError(
            "BATCH_LENGTH_CHANGED",
            "Cherry returned a different transaction batch length."
          );
        }

        return signed.map((signedTransaction, index) => {
          validateCherrySignedTransaction(
            expected[index]!,
            signedTransaction,
            wallet
          );
          return signedTransaction;
        });
      } catch (error) {
        throw new WalletSignTransactionError(
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        );
      }
    }

    override async sendTransaction(
      transaction: SupportedTransaction,
      connection: Connection,
      options?: SendTransactionOptions
    ): Promise<string> {
      try {
        const generation = operationLease.capture();
        const wallet = requireConnectedWallet(this.publicKey);
        applyAdditionalSigners(transaction, options?.signers);
        const signed = await this.signTransaction(transaction);
        requireCurrentOperation(
          operationLease,
          generation,
          wallet,
          this.publicKey
        );
        return await connection.sendRawTransaction(
          serializeForRpc(signed),
          withoutSigners(options)
        );
      } catch (error) {
        throw new WalletSendTransactionError(
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        );
      }
    }
  })();
}

export function validateCherrySignedTransaction<T extends SupportedTransaction>(
  original: T,
  signed: T,
  wallet: PublicKey
): void {
  if (
    original instanceof VersionedTransaction !==
    signed instanceof VersionedTransaction
  ) {
    throw new CherrySignedTransactionValidationError(
      "TRANSACTION_TYPE_CHANGED",
      "Cherry returned a different transaction type."
    );
  }

  const originalMessage = serializeMessage(original);
  const signedMessage = serializeMessage(signed);
  if (!bytesEqual(originalMessage, signedMessage)) {
    // Cherry on Seeker delegates signing to the device wallet over Mobile
    // Wallet Adapter, which may patch the transaction before signing (fresh
    // blockhash, injected compute-budget instructions). Accept exactly those
    // edits — and only for transactions we handed over unsigned: a message
    // change voids any preexisting signature, so partially signed
    // transactions keep the strict byte-equality requirement.
    const isAcceptedModification =
      !hasAnySignature(original) &&
      isBenignWalletModification(messageOf(original), messageOf(signed));
    if (!isAcceptedModification) {
      throw new CherrySignedTransactionValidationError(
        "MESSAGE_CHANGED",
        `Cherry returned a transaction with a different message. (${describeMessageChange(
          messageOf(original),
          messageOf(signed)
        )})`
      );
    }
  }

  if (
    original instanceof VersionedTransaction &&
    signed instanceof VersionedTransaction
  ) {
    validateVersionedSignatures(original, signed, signedMessage, wallet);
    return;
  }

  validateLegacySignatures(
    original as Transaction,
    signed as Transaction,
    signedMessage,
    wallet
  );
}

function validateLegacySignatures(
  original: Transaction,
  signed: Transaction,
  message: Uint8Array,
  wallet: PublicKey
): void {
  const walletSignature = signed.signatures.find(({ publicKey }) =>
    publicKey.equals(wallet)
  )?.signature;
  validateWalletSignature(walletSignature, message, wallet);

  for (const prior of original.signatures) {
    if (prior.publicKey.equals(wallet) || prior.signature === null) {
      continue;
    }
    const returned = signed.signatures.find(({ publicKey }) =>
      publicKey.equals(prior.publicKey)
    )?.signature;
    if (!returned || !bytesEqual(prior.signature, returned)) {
      throw new CherrySignedTransactionValidationError(
        "PRIOR_SIGNATURE_CHANGED",
        "Cherry did not preserve a preexisting transaction signature."
      );
    }
  }
}

function validateVersionedSignatures(
  original: VersionedTransaction,
  signed: VersionedTransaction,
  message: Uint8Array,
  wallet: PublicKey
): void {
  const requiredSignerCount = signed.message.header.numRequiredSignatures;
  const requiredSigners = signed.message.staticAccountKeys.slice(
    0,
    requiredSignerCount
  );
  const walletIndex = requiredSigners.findIndex((publicKey) =>
    publicKey.equals(wallet)
  );
  validateWalletSignature(
    walletIndex >= 0 ? signed.signatures[walletIndex] : undefined,
    message,
    wallet
  );

  const originalRequiredSigners = original.message.staticAccountKeys.slice(
    0,
    original.message.header.numRequiredSignatures
  );
  for (const [index, publicKey] of originalRequiredSigners.entries()) {
    const prior = original.signatures[index];
    if (publicKey.equals(wallet) || !prior || isZeroSignature(prior)) {
      continue;
    }
    const returned = signed.signatures[index];
    if (!returned || !bytesEqual(prior, returned)) {
      throw new CherrySignedTransactionValidationError(
        "PRIOR_SIGNATURE_CHANGED",
        "Cherry did not preserve a preexisting transaction signature."
      );
    }
  }
}

function validateWalletSignature(
  signature: Uint8Array | null | undefined,
  message: Uint8Array,
  wallet: PublicKey
): void {
  if (!signature || isZeroSignature(signature)) {
    throw new CherrySignedTransactionValidationError(
      "MISSING_WALLET_SIGNATURE",
      "Cherry returned a transaction without the connected wallet signature."
    );
  }
  if (!nacl.sign.detached.verify(message, signature, wallet.toBytes())) {
    throw new CherrySignedTransactionValidationError(
      "INVALID_WALLET_SIGNATURE",
      "Cherry returned an invalid connected wallet signature."
    );
  }
}

function hasAnySignature(transaction: SupportedTransaction): boolean {
  if (transaction instanceof VersionedTransaction) {
    return transaction.signatures.some(
      (signature) => !isZeroSignature(signature)
    );
  }
  return transaction.signatures.some(({ signature }) => signature !== null);
}

function messageOf(transaction: SupportedTransaction): VersionedMessage {
  return transaction instanceof VersionedTransaction
    ? transaction.message
    : transaction.compileMessage();
}

// Programs an MWA wallet may inject without being able to touch user assets:
// compute-budget (priority fees), Lighthouse (assertion-only guard — its
// instructions can abort a transaction but never move funds), and Memo
// (inert data). The Seeker vault injects guard/fee instructions on signing.
const BENIGN_INJECTED_PROGRAM_IDS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
]);

function isBenignInjectedProgram(key: PublicKey | undefined): boolean {
  return Boolean(key && BENIGN_INJECTED_PROGRAM_IDS.has(key.toBase58()));
}

/**
 * True when the returned message differs from the sent one only in ways an
 * MWA wallet is allowed to introduce: a replaced recent blockhash, inserted
 * instructions from the benign program allowlist, and the key/header
 * reshuffle of a full message recompile (the Seeker vault recompiles rather
 * than patches). Instructions are compared by resolved account keys, not
 * indexes, so reordered static keys are fine — but the fee payer, signer
 * counts, every original key's permission class, the lookup tables, and
 * every original instruction's program/accounts/data must be unchanged.
 */
function isBenignWalletModification(
  original: VersionedMessage,
  signed: VersionedMessage
): boolean {
  if (original.version !== signed.version) {
    return false;
  }

  // Identical lookups keep loaded-account positions comparable across the
  // two messages, which the resolved instruction comparison relies on.
  if (
    !addressTableLookupsEqual(
      original.addressTableLookups,
      signed.addressTableLookups
    )
  ) {
    return false;
  }

  const originalPayer = original.staticAccountKeys[0];
  if (!originalPayer || !signed.staticAccountKeys[0]?.equals(originalPayer)) {
    return false;
  }
  if (
    signed.header.numRequiredSignatures !==
      original.header.numRequiredSignatures ||
    signed.header.numReadonlySignedAccounts !==
      original.header.numReadonlySignedAccounts
  ) {
    return false;
  }

  // Every original key must survive with its signer/writable class intact;
  // any new key must be an allowlisted program in the readonly section.
  const signedIndexByKey = new Map(
    signed.staticAccountKeys.map((key, index) => [key.toBase58(), index])
  );
  for (const [index, key] of original.staticAccountKeys.entries()) {
    const signedIndex = signedIndexByKey.get(key.toBase58());
    if (
      signedIndex === undefined ||
      accountClass(original, index) !== accountClass(signed, signedIndex)
    ) {
      return false;
    }
  }
  const originalKeySet = new Set(
    original.staticAccountKeys.map((key) => key.toBase58())
  );
  for (const [index, key] of signed.staticAccountKeys.entries()) {
    if (originalKeySet.has(key.toBase58())) {
      continue;
    }
    if (
      !isBenignInjectedProgram(key) ||
      accountClass(signed, index) !== "readonly"
    ) {
      return false;
    }
  }

  const originalResolved = original.compiledInstructions.map((instruction) =>
    resolveInstruction(original, instruction)
  );
  if (originalResolved.some((resolved) => resolved === null)) {
    return false;
  }
  let cursor = 0;
  for (const instruction of signed.compiledInstructions) {
    const resolved = resolveInstruction(signed, instruction);
    if (resolved === null) {
      return false;
    }
    const expected = originalResolved[cursor];
    if (expected && resolvedInstructionsEqual(resolved, expected)) {
      cursor += 1;
      continue;
    }
    if (!BENIGN_INJECTED_PROGRAM_IDS.has(resolved.programId)) {
      return false;
    }
  }
  return cursor === originalResolved.length;
}

type AccountClass =
  | "readonly"
  | "readonly-signer"
  | "writable"
  | "writable-signer";

function accountClass(message: VersionedMessage, index: number): AccountClass {
  const { header, staticAccountKeys } = message;
  if (index < header.numRequiredSignatures) {
    return index <
      header.numRequiredSignatures - header.numReadonlySignedAccounts
      ? "writable-signer"
      : "readonly-signer";
  }
  return index < staticAccountKeys.length - header.numReadonlyUnsignedAccounts
    ? "writable"
    : "readonly";
}

type ResolvedInstruction = {
  accounts: string[];
  data: Uint8Array;
  programId: string;
};

// Account indexes past the static keys refer to lookup-table-loaded
// addresses; with identical lookups on both messages a loaded position is a
// stable identity, so it resolves to a positional token instead of a key.
function resolveInstruction(
  message: VersionedMessage,
  instruction: MessageCompiledInstruction
): ResolvedInstruction | null {
  const staticKeys = message.staticAccountKeys;
  const programId = staticKeys[instruction.programIdIndex];
  if (!programId) {
    return null;
  }
  return {
    accounts: instruction.accountKeyIndexes.map((index) =>
      index < staticKeys.length
        ? staticKeys[index]!.toBase58()
        : `lookup:${index - staticKeys.length}`
    ),
    data: instruction.data,
    programId: programId.toBase58(),
  };
}

function resolvedInstructionsEqual(
  left: ResolvedInstruction,
  right: ResolvedInstruction
): boolean {
  return (
    left.programId === right.programId &&
    left.accounts.length === right.accounts.length &&
    left.accounts.every((value, index) => value === right.accounts[index]) &&
    bytesEqual(left.data, right.data)
  );
}

// Compact structural diff for the MESSAGE_CHANGED error, so telemetry shows
// what the host/wallet actually altered instead of an opaque byte mismatch.
function describeMessageChange(
  original: VersionedMessage,
  signed: VersionedMessage
): string {
  const parts: string[] = [];
  const originalPayer = original.staticAccountKeys[0];
  const signedPayer = signed.staticAccountKeys[0];
  if (!originalPayer || !signedPayer || !originalPayer.equals(signedPayer)) {
    parts.push("fee payer changed");
  }
  if (original.recentBlockhash !== signed.recentBlockhash) {
    parts.push("blockhash changed");
  }
  const originalKeySet = new Set(
    original.staticAccountKeys.map((key) => key.toBase58())
  );
  const signedKeySet = new Set(
    signed.staticAccountKeys.map((key) => key.toBase58())
  );
  const addedKeys = signed.staticAccountKeys.filter(
    (key) => !originalKeySet.has(key.toBase58())
  );
  const removedKeys = original.staticAccountKeys.filter(
    (key) => !signedKeySet.has(key.toBase58())
  );
  if (addedKeys.length > 0) {
    parts.push(
      `static keys added: ${addedKeys.map((key) => key.toBase58()).join(", ")}`
    );
  }
  if (removedKeys.length > 0) {
    parts.push(
      `static keys removed: ${removedKeys
        .map((key) => key.toBase58())
        .join(", ")}`
    );
  }
  if (
    !original.staticAccountKeys.every((key, index) =>
      signed.staticAccountKeys[index]?.equals(key)
    )
  ) {
    parts.push("static key order changed");
  }
  const originalResolved = original.compiledInstructions.map((instruction) =>
    resolveInstruction(original, instruction)
  );
  const insertedPrograms: string[] = [];
  let cursor = 0;
  for (const instruction of signed.compiledInstructions) {
    const resolved = resolveInstruction(signed, instruction);
    const expected = originalResolved[cursor];
    if (resolved && expected && resolvedInstructionsEqual(resolved, expected)) {
      cursor += 1;
      continue;
    }
    insertedPrograms.push(
      resolved?.programId ?? `key#${instruction.programIdIndex}`
    );
  }
  if (insertedPrograms.length > 0) {
    parts.push(`instructions inserted: ${insertedPrograms.join(", ")}`);
  }
  if (cursor !== original.compiledInstructions.length) {
    parts.push("original instructions rewritten");
  }
  if (
    !addressTableLookupsEqual(
      original.addressTableLookups,
      signed.addressTableLookups
    )
  ) {
    parts.push("address table lookups changed");
  }
  if (
    original.header.numRequiredSignatures !==
      signed.header.numRequiredSignatures ||
    original.header.numReadonlySignedAccounts !==
      signed.header.numReadonlySignedAccounts ||
    original.header.numReadonlyUnsignedAccounts !==
      signed.header.numReadonlyUnsignedAccounts
  ) {
    parts.push("header changed");
  }
  return parts.join("; ") || "unrecognized byte-level change";
}

function addressTableLookupsEqual(
  left: MessageAddressTableLookup[],
  right: MessageAddressTableLookup[]
): boolean {
  return (
    left.length === right.length &&
    left.every((lookup, index) => {
      const other = right[index]!;
      return (
        lookup.accountKey.equals(other.accountKey) &&
        numberArraysEqual(lookup.writableIndexes, other.writableIndexes) &&
        numberArraysEqual(lookup.readonlyIndexes, other.readonlyIndexes)
      );
    })
  );
}

function numberArraysEqual(left: number[], right: number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function serializeMessage(transaction: SupportedTransaction): Uint8Array {
  return transaction instanceof VersionedTransaction
    ? transaction.message.serialize()
    : transaction.serializeMessage();
}

function serializeForRpc(transaction: SupportedTransaction): Uint8Array {
  return transaction instanceof VersionedTransaction
    ? transaction.serialize()
    : transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
}

function cloneTransaction(
  transaction: SupportedTransaction
): SupportedTransaction {
  if (transaction instanceof VersionedTransaction) {
    return VersionedTransaction.deserialize(transaction.serialize());
  }
  return Transaction.from(
    transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })
  );
}

function applyAdditionalSigners(
  transaction: SupportedTransaction,
  signers: Signer[] | undefined
): void {
  if (!signers?.length) {
    return;
  }
  if (transaction instanceof VersionedTransaction) {
    transaction.sign(signers);
    return;
  }
  transaction.partialSign(...signers);
}

function withoutSigners(
  options: SendTransactionOptions | undefined
): Omit<SendTransactionOptions, "signers"> | undefined {
  if (!options) {
    return undefined;
  }
  const sendOptions = { ...options };
  delete sendOptions.signers;
  return sendOptions;
}

function requireConnectedWallet(publicKey: PublicKey | null): PublicKey {
  if (!publicKey) {
    throw new WalletSignTransactionError("Cherry wallet is not connected.");
  }
  return publicKey;
}

function requireCurrentOperation(
  operationLease: CherryOperationLease,
  generation: number,
  expectedWallet: PublicKey,
  currentWallet: PublicKey | null
): void {
  if (
    !operationLease.isCurrent(generation) ||
    !currentWallet?.equals(expectedWallet)
  ) {
    throw new Error("Cherry wallet operation was interrupted.");
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function isZeroSignature(signature: Uint8Array): boolean {
  return signature.every((value) => value === 0);
}
