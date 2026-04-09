import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Connection, SendOptions, VersionedTransaction } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { getSolanaEndpoints } from "@loyal-labs/solana-rpc";

const permissionsAll = mock(() => ({ all: true }));
const prepareCreate = mock(async () => ({ operation: "create" }));
const createClient = mock(
  (config: {
    sendPrepared?: (
      prepared: unknown,
      signers: unknown[],
      context: {
        compileUnsignedTransaction: () => VersionedTransaction;
        sendOptions?: SendOptions;
      }
    ) => Promise<string>;
  }) => ({
    send: async (prepared: unknown) =>
      config.sendPrepared?.(prepared, [], {
        compileUnsignedTransaction: () => ({}) as VersionedTransaction,
        sendOptions: undefined,
      }) ?? "sig-123",
  })
);

mock.module("@loyal-labs/loyal-smart-accounts", () => ({
  codecs: {
    Permissions: {
      all: permissionsAll,
    },
  },
  smartAccounts: {
    prepare: {
      create: prepareCreate,
    },
  },
  createLoyalSmartAccountsClient: createClient,
}));

let sendCreateSmartAccountTransaction: typeof import("../send").sendCreateSmartAccountTransaction;

const programId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
const walletAddress = Keypair.generate().publicKey.toBase58();
const settingsPda = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();

describe("smart-account client send", () => {
  beforeAll(async () => {
    ({ sendCreateSmartAccountTransaction } = await import("../send"));
  });

  beforeEach(() => {
    permissionsAll.mockClear();
    prepareCreate.mockClear();
    createClient.mockClear();
  });

  test("uses the response solana env when the active connection points at a different cluster", async () => {
    const sendTransaction = mock(
      async (_transaction: VersionedTransaction, connection: Connection) => {
        return connection.rpcEndpoint;
      }
    );

    const signature = await sendCreateSmartAccountTransaction({
      connection: {
        rpcEndpoint: getSolanaEndpoints("mainnet").rpcEndpoint,
      } as Connection,
      walletAddress,
      sendTransaction,
      response: {
        state: "pending",
        solanaEnv: "devnet",
        programId,
        settingsPda,
        smartAccountAddress: Keypair.generate().publicKey.toBase58(),
        creationSignature: null,
        treasury,
      },
    });

    expect(signature).toBe(getSolanaEndpoints("devnet").rpcEndpoint);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  test("reuses the provided connection when it already matches the response env", async () => {
    const devnetRpcEndpoint = getSolanaEndpoints("devnet").rpcEndpoint;
    const matchingConnection = {
      rpcEndpoint: devnetRpcEndpoint,
    } as Connection;
    const sendTransaction = mock(
      async (_transaction: VersionedTransaction, connection: Connection) => {
        return connection === matchingConnection ? "matched" : "mismatched";
      }
    );

    const signature = await sendCreateSmartAccountTransaction({
      connection: matchingConnection,
      walletAddress,
      sendTransaction,
      response: {
        state: "pending",
        solanaEnv: "devnet",
        programId,
        settingsPda,
        smartAccountAddress: Keypair.generate().publicKey.toBase58(),
        creationSignature: null,
        treasury,
      },
    });

    expect(signature).toBe("matched");
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });
});
