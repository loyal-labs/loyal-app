import { type Commitment, Connection, Transaction, type Signer } from "@solana/web3.js";
import type { Provider } from "@coral-xyz/anchor";
import type { RpcOptions } from "./types";
export declare const DEFAULT_TRANSACTION_COMMITMENT: Commitment;
export declare function logFailedTransactionDiagnostics(params: {
    label: string;
    connection: Connection;
    tx: Transaction;
    error: unknown;
    extraContext?: Record<string, unknown>;
}): Promise<void>;
/**
 * Sign, broadcast, and verify a transaction while keeping the
 * signature in hand across confirmation hiccups.
 *
 * The previous implementation delegated to `provider.sendAndConfirm`,
 * which in turn called `connection.confirmTransaction({signature,
 * blockhash, lastValidBlockHeight})`. With Seeker / Seed Vault the
 * user may spend 5–30s between tapping our preview sheet and
 * biometric-confirming on device; by the time Anchor starts its
 * confirmation poll, the RPC node's poll window has often lapsed and
 * `confirmTransaction` throws `TransactionExpiredBlockheightExceeded`
 * — even though the tx is on chain and has moved funds. Anchor
 * re-throws and the signature is lost, so callers surface "Shield
 * failed" on what was actually a success.
 *
 * We handle the send + confirm ourselves:
 *   1. Stamp blockhash + fee payer, sign via the provider's wallet.
 *   2. Broadcast via `sendRawTransaction` — we now own the signature.
 *   3. Poll `getSignatureStatuses` until landed / failed / dropped.
 * This keeps real failures loud while immunizing callers from the
 * "on-chain but our poll timed out" race.
 */
export declare function sendAndConfirmWithDiagnostics(params: {
    label: string;
    provider: Provider;
    tx: Transaction;
    signers?: Signer[];
    rpcOptions?: RpcOptions;
    extraContext?: Record<string, unknown>;
}): Promise<string>;
