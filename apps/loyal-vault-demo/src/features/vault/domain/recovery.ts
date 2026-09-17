import bs58 from "bs58";
import type { VaultAction } from "./transactions";

export type RecoveryRecord = Readonly<{
  wallet: string;
  signature: string;
  action: VaultAction;
  messageSha256: string;
  lastValidBlockHeight: string;
  blockhash: string;
  createdAtMs: number;
}>;
export const recoveryKey = (wallet: string) => `loyal-vault-demo:pending-transaction:${wallet}`;
export const RECOVERY_UNREADABLE = "Existing transaction recovery data cannot be read. Resolve the pending transaction before creating another.";

/** Only an absent key means no pending operation. Corruption never permits replacement. */
export function readRecoveryFrom(storage: Pick<Storage, "getItem">, wallet: string): RecoveryRecord | null {
  try {
    const raw = storage.getItem(recoveryKey(wallet));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<RecoveryRecord> | null;
    if (!parsed || parsed.wallet !== wallet) throw new Error();
    const { signature, action, messageSha256, lastValidBlockHeight, blockhash, createdAtMs } = parsed;
    if (typeof signature !== "string" || typeof action !== "string" || typeof messageSha256 !== "string" ||
        typeof lastValidBlockHeight !== "string" || !["deposit", "request-withdraw", "claim"].includes(action) ||
        !/^[a-f0-9]{64}$/.test(messageSha256) || !/^[1-9][0-9]{0,19}$/.test(lastValidBlockHeight) ||
        BigInt(lastValidBlockHeight) > (1n << 64n) - 1n || bs58.decode(signature).length !== 64 ||
        typeof blockhash !== "string" || bs58.decode(blockhash).length !== 32 ||
        typeof createdAtMs !== "number" || !Number.isSafeInteger(createdAtMs) || createdAtMs <= 0) throw new Error();
    return { wallet, signature, action: action as VaultAction, messageSha256, lastValidBlockHeight, blockhash, createdAtMs };
  } catch { throw new Error(RECOVERY_UNREADABLE); }
}
