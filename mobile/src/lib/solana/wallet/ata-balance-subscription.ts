import { PublicKey } from "@solana/web3.js";

import { getWebsocketConnection } from "@/lib/solana/rpc/connection";

/**
 * Subscribe to on-chain balance changes for the user's associated token
 * accounts. `onLogs(walletPubkey)` misses incoming SPL transfers (the
 * owner wallet is not mentioned in the instruction — only the dest ATA
 * is), so we subscribe per-ATA and invalidate holdings when any of them
 * moves. The actual token amount is parsed off the account data by
 * `fetchTokenHoldings` on refetch; this callback only signals "something
 * changed — go refetch".
 *
 * Callers pass the list of ATAs they already know about (derived from
 * the holdings response). When the holdings set changes (e.g. a new
 * mint appears after a refetch), the caller should re-subscribe.
 */
export async function subscribeToAtaChanges(
  atas: PublicKey[],
  onChange: () => void,
): Promise<() => Promise<void>> {
  if (atas.length === 0) {
    return async () => {};
  }

  const connection = getWebsocketConnection();
  const subscriptionIds: number[] = [];

  for (const ata of atas) {
    try {
      const id = connection.onAccountChange(
        ata,
        () => {
          try {
            onChange();
          } catch (error) {
            console.error("[ws/ata] onChange handler threw", error);
          }
        },
        "confirmed",
      );
      subscriptionIds.push(id);
    } catch (error) {
      console.error(
        `[ws/ata] Failed to subscribe to ${ata.toBase58()}`,
        error,
      );
    }
  }

  return async () => {
    await Promise.all(
      subscriptionIds.map(async (id) => {
        try {
          await connection.removeAccountChangeListener(id);
        } catch (error) {
          console.error("[ws/ata] Failed to remove listener", error);
        }
      }),
    );
  };
}
