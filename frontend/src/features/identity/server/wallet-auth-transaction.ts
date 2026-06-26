import "server-only";

import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { WalletAuthError } from "./wallet-auth-errors";

export const WALLET_AUTH_MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

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

function assertLoginProofTransaction(args: {
  memo: string;
  transaction: Transaction;
  walletAddress: string;
}) {
  const feePayer = args.transaction.feePayer?.toBase58();
  if (!feePayer || feePayer !== args.walletAddress) {
    throw new WalletAuthError("Wallet transaction fee payer is invalid.", {
      code: "wallet_transaction_fee_payer_mismatch",
      status: 401,
    });
  }

  if (args.transaction.nonceInfo) {
    throw new WalletAuthError("Wallet transaction nonce is invalid.", {
      code: "wallet_transaction_nonce_not_allowed",
      status: 401,
    });
  }

  const memoInstructions: TransactionInstruction[] = [];
  for (const instruction of args.transaction.instructions) {
    if (instruction.programId.equals(WALLET_AUTH_MEMO_PROGRAM_ID)) {
      memoInstructions.push(instruction);
      continue;
    }

    if (
      instruction.programId.equals(ComputeBudgetProgram.programId) &&
      instruction.keys.length === 0
    ) {
      continue;
    }

    throw new WalletAuthError("Wallet transaction instructions are invalid.", {
      code: "wallet_transaction_instruction_mismatch",
      status: 401,
    });
  }

  if (memoInstructions.length !== 1) {
    throw new WalletAuthError("Wallet transaction instructions are invalid.", {
      code: "wallet_transaction_instruction_mismatch",
      status: 401,
    });
  }

  const [instruction] = memoInstructions;
  if (!instruction) {
    throw new WalletAuthError("Wallet transaction instruction is missing.", {
      code: "wallet_transaction_instruction_mismatch",
      status: 401,
    });
  }

  if (!instruction.programId.equals(WALLET_AUTH_MEMO_PROGRAM_ID)) {
    throw new WalletAuthError("Wallet transaction program is invalid.", {
      code: "wallet_transaction_program_mismatch",
      status: 401,
    });
  }

  if (instruction.keys.length !== 0) {
    throw new WalletAuthError("Wallet transaction accounts are invalid.", {
      code: "wallet_transaction_accounts_not_allowed",
      status: 401,
    });
  }

  if (Buffer.from(instruction.data).toString("utf8") !== args.memo) {
    throw new WalletAuthError("Wallet transaction memo is invalid.", {
      code: "wallet_transaction_memo_mismatch",
      status: 401,
    });
  }
}

export function createWalletAuthTransactionChallenge(args: {
  blockhash: string;
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
    recentBlockhash: args.blockhash,
  }).add(
    new TransactionInstruction({
      keys: [],
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
    throw new WalletAuthError("Wallet transaction fee payer is invalid.", {
      code: "wallet_transaction_fee_payer_mismatch",
      status: 401,
    });
  }

  const feePayerSignature = signedTransaction.signatures.find(
    (signature) => signature.publicKey.toBase58() === feePayer
  );

  if (!feePayerSignature?.signature) {
    throw new WalletAuthError("Wallet transaction signature is missing.", {
      code: "wallet_transaction_signature_missing",
      status: 401,
    });
  }

  if (!signedTransaction.verifySignatures(true)) {
    throw new WalletAuthError("Wallet transaction signature is invalid.", {
      code: "invalid_wallet_transaction_signature",
      status: 401,
    });
  }

  return feePayer;
}
