import "server-only";

import { type Connection, PublicKey } from "@solana/web3.js";

// SPL Token and Token-2022 program IDs. Helius watches addresses, but
// incoming SPL transfers reference the ATA, not the wallet pubkey. We
// enumerate ATAs under both programs so Helius can fire on every
// inbound transfer.
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export type AggregatedAddress = {
  address: string;
  kind: "wallet" | "ata";
  walletPublicKey: string;
};

/**
 * Returns the wallet pubkey row + one row per owned ATA across SPL Token
 * and Token-2022 programs. Order: wallet row first, then ATAs in the
 * order Helius receives them. Caller is responsible for any caching.
 */
export async function aggregateAddressesForWallet(
  connection: Connection,
  walletPublicKey: string,
): Promise<AggregatedAddress[]> {
  const walletPk = new PublicKey(walletPublicKey);

  const [classic, token2022] = await Promise.all([
    connection.getTokenAccountsByOwner(walletPk, {
      programId: TOKEN_PROGRAM_ID,
    }),
    connection.getTokenAccountsByOwner(walletPk, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ]);

  const seen = new Set<string>();
  const ataAddresses: string[] = [];
  for (const entry of classic.value) {
    const addr = entry.pubkey.toBase58();
    if (!seen.has(addr)) {
      seen.add(addr);
      ataAddresses.push(addr);
    }
  }
  for (const entry of token2022.value) {
    const addr = entry.pubkey.toBase58();
    if (!seen.has(addr)) {
      seen.add(addr);
      ataAddresses.push(addr);
    }
  }

  const rows: AggregatedAddress[] = [
    {
      address: walletPublicKey,
      kind: "wallet",
      walletPublicKey,
    },
  ];
  for (const address of ataAddresses) {
    rows.push({
      address,
      kind: "ata",
      walletPublicKey,
    });
  }
  return rows;
}
