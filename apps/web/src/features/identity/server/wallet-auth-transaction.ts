import "server-only";

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { WalletAuthError } from "./wallet-auth-errors";

export const WALLET_AUTH_MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
export const WALLET_AUTH_NON_BROADCASTABLE_BLOCKHASH =
  "11111111111111111111111111111111";

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ENABLE_WALLET_AUTH_TRANSACTION_DEBUG_LOGS =
  process.env.NODE_ENV === "development";

export type WalletAuthTransactionChallenge = {
  memo: string;
  transaction: string;
};

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(value: string, fieldName: string): Buffer {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !BASE64_PATTERN.test(normalized)
  ) {
    throw new WalletAuthError(`${fieldName} is invalid.`, {
      code: "invalid_wallet_transaction_encoding",
      status: 400,
    });
  }

  return Buffer.from(normalized, "base64");
}

function deserializeTransaction(value: string): Transaction {
  try {
    return Transaction.from(decodeBase64(value, "Wallet transaction"));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      throw error;
    }

    throw new WalletAuthError("Wallet transaction is invalid.", {
      code: "invalid_wallet_transaction",
      status: 400,
    });
  }
}

function summarizePublicKey(publicKey: PublicKey): string {
  const address = publicKey.toBase58();
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function logRejectedWalletAuthTransaction(args: {
  reason: string;
  transaction: Transaction;
  walletAddress: string;
}) {
  if (!ENABLE_WALLET_AUTH_TRANSACTION_DEBUG_LOGS) {
    return;
  }

  const memoInstructionCount = args.transaction.instructions.filter(
    (instruction) => instruction.programId.equals(WALLET_AUTH_MEMO_PROGRAM_ID)
  ).length;

  console.warn("[wallet-auth-transaction] rejected proof transaction", {
    feePayer: args.transaction.feePayer
      ? summarizePublicKey(args.transaction.feePayer)
      : null,
    hasNonceInfo: Boolean(args.transaction.nonceInfo),
    instructionCount: args.transaction.instructions.length,
    instructions: args.transaction.instructions.map((instruction, index) => ({
      dataLength: instruction.data.length,
      index,
      keyCount: instruction.keys.length,
      keys: instruction.keys.map((key) => ({
        isSigner: key.isSigner,
        isWritable: key.isWritable,
        pubkey: summarizePublicKey(key.pubkey),
      })),
      programId: instruction.programId.toBase58(),
    })),
    memoInstructionCount,
    recentBlockhash: args.transaction.recentBlockhash,
    reason: args.reason,
    signatures: args.transaction.signatures.map((signature) => ({
      hasSignature: Boolean(signature.signature),
      pubkey: summarizePublicKey(signature.publicKey),
    })),
    walletAddress: `${args.walletAddress.slice(0, 6)}...${args.walletAddress.slice(
      -6
    )}`,
  });
}

function assertLoginProofTransaction(args: {
  memo: string;
  transaction: Transaction;
  walletAddress: string;
}) {
  const feePayer = args.transaction.feePayer?.toBase58();
  if (!feePayer || feePayer !== args.walletAddress) {
    logRejectedWalletAuthTransaction({
      reason: "fee_payer_mismatch",
      transaction: args.transaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction fee payer is invalid.", {
      code: "wallet_transaction_fee_payer_mismatch",
      status: 401,
    });
  }

  if (
    args.transaction.recentBlockhash !== WALLET_AUTH_NON_BROADCASTABLE_BLOCKHASH
  ) {
    logRejectedWalletAuthTransaction({
      reason: "blockhash_mismatch",
      transaction: args.transaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction blockhash is invalid.", {
      code: "wallet_transaction_blockhash_mismatch",
      status: 401,
    });
  }

  if (args.transaction.nonceInfo) {
    logRejectedWalletAuthTransaction({
      reason: "nonce_info_present",
      transaction: args.transaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction nonce is invalid.", {
      code: "wallet_transaction_nonce_not_allowed",
      status: 401,
    });
  }

  const memoInstructions = args.transaction.instructions.filter((instruction) =>
    instruction.programId.equals(WALLET_AUTH_MEMO_PROGRAM_ID)
  );

  if (memoInstructions.length !== 1) {
    logRejectedWalletAuthTransaction({
      reason: `memo_instruction_count:${memoInstructions.length}`,
      transaction: args.transaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction instructions are invalid.", {
      code: "wallet_transaction_instruction_mismatch",
      status: 401,
    });
  }

  const [instruction] = memoInstructions;
  if (!instruction) {
    logRejectedWalletAuthTransaction({
      reason: "memo_instruction_missing",
      transaction: args.transaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction instruction is missing.", {
      code: "wallet_transaction_instruction_mismatch",
      status: 401,
    });
  }

  if (!instruction.programId.equals(WALLET_AUTH_MEMO_PROGRAM_ID)) {
    logRejectedWalletAuthTransaction({
      reason: `memo_program_mismatch:${instruction.programId.toBase58()}`,
      transaction: args.transaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction program is invalid.", {
      code: "wallet_transaction_program_mismatch",
      status: 401,
    });
  }

  const isValidMemoKey =
    instruction.keys.length === 0 ||
    (instruction.keys.length === 1 &&
      instruction.keys[0]?.pubkey.toBase58() === args.walletAddress &&
      instruction.keys[0].isSigner);

  if (!isValidMemoKey) {
    logRejectedWalletAuthTransaction({
      reason: "memo_accounts_invalid",
      transaction: args.transaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction accounts are invalid.", {
      code: "wallet_transaction_accounts_not_allowed",
      status: 401,
    });
  }

  if (Buffer.from(instruction.data).toString("utf8") !== args.memo) {
    logRejectedWalletAuthTransaction({
      reason: "memo_data_mismatch",
      transaction: args.transaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction memo is invalid.", {
      code: "wallet_transaction_memo_mismatch",
      status: 401,
    });
  }
}

export function createWalletAuthTransactionChallenge(args: {
  memo: string;
  walletAddress: string;
}): WalletAuthTransactionChallenge {
  let feePayer: PublicKey;
  try {
    feePayer = new PublicKey(args.walletAddress);
  } catch {
    throw new WalletAuthError("Wallet address is invalid.", {
      code: "invalid_wallet_address",
      status: 400,
    });
  }

  const transaction = new Transaction({
    feePayer,
    recentBlockhash: WALLET_AUTH_NON_BROADCASTABLE_BLOCKHASH,
  }).add(
    new TransactionInstruction({
      keys: [{ isSigner: true, isWritable: false, pubkey: feePayer }],
      programId: WALLET_AUTH_MEMO_PROGRAM_ID,
      data: Buffer.from(args.memo, "utf8"),
    })
  );

  return {
    memo: args.memo,
    transaction: encodeBase64(
      transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
    ),
  };
}

export function verifyWalletAuthTransactionProof(args: {
  memo: string;
  signedTransaction: string;
  walletAddress: string;
}): string {
  const signedTransaction = deserializeTransaction(args.signedTransaction);

  assertLoginProofTransaction({
    memo: args.memo,
    transaction: signedTransaction,
    walletAddress: args.walletAddress,
  });

  const feePayer = signedTransaction.feePayer?.toBase58();
  if (!feePayer) {
    logRejectedWalletAuthTransaction({
      reason: "fee_payer_missing_after_assertion",
      transaction: signedTransaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction fee payer is invalid.", {
      code: "wallet_transaction_fee_payer_mismatch",
      status: 401,
    });
  }

  const feePayerSignature = signedTransaction.signatures.find(
    (signature) => signature.publicKey.toBase58() === feePayer
  );

  if (!feePayerSignature?.signature) {
    logRejectedWalletAuthTransaction({
      reason: "fee_payer_signature_missing",
      transaction: signedTransaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction signature is missing.", {
      code: "wallet_transaction_signature_missing",
      status: 401,
    });
  }

  if (!signedTransaction.verifySignatures(true)) {
    logRejectedWalletAuthTransaction({
      reason: "fee_payer_signature_invalid",
      transaction: signedTransaction,
      walletAddress: args.walletAddress,
    });
    throw new WalletAuthError("Wallet transaction signature is invalid.", {
      code: "invalid_wallet_transaction_signature",
      status: 401,
    });
  }

  return feePayer;
}
