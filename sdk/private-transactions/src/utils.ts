import { Connection, PublicKey } from "@solana/web3.js";

export function prettyStringify(obj: unknown): string {
  const json = JSON.stringify(
    obj,
    (_key, value) => {
      if (value instanceof PublicKey) return value.toBase58();
      if (typeof value === "bigint") return value.toString();
      return value;
    },
    2
  );

  return json.replace(/\[\s+(\d[\d,\s]*\d)\s+\]/g, (_match, inner) => {
    const items = inner.split(/,\s*/).map((s: string) => s.trim());
    return `[${items.join(", ")}]`;
  });
}

// Subscribe for changes (before transaction) and start polling (should be awaited after transaction).
// Returns an object with `wait()` to start polling and `cancel()` to clean up the subscription
// if the transaction fails before `wait()` is called.
export function waitForAccountOwnerChange(
  connection: Connection,
  account: PublicKey,
  expectedOwner: PublicKey,
  timeoutMs = 15_000,
  intervalMs = 1_000
): { wait: () => Promise<void>; cancel: () => Promise<void> } {
  let skipWait: () => void;
  const subId = connection.onAccountChange(
    account,
    (accountInfo) => {
      if (accountInfo.owner.equals(expectedOwner) && skipWait) {
        console.log(
          `waitForAccountOwnerChange: ${account.toString()} - short-circuit polling wait`
        );
        skipWait();
      }
    },
    { commitment: "confirmed" }
  );

  const cleanup = async () => {
    await connection.removeAccountChangeListener(subId);
  };

  const wait = async () => {
    try {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const info = await connection.getAccountInfo(account, "confirmed");
        if (info && info.owner.equals(expectedOwner)) {
          console.log(
            `waitForAccountOwnerChange: ${account.toString()} appeared with owner ${expectedOwner.toString()} after ${
              Date.now() - start
            }ms`
          );
          return;
        }
        if (info) {
          console.log(
            `waitForAccountOwnerChange: ${account.toString()} exists but owner is ${info.owner.toString()}, expected ${expectedOwner.toString()}`
          );
        }
        await new Promise<void>((r) => {
          skipWait = r;
          setTimeout(r, intervalMs);
        });
      }
      throw new Error(
        `waitForAccountOwnerChange: ${account.toString()} did not appear with owner ${expectedOwner.toString()} after ${timeoutMs}ms`
      );
    } finally {
      await cleanup();
    }
  };

  return { wait, cancel: cleanup };
}
