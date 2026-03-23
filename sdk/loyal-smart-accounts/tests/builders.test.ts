import { describe, expect, it } from "bun:test";
import BN from "bn.js";
import { Connection, Keypair, TransactionMessage } from "@solana/web3.js";
import * as sdk from "../index";
import { MissingOperationConnectionError } from "@loyal-labs/loyal-smart-accounts-core";

describe("slice builders", () => {
  it("builds a smart account creation instruction through the slice API", () => {
    const creator = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const [settingsPda] = sdk.pda.getSettingsPda({ accountIndex: 1n });

    const instruction = sdk.smartAccounts.instructions.create({
      treasury,
      creator,
      settings: settingsPda,
      settingsAuthority: null,
      threshold: 1,
      signers: [
        {
          key: creator,
          permissions: sdk.codecs.Permissions.all(),
        },
      ],
      timeLock: 0,
      rentCollector: null,
    });

    expect(instruction.keys.length).toBeGreaterThan(0);
  });

  it("prepares an offline transaction operation without compiling a transaction", async () => {
    const creator = Keypair.generate().publicKey;
    const payer = Keypair.generate().publicKey;
    const settingsPda = Keypair.generate().publicKey;
    const message = new TransactionMessage({
      payerKey: creator,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        {
          programId: Keypair.generate().publicKey,
          keys: [],
          data: Buffer.from([1, 2, 3]),
        },
      ],
    });

    const prepared = await sdk.transactions.prepare.create({
      feePayer: payer,
      creator,
      settingsPda,
      transactionIndex: 3n,
      accountIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: message,
    });

    expect(prepared.operation).toBe("create");
    expect(prepared.instructions).toHaveLength(1);
    expect(prepared.lookupTableAccounts).toHaveLength(0);
  });

  it("prepares sync-v2 and policy instructions through slice prepare", async () => {
    const payer = Keypair.generate().publicKey;
    const settingsPda = Keypair.generate().publicKey;
    const preparedExecution = await sdk.execution.prepare.executeTransactionSyncV2({
      feePayer: payer,
      settingsPda,
      accountIndex: 0,
      numSigners: 1,
      instructions: new Uint8Array([1, 0, 0]),
      instruction_accounts: [],
    });

    const preparedPolicy = await sdk.policies.prepare.createTransaction({
      feePayer: payer,
      policy: settingsPda,
      transactionIndex: 9n,
      creator: payer,
      accountIndex: 0,
      policyPayload: {
        __kind: "SpendingLimit",
        fields: [
          {
            amount: new BN(1),
            destination: Keypair.generate().publicKey,
            decimals: 9,
          },
        ],
      },
    });

    expect(preparedExecution.instructions).toHaveLength(1);
    expect(preparedPolicy.instructions).toHaveLength(1);
  });

  it("uses the bound connection when preparing online execution flows", async () => {
    const fetchedAddresses: string[] = [];
    const dummyConnection = {
      getAccountInfo: async (address: { toBase58: () => string }) => {
        fetchedAddresses.push(address.toBase58());
        return {
          data: Buffer.alloc(4096),
        };
      },
    } as unknown as Connection;

    const client = sdk.createLoyalSmartAccountsClient({
      connection: dummyConnection,
    });

    const prepared = await client.execution.prepare.executeTransaction({
      feePayer: Keypair.generate().publicKey,
      settingsPda: Keypair.generate().publicKey,
      transactionIndex: 1n,
      signer: Keypair.generate().publicKey,
    });

    expect(prepared.instructions).toHaveLength(1);
    expect(fetchedAddresses.length).toBeGreaterThan(0);
  });

  it("throws a clear sdk error when online prepare is missing a connection", async () => {
    await expect(
      sdk.execution.prepare.executeTransaction({
        feePayer: Keypair.generate().publicKey,
        settingsPda: Keypair.generate().publicKey,
        transactionIndex: 1n,
        signer: Keypair.generate().publicKey,
      } as never)
    ).rejects.toBeInstanceOf(MissingOperationConnectionError);
  });
});
