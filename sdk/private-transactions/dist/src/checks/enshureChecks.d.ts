import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import type { InstructionCheck } from "../types";
export declare function processEnsureChecks(baseConnection: Connection, perConnection: Connection, ensure: InstructionCheck[]): Promise<void>;
export declare function getMultipleAccountsInfoWithRetry(connection: Connection, accounts: PublicKey[], label: string): Promise<(AccountInfo<Buffer> | null)[]>;
export declare function runEnsureFetchWithRetry<T>(label: string, task: () => Promise<T>): Promise<T>;
