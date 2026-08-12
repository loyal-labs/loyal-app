import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { WalletAdapterLike } from "@loyal-labs/smart-account-vaults";
import {
  getPublicRpcUrl,
  getPublicWsUrl,
  MAINNET_GENESIS_HASH,
} from "./constants";

export function createMainnetConnection(): Connection {
  return new Connection(getPublicRpcUrl(), {
    commitment: "finalized",
    wsEndpoint: getPublicWsUrl(),
  });
}

export async function assertMainnetConnection(
  connection: Pick<Connection, "getGenesisHash">
): Promise<void> {
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== MAINNET_GENESIS_HASH) {
    throw new Error(
      `RPC genesis ${genesisHash} is not Solana mainnet-beta. No transaction will be prepared or sent.`
    );
  }
}

export async function waitForFinalized(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (status?.err)
      throw new Error(
        `Transaction ${signature} failed: ${JSON.stringify(status.err)}`
      );
    if (status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(
    `Transaction ${signature} did not finalize within ${timeoutMs}ms.`
  );
}

export function createPrivyWalletAdapter(args: {
  address: string;
  signTransaction: (transaction: Uint8Array) => Promise<Uint8Array>;
  signAndSendTransaction: (transaction: Uint8Array) => Promise<Uint8Array>;
}): WalletAdapterLike {
  return {
    publicKey: new PublicKey(args.address),
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T
    ): Promise<T> {
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      } as never);
      const signed = await args.signTransaction(serialized);
      return (
        transaction instanceof VersionedTransaction
          ? VersionedTransaction.deserialize(signed)
          : Transaction.from(signed)
      ) as T;
    },
    async sendTransaction(transaction) {
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      } as never);
      const signature = await args.signAndSendTransaction(serialized);
      return bs58.encode(signature);
    },
  };
}
