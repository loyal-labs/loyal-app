import {
  compilePreparedOperation,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts-core";
import { VersionedTransaction } from "@solana/web3.js";
import type { SendPreparedWithWalletArgs, WalletAdapterLike } from "./types";

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
  return args.connection.sendRawTransaction(signed.serialize(), args.sendOptions);
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
  const signature = await sendVersionedTransaction({
    wallet,
    connection,
    transaction,
    sendOptions,
  });
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
      throw new Error(
        `Transaction ${signature} failed to confirm: ${JSON.stringify(
          confirmation.value.err
        )}`
      );
    }
  }

  return signature;
}

export function isWalletAdapterLike(value: unknown): value is WalletAdapterLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "publicKey" in value &&
      "signTransaction" in value &&
      typeof (value as WalletAdapterLike).signTransaction === "function"
  );
}
