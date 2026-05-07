import { AnchorProvider, type BN, Program } from "@coral-xyz/anchor";
import {
  type Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

import idl from "./idl/telegram_private_transfer.json";
import type { TelegramPrivateTransfer } from "./idl/telegram_private_transfer.ts";
import type { DepositData } from "./types";

class ReadOnlyWallet {
  readonly publicKey: PublicKey;

  constructor(publicKey: PublicKey) {
    this.publicKey = publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    _tx: T
  ): Promise<T> {
    throw new Error(
      "ReadOnlyWallet cannot sign transactions; construct a real client for write paths."
    );
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    _txs: T[]
  ): Promise<T[]> {
    throw new Error(
      "ReadOnlyWallet cannot sign transactions; construct a real client for write paths."
    );
  }
}

function createReadOnlyDepositProgram(
  connection: Connection
): Program<TelegramPrivateTransfer> {
  const wallet = new ReadOnlyWallet(PublicKey.default);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: connection.commitment ?? "confirmed",
  });
  return new Program(idl as TelegramPrivateTransfer, provider);
}

/**
 * Enumerate every Deposit account belonging to `user` across the base program
 * and (optionally) the ephemeral program. Read-only — no signer required.
 *
 * Delegated deposits only exist on the ephemeral chain (on base the PDA is
 * owned by the delegation program and Anchor cannot deserialize it as a
 * `Deposit`). Undelegated deposits only exist on base. We query both and
 * merge by PDA address, preferring the ephemeral entry when both return
 * one because ephemeral reflects the live balance for delegated deposits.
 *
 * Used by wallet UIs to discover shielded holdings even when the user has
 * no matching base-chain token balance — e.g. after fully shielding an SPL
 * mint, where Helius `getAssetsByOwner` no longer surfaces it.
 */
export async function enumerateDepositsByUser(args: {
  user: PublicKey;
  baseConnection: Connection;
  ephemeralConnection?: Connection;
}): Promise<DepositData[]> {
  const userFilter = [
    {
      memcmp: {
        offset: 8,
        bytes: args.user.toBase58(),
      },
    },
  ];

  const baseProgram = createReadOnlyDepositProgram(args.baseConnection);
  const ephemeralProgram = args.ephemeralConnection
    ? createReadOnlyDepositProgram(args.ephemeralConnection)
    : null;

  const [baseResults, ephemeralResults] = await Promise.allSettled([
    baseProgram.account.deposit.all(userFilter),
    ephemeralProgram
      ? ephemeralProgram.account.deposit.all(userFilter)
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof baseProgram.account.deposit.all>>
        ),
  ]);

  const byPda = new Map<string, DepositData>();

  const ingest = (
    results: Array<{
      publicKey: PublicKey;
      account: { user: PublicKey; tokenMint: PublicKey; amount: BN };
    }>,
    preferOverwrite: boolean
  ) => {
    for (const { publicKey, account } of results) {
      const key = publicKey.toBase58();
      if (!preferOverwrite && byPda.has(key)) continue;
      byPda.set(key, {
        user: account.user,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: publicKey,
      });
    }
  };

  if (baseResults.status === "fulfilled") {
    ingest(baseResults.value, /* preferOverwrite */ false);
  } else {
    console.warn(
      "[enumerateDepositsByUser] base program enumeration failed",
      baseResults.reason
    );
  }

  if (ephemeralResults.status === "fulfilled") {
    ingest(ephemeralResults.value, /* preferOverwrite */ true);
  } else if (ephemeralProgram) {
    console.warn(
      "[enumerateDepositsByUser] ephemeral program enumeration failed",
      ephemeralResults.reason
    );
  }

  return Array.from(byPda.values());
}
