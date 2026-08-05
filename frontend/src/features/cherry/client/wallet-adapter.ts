import {
  WalletConnectionError,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  type SendTransactionOptions,
} from "@solana/wallet-adapter-base";
import {
  Transaction,
  VersionedTransaction,
  type Connection,
  type PublicKey,
  type Signer,
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
    throw new CherrySignedTransactionValidationError(
      "MESSAGE_CHANGED",
      "Cherry returned a transaction with a different message."
    );
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
