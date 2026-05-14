import { Connection, PublicKey } from "@solana/web3.js";
export declare function prettyStringify(obj: unknown): string;
export declare function waitForAccountOwnerChange(connection: Connection, account: PublicKey, expectedOwner: PublicKey, timeoutMs?: number, intervalMs?: number): {
    wait: () => Promise<void>;
    cancel: () => Promise<void>;
};
export declare function sha256hash(data: string): Promise<number[]>;
export declare function validateUsername(username: string): void;
