import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Buffer } from "buffer";
import type { Commitment } from "@solana/web3.js";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import {
  compilePreparedOperation,
  createTransport,
  sendPreparedOperation,
  type PreparedLoyalSmartAccountsOperation,
} from "../index";
import {
  createLoyalSmartAccountsConnectionCache,
  getLoyalSmartAccountsConnection,
  resolveLoyalSmartAccountsClientConfigFromEnv,
  resetLoyalSmartAccountsConnectionCache,
} from "../loyal";

function createPreparedOperationFixture(
  overrides: Partial<PreparedLoyalSmartAccountsOperation<"fixture">> = {}
): PreparedLoyalSmartAccountsOperation<"fixture"> {
  return Object.freeze({
    operation: "fixture",
    payer: Keypair.generate().publicKey,
    programId: Keypair.generate().publicKey,
    requiresConfirmation: false,
    instructions: Object.freeze([
      new TransactionInstruction({
        keys: [],
        programId: Keypair.generate().publicKey,
        data: Buffer.alloc(0),
      }),
    ]),
    lookupTableAccounts: Object.freeze([]),
    ...overrides,
  });
}

function hasNonZeroSignature(signature: Uint8Array): boolean {
  return signature.some((byte) => byte !== 0);
}

describe("loyal adapter", () => {
  it("reuses cached connections only within the provided cache", () => {
    const sharedCache = createLoyalSmartAccountsConnectionCache();
    const otherCache = createLoyalSmartAccountsConnectionCache();
    const createdConnections: string[] = [];

    const createConnection = (
      rpcEndpoint: string,
      websocketEndpoint: string,
      commitment: Commitment
    ) => {
      createdConnections.push(
        `${rpcEndpoint}::${websocketEndpoint}::${commitment}`
      );
      return {
        rpcEndpoint,
        websocketEndpoint,
        commitment,
      } as never;
    };

    const first = getLoyalSmartAccountsConnection({
      env: "devnet",
      cache: sharedCache,
      createConnection,
    });
    const second = getLoyalSmartAccountsConnection({
      env: "devnet",
      cache: sharedCache,
      createConnection,
    });
    const third = getLoyalSmartAccountsConnection({
      env: "devnet",
      cache: otherCache,
      createConnection,
    });

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(createdConnections).toHaveLength(2);

    resetLoyalSmartAccountsConnectionCache(sharedCache);
    expect(sharedCache.size).toBe(0);
  });

  it("isolates cached connections by endpoint commitment and exposes resolved client config", () => {
    const cache = createLoyalSmartAccountsConnectionCache();
    const createdConnections: string[] = [];

    const processedConfig = resolveLoyalSmartAccountsClientConfigFromEnv({
      env: "localnet",
      commitment: "processed",
      cache,
      createConnection: (rpcEndpoint, websocketEndpoint, commitment) => {
        createdConnections.push(
          `${rpcEndpoint}::${websocketEndpoint}::${commitment}`
        );
        return {
          rpcEndpoint,
          websocketEndpoint,
          commitment,
        } as never;
      },
    });

    const confirmedConfig = resolveLoyalSmartAccountsClientConfigFromEnv({
      env: "localnet",
      commitment: "confirmed",
      cache,
      createConnection: (rpcEndpoint, websocketEndpoint, commitment) => {
        createdConnections.push(
          `${rpcEndpoint}::${websocketEndpoint}::${commitment}`
        );
        return {
          rpcEndpoint,
          websocketEndpoint,
          commitment,
        } as never;
      },
    });

    expect(processedConfig.defaultCommitment).toBe("processed");
    expect(confirmedConfig.defaultCommitment).toBe("confirmed");
    expect(new Set(createdConnections).size).toBe(2);
  });

  it("keeps the loyal subpath decoupled from the public sdk package", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["@loyal-labs/loyal-smart-accounts"]).toBeUndefined();
    expect(packageJson.peerDependencies?.["@loyal-labs/loyal-smart-accounts"]).toBeUndefined();
  });
});

describe("transport", () => {
  it("compiles prepared operations deterministically", () => {
    const prepared = createPreparedOperationFixture();
    const transaction = compilePreparedOperation({
      prepared,
      blockhash: "EETubP5AKH4cGF4BPPdNLxWmHkg6dADww7fW7brgVWpj",
    });

    expect(transaction.message.staticAccountKeys[0].toBase58()).toBe(
      prepared.payer.toBase58()
    );
  });

  it("passes an unsigned transaction compiler into custom send hooks", async () => {
    const signer = Keypair.generate();
    const prepared = createPreparedOperationFixture({
      payer: signer.publicKey,
    });
    let observedUnsignedSignature = false;

    const transport = createTransport({
      connection: {
        getLatestBlockhash: async () => ({
          blockhash: "EETubP5AKH4cGF4BPPdNLxWmHkg6dADww7fW7brgVWpj",
          lastValidBlockHeight: 42,
        }),
      } as never,
      sendPrepared: async (_prepared, signers, context) => {
        const transaction = context.compileUnsignedTransaction();
        observedUnsignedSignature = transaction.signatures.every(
          (signature) => !hasNonZeroSignature(signature)
        );
        expect(signers).toHaveLength(1);
        return "custom-signature";
      },
    });

    const signature = await sendPreparedOperation({
      transport,
      prepared,
      signers: [signer],
    });

    expect(signature).toBe("custom-signature");
    expect(observedUnsignedSignature).toBe(true);
  });

  it("deduplicates signers before invoking custom send hooks", async () => {
    const signer = Keypair.generate();
    const prepared = createPreparedOperationFixture({
      payer: signer.publicKey,
    });
    let observedSignerCount = 0;

    const transport = createTransport({
      connection: {
        getLatestBlockhash: async () => ({
          blockhash: "EETubP5AKH4cGF4BPPdNLxWmHkg6dADww7fW7brgVWpj",
          lastValidBlockHeight: 99,
        }),
      } as never,
      sendPrepared: async (_prepared, signers) => {
        observedSignerCount = signers.length;
        return "deduped";
      },
    });

    await sendPreparedOperation({
      transport,
      prepared,
      signers: [signer, signer],
    });

    expect(observedSignerCount).toBe(1);
  });

  it("signs only inside the send phase for the default transport path", async () => {
    const signer = Keypair.generate();
    const prepared = createPreparedOperationFixture({
      payer: signer.publicKey,
    });
    let sentWithSignature = false;

    const transport = createTransport({
      connection: {
        getLatestBlockhash: async () => ({
          blockhash: "EETubP5AKH4cGF4BPPdNLxWmHkg6dADww7fW7brgVWpj",
          lastValidBlockHeight: 7,
        }),
        sendTransaction: async (transaction: { signatures: Uint8Array[] }) => {
          sentWithSignature = transaction.signatures.some((signature) =>
            hasNonZeroSignature(signature)
          );
          return "network-signature";
        },
      } as never,
    });

    const signature = await sendPreparedOperation({
      transport,
      prepared,
      signers: [signer],
    });

    expect(signature).toBe("network-signature");
    expect(sentWithSignature).toBe(true);
  });

  it("confirms required operations by default and lets callers opt out", async () => {
    const prepared = createPreparedOperationFixture({
      requiresConfirmation: true,
    });
    let confirmCount = 0;

    const connection = {
      getLatestBlockhash: async () => ({
        blockhash: "EETubP5AKH4cGF4BPPdNLxWmHkg6dADww7fW7brgVWpj",
        lastValidBlockHeight: 13,
      }),
      sendTransaction: async () => "confirmed-signature",
      confirmTransaction: async () => {
        confirmCount += 1;
        return { value: { err: null } };
      },
    } as never;

    await sendPreparedOperation({
      transport: createTransport({ connection }),
      prepared,
      signers: [],
    });

    await sendPreparedOperation({
      transport: createTransport({ connection }),
      prepared,
      signers: [],
      confirm: false,
    });

    expect(confirmCount).toBe(1);
  });
});

describe("subpath exports", () => {
  it("exposes the Loyal env helpers from the dedicated loyal entry", () => {
    expect(typeof createLoyalSmartAccountsConnectionCache).toBe("function");
    expect(typeof getLoyalSmartAccountsConnection).toBe("function");
    expect(typeof resolveLoyalSmartAccountsClientConfigFromEnv).toBe("function");
  });
});
