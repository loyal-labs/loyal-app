import { AnchorProvider, type BN, Program } from "@coral-xyz/anchor";
import {
  type Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

import { DELEGATION_PROGRAM_ID } from "./constants";
import idl from "./idl/telegram_private_transfer.json";
import type { TelegramPrivateTransfer } from "./idl/telegram_private_transfer.ts";
import type { DepositData } from "./types";

/**
 * Deposit account layout (after Anchor's 8-byte discriminator):
 *   user:       Pubkey (32) @ offset 8
 *   tokenMint:  Pubkey (32) @ offset 40
 *   amount:     u64    (8)  @ offset 72
 * Total size: 80 bytes.
 */
const DEPOSIT_ACCOUNT_SIZE = 80;
const DEPOSIT_USER_OFFSET = 8;
const DEPOSIT_MINT_OFFSET = 40;
const DEPOSIT_AMOUNT_OFFSET = 72;

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

function readDepositAmount(data: Uint8Array): bigint {
  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value += BigInt(data[DEPOSIT_AMOUNT_OFFSET + i] ?? 0) << BigInt(i * 8);
  }
  return value;
}

/**
 * When a deposit is delegated to an ephemeral validator, the account remains
 * on the base chain but its owner becomes `DELEGATION_PROGRAM_ID`. Anchor's
 * program-scoped `account.deposit.all()` won't return these. We read them via
 * a raw `getProgramAccounts` against the delegation program, filtered by the
 * Deposit account size + user pubkey at offset 8, then parse the bytes.
 *
 * The data layout is preserved across delegation, so reading mint and amount
 * from the same offsets as the undelegated case is safe.
 */
async function readDelegatedDepositsOnBase(
  baseConnection: Connection,
  user: PublicKey
): Promise<DepositData[]> {
  const accounts = await baseConnection.getProgramAccounts(
    DELEGATION_PROGRAM_ID,
    {
      filters: [
        { dataSize: DEPOSIT_ACCOUNT_SIZE },
        {
          memcmp: {
            offset: DEPOSIT_USER_OFFSET,
            bytes: user.toBase58(),
          },
        },
      ],
    }
  );

  const result: DepositData[] = [];
  for (const { pubkey, account } of accounts) {
    const data = account.data as Uint8Array;
    if (data.length < DEPOSIT_ACCOUNT_SIZE) continue;
    const tokenMint = new PublicKey(
      data.subarray(DEPOSIT_MINT_OFFSET, DEPOSIT_MINT_OFFSET + 32)
    );
    result.push({
      user,
      tokenMint,
      amount: readDepositAmount(data),
      address: pubkey,
    });
  }
  return result;
}

export type EphemeralDepositEnumeration =
  | {
      status: "succeeded";
      deposits: DepositData[];
    }
  | {
      status: "failed" | "unavailable";
    };

/**
 * Merge normalized deposit reads without presenting a delegated base snapshot
 * as live when the ephemeral enumeration succeeded.
 *
 * A successful ephemeral enumeration is authoritative for the complete set of
 * delegated deposits. In particular, an empty result means a previously
 * delegated account no longer exists there after a full unshield. The base
 * delegated copy remains useful only when the live source cannot be queried.
 */
export function mergeDepositEnumerationSources(args: {
  baseUndelegated: DepositData[];
  baseDelegated: DepositData[];
  ephemeral: EphemeralDepositEnumeration;
}): DepositData[] {
  const byPda = new Map<string, DepositData>();

  const ingest = (deposits: DepositData[], preferOverwrite: boolean) => {
    for (const deposit of deposits) {
      const key = deposit.address.toBase58();
      if (!preferOverwrite && byPda.has(key)) continue;
      byPda.set(key, deposit);
    }
  };

  ingest(args.baseUndelegated, false);

  if (args.ephemeral.status === "succeeded") {
    ingest(args.ephemeral.deposits, true);
  } else {
    ingest(args.baseDelegated, true);
  }

  return Array.from(byPda.values());
}

function normalizeAnchorDeposits(
  results: Array<{
    publicKey: PublicKey;
    account: { user: PublicKey; tokenMint: PublicKey; amount: BN };
  }>
): DepositData[] {
  return results.map(({ publicKey, account }) => ({
    user: account.user,
    tokenMint: account.tokenMint,
    amount: BigInt(account.amount.toString()),
    address: publicKey,
  }));
}

/**
 * Enumerate every Deposit account belonging to `user` across the base program
 * and (optionally) the ephemeral program. Read-only — no signer required.
 *
 * Three sources are merged:
 *   1. Base, owned by the deposit program — undelegated deposits (Anchor).
 *   2. Base, owned by the delegation program — delegated deposits whose data
 *      bytes are still readable on base. Required when no authenticated
 *      ephemeral connection is available (e.g. browser wallet UI).
 *   3. Ephemeral, owned by the deposit program — delegated deposits with the
 *      live balance (Anchor). A successful read replaces (2) as the
 *      authoritative delegated set, including when the set is empty.
 *
 * Used by wallet UIs to discover shielded holdings even when the user has no
 * matching base-chain token balance — e.g. after fully shielding an SPL mint,
 * where Helius `getAssetsByOwner` no longer surfaces it.
 */
export async function enumerateDepositsByUser(args: {
  user: PublicKey;
  baseConnection: Connection;
  ephemeralConnection?: Connection;
}): Promise<DepositData[]> {
  const userFilter = [
    {
      memcmp: {
        offset: DEPOSIT_USER_OFFSET,
        bytes: args.user.toBase58(),
      },
    },
  ];

  const baseProgram = createReadOnlyDepositProgram(args.baseConnection);
  const ephemeralProgram = args.ephemeralConnection
    ? createReadOnlyDepositProgram(args.ephemeralConnection)
    : null;

  const [baseUndelegatedResult, baseDelegatedResult, ephemeralResult] =
    await Promise.allSettled([
      baseProgram.account.deposit.all(userFilter),
      readDelegatedDepositsOnBase(args.baseConnection, args.user),
      ephemeralProgram
        ? ephemeralProgram.account.deposit.all(userFilter)
        : Promise.resolve(
            [] as Awaited<ReturnType<typeof baseProgram.account.deposit.all>>
          ),
    ]);

  if (baseUndelegatedResult.status === "rejected") {
    console.warn(
      "[enumerateDepositsByUser] base undelegated enumeration failed",
      baseUndelegatedResult.reason
    );
  }

  if (baseDelegatedResult.status === "rejected") {
    console.warn(
      "[enumerateDepositsByUser] base delegated enumeration failed",
      baseDelegatedResult.reason
    );
  }

  if (ephemeralProgram && ephemeralResult.status === "rejected") {
    console.warn(
      "[enumerateDepositsByUser] ephemeral enumeration failed",
      ephemeralResult.reason
    );
  }

  const baseUndelegated =
    baseUndelegatedResult.status === "fulfilled"
      ? normalizeAnchorDeposits(baseUndelegatedResult.value)
      : [];
  const baseDelegated =
    baseDelegatedResult.status === "fulfilled" ? baseDelegatedResult.value : [];
  const ephemeral: EphemeralDepositEnumeration = !ephemeralProgram
    ? { status: "unavailable" }
    : ephemeralResult.status === "fulfilled"
    ? {
        status: "succeeded",
        deposits: normalizeAnchorDeposits(ephemeralResult.value),
      }
    : { status: "failed" };

  return mergeDepositEnumerationSources({
    baseUndelegated,
    baseDelegated,
    ephemeral,
  });
}
