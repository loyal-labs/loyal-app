import type { Connection } from "@solana/web3.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let aggregateAddressesForWallet: typeof import("../address-aggregator").aggregateAddressesForWallet;

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

type TokenAccountsResponse = {
  value: Array<{ pubkey: PublicKey }>;
};

function makeConnection(args: {
  classic: string[];
  token2022: string[];
}): {
  connection: Connection;
  getTokenAccountsByOwner: ReturnType<typeof mock>;
} {
  const getTokenAccountsByOwner = mock(
    async (
      _owner: unknown,
      opts: { programId: PublicKey },
    ): Promise<TokenAccountsResponse> => {
      const programId = opts.programId.toBase58();
      if (programId === TOKEN_PROGRAM_ID.toBase58()) {
        return {
          value: args.classic.map((addr) => ({ pubkey: new PublicKey(addr) })),
        };
      }
      if (programId === TOKEN_2022_PROGRAM_ID.toBase58()) {
        return {
          value: args.token2022.map((addr) => ({
            pubkey: new PublicKey(addr),
          })),
        };
      }
      return { value: [] };
    },
  );

  const connection = {
    getTokenAccountsByOwner,
  } as unknown as Connection;

  return { connection, getTokenAccountsByOwner };
}

describe("aggregateAddressesForWallet", () => {
  beforeAll(async () => {
    ({ aggregateAddressesForWallet } = await import(
      "../address-aggregator"
    ));
  });

  test("returns the wallet pubkey as the first row with kind 'wallet'", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const ata1 = Keypair.generate().publicKey.toBase58();
    const ata2 = Keypair.generate().publicKey.toBase58();

    const { connection } = makeConnection({
      classic: [ata1],
      token2022: [ata2],
    });

    const rows = await aggregateAddressesForWallet(connection, wallet);

    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.address).toBe(wallet);
    expect(first.kind).toBe("wallet");
    expect(first.walletPublicKey).toBe(wallet);
  });

  test("ATAs from the Token program are emitted with kind 'ata' and correct walletPublicKey", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const ata1 = Keypair.generate().publicKey.toBase58();
    const ata2 = Keypair.generate().publicKey.toBase58();

    const { connection } = makeConnection({
      classic: [ata1, ata2],
      token2022: [],
    });

    const rows = await aggregateAddressesForWallet(connection, wallet);

    expect(rows).toHaveLength(3);
    const ataRows = rows.filter((r) => r.kind === "ata");
    expect(ataRows).toHaveLength(2);
    const addresses = ataRows.map((r) => r.address).sort();
    expect(addresses).toEqual([ata1, ata2].sort());
    for (const row of ataRows) {
      expect(row.kind).toBe("ata");
      expect(row.walletPublicKey).toBe(wallet);
    }
  });

  test("ATAs from Token-2022 are also included", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const ata2022a = Keypair.generate().publicKey.toBase58();
    const ata2022b = Keypair.generate().publicKey.toBase58();

    const { connection } = makeConnection({
      classic: [],
      token2022: [ata2022a, ata2022b],
    });

    const rows = await aggregateAddressesForWallet(connection, wallet);

    expect(rows).toHaveLength(3);
    const ataAddresses = rows
      .filter((r) => r.kind === "ata")
      .map((r) => r.address)
      .sort();
    expect(ataAddresses).toEqual([ata2022a, ata2022b].sort());
  });

  test("calls getTokenAccountsByOwner exactly twice (once per program)", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();

    const { connection, getTokenAccountsByOwner } = makeConnection({
      classic: [Keypair.generate().publicKey.toBase58()],
      token2022: [Keypair.generate().publicKey.toBase58()],
    });

    await aggregateAddressesForWallet(connection, wallet);

    expect(getTokenAccountsByOwner).toHaveBeenCalledTimes(2);

    const calls = getTokenAccountsByOwner.mock.calls;
    const programIds = calls
      .map((call) => (call[1] as { programId: PublicKey }).programId.toBase58())
      .sort();
    expect(programIds).toEqual(
      [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].sort(),
    );
  });

  test("wallet with zero ATAs returns just the single wallet row", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();

    const { connection } = makeConnection({ classic: [], token2022: [] });

    const rows = await aggregateAddressesForWallet(connection, wallet);

    expect(rows).toHaveLength(1);
    const only = rows[0];
    expect(only).toBeDefined();
    if (!only) return;
    expect(only.address).toBe(wallet);
    expect(only.kind).toBe("wallet");
    expect(only.walletPublicKey).toBe(wallet);
  });

  test("duplicate ATA appearing under both programs is emitted only once", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const sharedAta = Keypair.generate().publicKey.toBase58();

    const { connection } = makeConnection({
      classic: [sharedAta],
      token2022: [sharedAta],
    });

    const rows = await aggregateAddressesForWallet(connection, wallet);

    expect(rows).toHaveLength(2);
    const ataRows = rows.filter((r) => r.kind === "ata");
    expect(ataRows).toHaveLength(1);
    const ataRow = ataRows[0];
    expect(ataRow).toBeDefined();
    if (!ataRow) return;
    expect(ataRow.address).toBe(sharedAta);
  });
});
