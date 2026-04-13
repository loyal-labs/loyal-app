import { Transaction, VersionedTransaction } from "@solana/web3.js";

import type { PendingApproval } from "../model/types";

import { getConnection } from "@/lib/solana/rpc/connection";
import { getWalletSigner } from "@/lib/solana/wallet/wallet-details";

type ApprovedRequestResult =
  | { publicKey: string }
  | { signature: string }
  | { signedTransaction: string };

function getPayloadString(
  payload: PendingApproval["payload"],
  key: "message" | "transaction",
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${key} payload.`);
  }
  return value;
}

function decodeBase64(value: string): Uint8Array {
  return Buffer.from(value, "base64");
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function deserializeTransaction(encodedTransaction: string) {
  const serializedTransaction = decodeBase64(encodedTransaction);

  try {
    return Transaction.from(serializedTransaction);
  } catch {
    return VersionedTransaction.deserialize(serializedTransaction);
  }
}

function serializeSignedTransaction(
  transaction: Transaction | VersionedTransaction,
): Uint8Array {
  if (transaction instanceof Transaction) {
    return transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
  }

  return transaction.serialize();
}

export async function executeApprovedRequest(
  approval: PendingApproval,
): Promise<ApprovedRequestResult> {
  const signer = await getWalletSigner();

  switch (approval.type) {
    case "connect":
      return { publicKey: signer.publicKey.toBase58() };
    case "signMessage": {
      const message = decodeBase64(getPayloadString(approval.payload, "message"));
      const signature = await signer.signMessage(message);
      return { signature: encodeBase64(signature) };
    }
    case "signTransaction": {
      const transaction = deserializeTransaction(
        getPayloadString(approval.payload, "transaction"),
      );
      const signedTransaction = await signer.signTransaction(transaction);
      return {
        signedTransaction: encodeBase64(
          serializeSignedTransaction(signedTransaction),
        ),
      };
    }
    case "signAndSendTransaction": {
      const transaction = deserializeTransaction(
        getPayloadString(approval.payload, "transaction"),
      );
      const signedTransaction = await signer.signTransaction(transaction);
      const serializedTransaction = serializeSignedTransaction(signedTransaction);
      const signature = await getConnection().sendRawTransaction(
        serializedTransaction,
      );
      return { signature };
    }
  }
}
