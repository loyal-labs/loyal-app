import {
  WalletConnectionError,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  type SendTransactionOptions,
} from "@solana/wallet-adapter-base";
import {
  ComputeBudgetProgram,
  Transaction,
  VersionedTransaction,
  type Connection,
  type MessageAddressTableLookup,
  type MessageCompiledInstruction,
  type PublicKey,
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

/**
 * True when the returned message differs from the sent one only in ways an
 * MWA wallet is allowed to introduce: a replaced recent blockhash and/or
 * inserted compute-budget instructions (with the compute-budget program
 * appended to the static keys). Everything else — fee payer, signer set,
 * lookup tables, and every original instruction byte — must be unchanged.
 */
function isBenignWalletModification(
  original: VersionedMessage,
  signed: VersionedMessage
): boolean {
  if (original.version !== signed.version) {
    return false;
  }

  const originalKeys = original.staticAccountKeys;
  const signedKeys = signed.staticAccountKeys;
  if (signedKeys.length < originalKeys.length) {
    return false;
  }
  if (!originalKeys.every((key, index) => key.equals(signedKeys[index]!))) {
    return false;
  }
  const addedKeys = signedKeys.slice(originalKeys.length);
  if (!addedKeys.every((key) => key.equals(ComputeBudgetProgram.programId))) {
    return false;
  }

  if (
    signed.header.numRequiredSignatures !==
      original.header.numRequiredSignatures ||
    signed.header.numReadonlySignedAccounts !==
      original.header.numReadonlySignedAccounts ||
    signed.header.numReadonlyUnsignedAccounts !==
      original.header.numReadonlyUnsignedAccounts + addedKeys.length
  ) {
    return false;
  }

  if (
    !addressTableLookupsEqual(
      original.addressTableLookups,
      signed.addressTableLookups
    )
  ) {
    return false;
  }

  const originalInstructions = original.compiledInstructions;
  let cursor = 0;
  for (const instruction of signed.compiledInstructions) {
    const expected = originalInstructions[cursor];
    if (expected && compiledInstructionsEqual(instruction, expected)) {
      cursor += 1;
      continue;
    }
    const program = signedKeys[instruction.programIdIndex];
    if (!program?.equals(ComputeBudgetProgram.programId)) {
      return false;
    }
  }
  return cursor === originalInstructions.length;
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
  if (original.staticAccountKeys.length !== signed.staticAccountKeys.length) {
    parts.push(
      `static keys ${original.staticAccountKeys.length}->${signed.staticAccountKeys.length}`
    );
  }
  if (
    original.compiledInstructions.length !== signed.compiledInstructions.length
  ) {
    parts.push(
      `instructions ${original.compiledInstructions.length}->${signed.compiledInstructions.length}`
    );
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

function compiledInstructionsEqual(
  left: MessageCompiledInstruction,
  right: MessageCompiledInstruction
): boolean {
  return (
    left.programIdIndex === right.programIdIndex &&
    numberArraysEqual(left.accountKeyIndexes, right.accountKeyIndexes) &&
    bytesEqual(left.data, right.data)
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
