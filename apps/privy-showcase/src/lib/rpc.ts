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

/** The keyless shared endpoint throttles bursts with 429s, and browsers
 *  report those as opaque CORS failures because the 429 carries no
 *  Access-Control-Allow-Origin header. Retry with backoff instead of
 *  surfacing "Failed to fetch" for a transient throttle. */
export const fetchWithBackoff = (async (input, init) => {
  let delayMs = 500;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(input as RequestInfo, init);
      if (response.status !== 429 || attempt >= 3) return response;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs *= 2;
  }
}) as typeof fetch;

export function createMainnetConnection(): Connection {
  // Browsers speak JSON-RPC to the same-origin proxy, which forwards to the
  // server's RPC; direct browser calls to the shared endpoint hit CORS and
  // rate limits. WebSocket subscriptions stay direct: they are exempt from
  // CORS and cannot be proxied through a Next route. Node contexts (the
  // sponsor, tests, the verifier) keep the direct URL.
  const url =
    typeof window === "undefined"
      ? getPublicRpcUrl()
      : new URL("/api/rpc", window.location.origin).toString();
  return new Connection(url, {
    commitment: "finalized",
    fetch: fetchWithBackoff,
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

export async function waitForCommitment(
  connection: Connection,
  signature: string,
  target: "confirmed" | "finalized",
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
    if (
      status?.confirmationStatus === "finalized" ||
      status?.confirmationStatus === target
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Transaction ${signature} did not reach ${target} within ${timeoutMs}ms.`
  );
}

export async function waitForFinalized(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000
): Promise<void> {
  return waitForCommitment(connection, signature, "finalized", timeoutMs);
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
