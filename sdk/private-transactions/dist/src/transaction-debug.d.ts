import { Connection, Transaction, type Signer } from "@solana/web3.js";
import type { Provider } from "@coral-xyz/anchor";
import type { RpcOptions } from "./types";
export declare function logFailedTransactionDiagnostics(params: {
    label: string;
    connection: Connection;
    tx: Transaction;
    error: unknown;
    extraContext?: Record<string, unknown>;
}): Promise<void>;
export declare function sendAndConfirmWithDiagnostics(params: {
    label: string;
    provider: Provider;
    tx: Transaction;
    signers?: Signer[];
    rpcOptions?: RpcOptions;
    extraContext?: Record<string, unknown>;
}): Promise<string>;
