import { describe, expect, test } from "bun:test";
import type { AccountInfo } from "@solana/web3.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ER_VALIDATOR, DELEGATION_PROGRAM_ID, PROGRAM_ID } from "../index";
import { LoyalPrivateTransactionsClient } from "../src/LoyalPrivateTransactionsClient";
import type { InstructionCheck } from "../src/types";

type StubConnection = {
  getAccountInfoCalls: string[];
  getMultipleAccountsInfoCalls: string[][];
  getAccountInfo: (account: PublicKey) => Promise<AccountInfo<Buffer> | null>;
  getMultipleAccountsInfo: (
    accounts: PublicKey[]
  ) => Promise<(AccountInfo<Buffer> | null)[]>;
  rpcEndpoint: string;
};

type StubWallet = {
  publicKey: PublicKey;
  signAllTransactions: <T>(txs: T[]) => Promise<T[]>;
  signTransaction: <T>(tx: T) => Promise<T>;
};

function createAccountInfo(owner: PublicKey): AccountInfo<Buffer> {
  return {
    data: Buffer.alloc(0),
    executable: false,
    lamports: 1,
    owner,
    rentEpoch: 0,
  };
}

function createConnection(
  rpcEndpoint: string,
  accounts: Map<string, AccountInfo<Buffer> | null>
): StubConnection {
  return {
    getAccountInfoCalls: [],
    getMultipleAccountsInfoCalls: [],
    async getAccountInfo(account: PublicKey) {
      const key = account.toBase58();
      this.getAccountInfoCalls.push(key);
      return accounts.get(key) ?? null;
    },
    async getMultipleAccountsInfo(requestedAccounts: PublicKey[]) {
      this.getMultipleAccountsInfoCalls.push(
        requestedAccounts.map((account) => account.toBase58())
      );
      return requestedAccounts.map(
        (account) => accounts.get(account.toBase58()) ?? null
      );
    },
    rpcEndpoint,
  };
}

function createClient(args: {
  baseAccounts?: Map<string, AccountInfo<Buffer> | null>;
  ephemeralAccounts?: Map<string, AccountInfo<Buffer> | null>;
}) {
  const baseConnection = createConnection(
    "https://api.devnet.solana.com",
    args.baseAccounts ?? new Map()
  );
  const ephemeralConnection = createConnection(
    "https://tee.magicblock.app",
    args.ephemeralAccounts ?? new Map()
  );
  const wallet: StubWallet = {
    publicKey: Keypair.generate().publicKey,
    signAllTransactions: async <T>(txs: T[]) => txs,
    signTransaction: async <T>(tx: T) => tx,
  };
  const ClientCtor = LoyalPrivateTransactionsClient as unknown as new (
    baseProgram: unknown,
    ephemeralProgram: unknown,
    wallet: StubWallet
  ) => LoyalPrivateTransactionsClient;
  const client = new ClientCtor(
    { provider: { connection: baseConnection } },
    { provider: { connection: ephemeralConnection } },
    wallet
  );

  let delegationStatusCalls = 0;
  (
    client as unknown as {
      getDelegationStatus: (account: PublicKey) => Promise<unknown>;
    }
  ).getDelegationStatus = async (_account: PublicKey) => {
    delegationStatusCalls += 1;
    return {
      result: {
        delegationRecord: {
          authority: ER_VALIDATOR.toBase58(),
        },
      },
    };
  };

  return {
    baseConnection,
    client,
    ephemeralConnection,
    getDelegationStatusCalls: () => delegationStatusCalls,
  };
}

describe("processEnsureChecks", () => {
  test("batches unique addresses in first-seen order", async () => {
    const first = Keypair.generate().publicKey;
    const second = Keypair.generate().publicKey;
    const baseAccounts = new Map<string, AccountInfo<Buffer> | null>([
      [first.toBase58(), createAccountInfo(PROGRAM_ID)],
      [second.toBase58(), createAccountInfo(PROGRAM_ID)],
    ]);
    const ephemeralAccounts = new Map<string, AccountInfo<Buffer> | null>([
      [first.toBase58(), createAccountInfo(PROGRAM_ID)],
      [second.toBase58(), createAccountInfo(PROGRAM_ID)],
    ]);
    const {
      baseConnection,
      client,
      ephemeralConnection,
      getDelegationStatusCalls,
    } = createClient({
      baseAccounts,
      ephemeralAccounts,
    });

    const ensure: InstructionCheck[] = [
      {
        address: first,
        delegated: false,
        label: "first-a",
        passNotExist: false,
      },
      {
        address: second,
        delegated: false,
        label: "second",
        passNotExist: false,
      },
      {
        address: first,
        delegated: false,
        label: "first-b",
        passNotExist: true,
      },
    ];

    await (
      client as unknown as {
        processEnsureChecks: (checks: InstructionCheck[]) => Promise<void>;
      }
    ).processEnsureChecks(ensure);

    expect(baseConnection.getMultipleAccountsInfoCalls).toEqual([
      [first.toBase58(), second.toBase58()],
    ]);
    expect(ephemeralConnection.getMultipleAccountsInfoCalls).toEqual([
      [first.toBase58(), second.toBase58()],
    ]);
    expect(baseConnection.getAccountInfoCalls).toEqual([]);
    expect(ephemeralConnection.getAccountInfoCalls).toEqual([]);
    expect(getDelegationStatusCalls()).toBe(0);
  });

  test("throws on conflicting delegated requirements before RPC", async () => {
    const address = Keypair.generate().publicKey;
    const { baseConnection, client, ephemeralConnection } = createClient({});

    const ensure: InstructionCheck[] = [
      {
        address,
        delegated: false,
        label: "not-delegated",
        passNotExist: true,
      },
      {
        address,
        delegated: true,
        label: "delegated",
        passNotExist: false,
      },
    ];

    await expect(
      (
        client as unknown as {
          processEnsureChecks: (checks: InstructionCheck[]) => Promise<void>;
        }
      ).processEnsureChecks(ensure)
    ).rejects.toThrow("Conflicting ensure delegation requirements");
    expect(baseConnection.getMultipleAccountsInfoCalls).toEqual([]);
    expect(ephemeralConnection.getMultipleAccountsInfoCalls).toEqual([]);
  });

  test("merges passNotExist strictly and preserves duplicate labels in errors", async () => {
    const address = Keypair.generate().publicKey;
    const { client } = createClient({});

    const ensure: InstructionCheck[] = [
      {
        address,
        delegated: false,
        label: "dup",
        passNotExist: true,
      },
      {
        address,
        delegated: false,
        label: "dup",
        passNotExist: false,
      },
    ];

    await expect(
      (
        client as unknown as {
          processEnsureChecks: (checks: InstructionCheck[]) => Promise<void>;
        }
      ).processEnsureChecks(ensure)
    ).rejects.toThrow("Account is not exists: dup, dup -");
  });

  test("fetches delegation status lazily for delegated checks", async () => {
    const address = Keypair.generate().publicKey;
    const baseAccounts = new Map<string, AccountInfo<Buffer> | null>([
      [address.toBase58(), createAccountInfo(DELEGATION_PROGRAM_ID)],
    ]);
    const ephemeralAccounts = new Map<string, AccountInfo<Buffer> | null>([
      [address.toBase58(), createAccountInfo(DELEGATION_PROGRAM_ID)],
    ]);
    const { client, getDelegationStatusCalls } = createClient({
      baseAccounts,
      ephemeralAccounts,
    });

    await (
      client as unknown as {
        processEnsureChecks: (checks: InstructionCheck[]) => Promise<void>;
      }
    ).processEnsureChecks([
      {
        address,
        delegated: true,
        label: "delegated",
        passNotExist: false,
      },
    ]);

    expect(getDelegationStatusCalls()).toBe(1);
  });

  test("allows ensure helpers to reuse cached account info and delegation status", async () => {
    const address = Keypair.generate().publicKey;
    const {
      baseConnection,
      client,
      ephemeralConnection,
      getDelegationStatusCalls,
    } = createClient({});

    const cache = {
      baseAccountInfos: new Map([
        [address.toBase58(), createAccountInfo(DELEGATION_PROGRAM_ID)],
      ]),
      delegationStatuses: new Map([
        [
          address.toBase58(),
          Promise.resolve({
            result: {
              delegationRecord: {
                authority: ER_VALIDATOR.toBase58(),
              },
            },
          }),
        ],
      ]),
      ephemeralAccountInfos: new Map([
        [address.toBase58(), createAccountInfo(DELEGATION_PROGRAM_ID)],
      ]),
    };

    await (
      client as unknown as {
        ensureDelegated: (
          account: PublicKey,
          name?: string,
          skipValidatorCheck?: boolean,
          cache?: unknown
        ) => Promise<void>;
      }
    ).ensureDelegated(address, "cached", false, cache);

    expect(baseConnection.getAccountInfoCalls).toEqual([]);
    expect(ephemeralConnection.getAccountInfoCalls).toEqual([]);
    expect(getDelegationStatusCalls()).toBe(0);
  });
});
