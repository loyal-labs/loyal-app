import { describe, expect, it } from "bun:test";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import * as sdk from "../index";

describe("client transport", () => {
  it("sends prepared operations through sendPrepared", async () => {
    const creator = Keypair.generate();
    const treasury = Keypair.generate().publicKey;
    const [settingsPda] = sdk.pda.getSettingsPda({ accountIndex: 1n });
    let receivedSignerCount = 0;
    let compiledUnsignedTransaction: VersionedTransaction | null = null;

    const client = sdk.createLoyalSmartAccountsClient({
      connection: {
        getLatestBlockhash: async () => ({
          blockhash: Keypair.generate().publicKey.toBase58(),
          lastValidBlockHeight: 123,
        }),
      } as unknown as Connection,
      sendPrepared: async (_prepared, signers, context) => {
        receivedSignerCount = signers.length;
        compiledUnsignedTransaction = context.compileUnsignedTransaction();
        return "signature-123";
      },
    });

    const signature = await client.smartAccounts.create({
      treasury,
      creator,
      settings: settingsPda,
      settingsAuthority: null,
      threshold: 1,
      signers: [
        {
          key: creator.publicKey,
          permissions: sdk.codecs.Permissions.all(),
        },
      ],
      timeLock: 0,
      rentCollector: null,
    });

    expect(signature).toBe("signature-123");
    expect(receivedSignerCount).toBe(1);
    expect(
      compiledUnsignedTransaction?.signatures.every((signatureBytes) =>
        signatureBytes.every((value) => value === 0)
      ) ?? false
    ).toBe(true);
  });

  it("lets callers send a prepared operation explicitly", async () => {
    const creator = Keypair.generate();
    const treasury = Keypair.generate().publicKey;
    const prepared = await sdk.smartAccounts.prepare.create({
      creator: creator.publicKey,
      treasury,
      settingsAuthority: null,
      threshold: 1,
      signers: [
        {
          key: creator.publicKey,
          permissions: sdk.codecs.Permissions.all(),
        },
      ],
      timeLock: 0,
      rentCollector: null,
    });

    const client = sdk.createLoyalSmartAccountsClient({
      connection: {
        getLatestBlockhash: async () => ({
          blockhash: Keypair.generate().publicKey.toBase58(),
          lastValidBlockHeight: 321,
        }),
        sendTransaction: async () => "signature-explicit",
      } as unknown as Connection,
    });

    const signature = await client.send(prepared, {
      signers: [creator],
    });

    expect(signature).toBe("signature-explicit");
  });

  it("confirms required prepared operations by default and deduplicates signers", async () => {
    const signer = Keypair.generate();
    let observedSignerCount = 0;
    let confirmCount = 0;

    const client = sdk.createLoyalSmartAccountsClient({
      connection: {
        getLatestBlockhash: async () => ({
          blockhash: Keypair.generate().publicKey.toBase58(),
          lastValidBlockHeight: 999,
        }),
        confirmTransaction: async () => {
          confirmCount += 1;
          return { value: { err: null } };
        },
      } as unknown as Connection,
      sendPrepared: async (_prepared, signers) => {
        observedSignerCount = signers.length;
        return "confirmed";
      },
    });

    const signature = await client.send(
      Object.freeze({
        operation: "fixture",
        payer: signer.publicKey,
        programId: signer.publicKey,
        requiresConfirmation: true,
        instructions: Object.freeze([]),
        lookupTableAccounts: Object.freeze([]),
      }),
      {
        signers: [signer, signer],
      }
    );

    expect(signature).toBe("confirmed");
    expect(observedSignerCount).toBe(1);
    expect(confirmCount).toBe(1);
  });

  it("lets callers skip confirmation explicitly", async () => {
    const signer = Keypair.generate();
    let confirmCount = 0;

    const client = sdk.createLoyalSmartAccountsClient({
      connection: {
        getLatestBlockhash: async () => ({
          blockhash: Keypair.generate().publicKey.toBase58(),
          lastValidBlockHeight: 111,
        }),
        sendTransaction: async () => "skip-confirm",
        confirmTransaction: async () => {
          confirmCount += 1;
          return { value: { err: null } };
        },
      } as unknown as Connection,
    });

    const signature = await client.send(
      Object.freeze({
        operation: "fixture",
        payer: signer.publicKey,
        programId: signer.publicKey,
        requiresConfirmation: true,
        instructions: Object.freeze([]),
        lookupTableAccounts: Object.freeze([]),
      }),
      {
        signers: [signer],
        confirm: false,
      }
    );

    expect(signature).toBe("skip-confirm");
    expect(confirmCount).toBe(0);
  });
});
