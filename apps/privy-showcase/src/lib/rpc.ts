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

// The demo pipeline moves at "confirmed" (optimistic supermajority, ~2-4s)
// instead of "finalized" (~15s): every read and wait between chained stages
// rides this default, while evidence display upgrades to finalized in the
// background and the verify:demo auditor still reads finalized state.
export function createMainnetConnection(): Connection {
  return new Connection(getPublicRpcUrl(), {
    commitment: "confirmed",
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

async function waitForCommitment(
  connection: Connection,
  signature: string,
  accepted: readonly ("confirmed" | "finalized")[],
  timeoutMs: number,
  pollMs: number
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
    if (
      status?.confirmationStatus &&
      accepted.includes(status.confirmationStatus as "confirmed" | "finalized")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    `Transaction ${signature} did not reach ${accepted[0]} within ${timeoutMs}ms.`
  );
}

export async function waitForConfirmed(
  connection: Connection,
  signature: string,
  timeoutMs = 60_000
): Promise<void> {
  return waitForCommitment(
    connection,
    signature,
    ["confirmed", "finalized"],
    timeoutMs,
    750
  );
}

export async function waitForFinalized(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000
): Promise<void> {
  return waitForCommitment(connection, signature, ["finalized"], timeoutMs, 1_500);
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
