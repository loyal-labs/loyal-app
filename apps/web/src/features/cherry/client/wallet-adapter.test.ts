import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import type { SendTransactionOptions } from "@solana/wallet-adapter-base";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type SendOptions,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import nacl from "tweetnacl";

import {
  createCherryOperationLease,
  invalidateCherryOperationsForLifecycleEvent,
} from "./runtime-contract";
import { createLoyalCherryWalletAdapter } from "./wallet-adapter";

type BridgeRequest = {
  type: "cherry:request";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type BridgeResponse = {
  type: "cherry:response";
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
};

type HostHandler = (request: BridgeRequest) => BridgeResponse | null;
type MessageListener = (event: { data: unknown }) => void;

const WALLET = keypair(1);
const COSIGNER = keypair(2);
const RECIPIENT_A = keypair(3).publicKey;
const RECIPIENT_B = keypair(4).publicKey;
const BLOCKHASH = keypair(5).publicKey.toBase58();
const OTHER_BLOCKHASH = keypair(6).publicKey.toBase58();
const LIGHTHOUSE_PROGRAM = new PublicKey(
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"
);
const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const RPC_SIGNATURE = "deterministic-rpc-signature";

const messageListeners = new Set<MessageListener>();
let activeHost: HostHandler | null = null;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window"
);

const fakeWindow: Record<string, unknown> = {
  __cherry: true,
  location: { hash: "", search: "" },
  addEventListener(type: string, listener: MessageListener) {
    if (type === "message") {
      messageListeners.add(listener);
    }
  },
  removeEventListener(type: string, listener: MessageListener) {
    if (type === "message") {
      messageListeners.delete(listener);
    }
  },
  ReactNativeWebView: {
    postMessage(data: string) {
      if (!activeHost) {
        throw new Error("Test Cherry host is not installed.");
      }
      const response = activeHost(JSON.parse(data) as BridgeRequest);
      if (response === null) {
        return;
      }
      queueMicrotask(() => {
        dispatchBridgeResponse(response);
      });
    },
  },
};
fakeWindow.parent = fakeWindow;

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
});

afterEach(() => {
  activeHost = null;
});

afterAll(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("Loyal Cherry wallet adapter", () => {
  test("accepts a legacy signature only when the message and prior signature survive", async () => {
    activeHost = approvedHost();
    const adapter = await connectedAdapter();
    const original = legacyTransaction(RECIPIENT_A);
    original.partialSign(COSIGNER);
    const priorSignature = signatureForLegacy(original, COSIGNER.publicKey);
    const originalMessage = original.serializeMessage();

    const signed = await adapter.signTransaction(original);

    expect(bytesEqual(signed.serializeMessage(), originalMessage)).toBe(true);
    expect(
      bytesEqual(signatureForLegacy(signed, COSIGNER.publicKey), priorSignature)
    ).toBe(true);
    expect(
      nacl.sign.detached.verify(
        signed.serializeMessage(),
        signatureForLegacy(signed, WALLET.publicKey),
        WALLET.publicKey.toBytes()
      )
    ).toBe(true);
  });

  test("validates an ordered v0 signing batch and preserves partial signatures", async () => {
    activeHost = approvedHost();
    const adapter = await connectedAdapter();
    const first = versionedTransaction(RECIPIENT_A);
    const second = versionedTransaction(RECIPIENT_B);
    first.sign([COSIGNER]);
    second.sign([COSIGNER]);
    const originals = [first, second];
    const originalMessages = originals.map((transaction) =>
      transaction.message.serialize()
    );
    const priorSignatures = originals.map((transaction) =>
      signatureForVersioned(transaction, COSIGNER.publicKey)
    );

    const signed = await adapter.signAllTransactions(originals);

    expect(signed).toHaveLength(2);
    for (const [index, transaction] of signed.entries()) {
      expect(
        bytesEqual(transaction.message.serialize(), originalMessages[index]!)
      ).toBe(true);
      expect(
        bytesEqual(
          signatureForVersioned(transaction, COSIGNER.publicKey),
          priorSignatures[index]!
        )
      ).toBe(true);
    }
  });

  test("signs then broadcasts once through Loyal with caller send options", async () => {
    activeHost = approvedHost();
    const adapter = await connectedAdapter();
    const transaction = legacyTransaction(RECIPIENT_A);
    const rpc = recordingConnection();
    const options: SendTransactionOptions = {
      maxRetries: 2,
      minContextSlot: 17,
      preflightCommitment: "confirmed",
      signers: [COSIGNER],
      skipPreflight: true,
    };

    await expect(
      adapter.sendTransaction(transaction, rpc.connection, options)
    ).resolves.toBe(RPC_SIGNATURE);

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0]?.options).toEqual({
      maxRetries: 2,
      minContextSlot: 17,
      preflightCommitment: "confirmed",
      skipPreflight: true,
    });
    const sent = Transaction.from(rpc.calls[0]!.raw);
    expect(signatureForLegacy(sent, WALLET.publicKey)).toHaveLength(64);
    expect(
      bytesEqual(
        signatureForLegacy(sent, COSIGNER.publicKey),
        signatureForLegacy(transaction, COSIGNER.publicKey)
      )
    ).toBe(true);
  });

  test("signs v0 then broadcasts exactly once through Loyal", async () => {
    activeHost = approvedHost();
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    transaction.sign([COSIGNER]);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).resolves.toBe(RPC_SIGNATURE);

    expect(rpc.calls).toHaveLength(1);
    const sent = VersionedTransaction.deserialize(rpc.calls[0]!.raw);
    expect(signatureForVersioned(sent, WALLET.publicKey)).toHaveLength(64);
    expect(
      bytesEqual(
        signatureForVersioned(sent, COSIGNER.publicKey),
        signatureForVersioned(transaction, COSIGNER.publicKey)
      )
    ).toBe(true);
  });

  test("does not retry an ambiguous Loyal RPC failure", async () => {
    activeHost = approvedHost();
    const adapter = await connectedAdapter();
    const rpc = recordingConnection(new Error("ambiguous RPC failure"));

    await expect(
      adapter.sendTransaction(legacyTransaction(RECIPIENT_A), rpc.connection)
    ).rejects.toThrow("ambiguous RPC failure");
    expect(rpc.calls).toHaveLength(1);
  });

  test.each(["disconnect", "suspend"] as const)(
    "rejects a late host signature after %s without broadcasting",
    async (interruption) => {
      const signingHost = approvedHost();
      let pendingRequest: BridgeRequest | null = null;
      activeHost = (request) => {
        if (request.method === "wallet.signTransaction") {
          pendingRequest = request;
          return null;
        }
        return signingHost(request);
      };
      const operationLease = createCherryOperationLease();
      const adapter = await createLoyalCherryWalletAdapter(operationLease);
      await adapter.connect();
      const rpc = recordingConnection();
      const sending = adapter.sendTransaction(
        legacyTransaction(RECIPIENT_A),
        rpc.connection
      );

      expect(pendingRequest).not.toBeNull();
      if (interruption === "disconnect") {
        await adapter.disconnect();
      } else {
        invalidateCherryOperationsForLifecycleEvent(
          operationLease,
          "suspended"
        );
      }
      dispatchBridgeResponse(signingHost(pendingRequest!)!);

      await expect(sending).rejects.toThrow("interrupted");
      expect(rpc.calls).toHaveLength(0);
      await adapter.disconnect();
    }
  );

  test("accepts a Seeker-style benign wallet modification of an unsigned v0 transaction", async () => {
    activeHost = approvedHost({
      signVersioned: seekerVaultStyleSigner(),
    });
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).resolves.toBe(RPC_SIGNATURE);

    expect(rpc.calls).toHaveLength(1);
    const sent = VersionedTransaction.deserialize(rpc.calls[0]!.raw);
    expect(sent.message.recentBlockhash).toBe(OTHER_BLOCKHASH);
    expect(
      sent.message.staticAccountKeys.some((key) =>
        key.equals(ComputeBudgetProgram.programId)
      )
    ).toBe(true);
    expect(
      nacl.sign.detached.verify(
        sent.message.serialize(),
        signatureForVersioned(sent, WALLET.publicKey),
        WALLET.publicKey.toBytes()
      )
    ).toBe(true);
  });

  test("accepts a Seeker-style guard and fee injection without a blockhash change", async () => {
    activeHost = approvedHost({
      signVersioned: seekerVaultStyleSigner({
        inject: [
          {
            data: new Uint8Array(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }).data
            ),
            programId: ComputeBudgetProgram.programId,
          },
          {
            data: new Uint8Array(
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
                .data
            ),
            programId: ComputeBudgetProgram.programId,
          },
          { data: new Uint8Array([4, 0, 0]), programId: LIGHTHOUSE_PROGRAM },
          { data: new Uint8Array([109, 101, 109, 111]), programId: MEMO_PROGRAM },
        ],
        replaceBlockhash: false,
      }),
    });
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).resolves.toBe(RPC_SIGNATURE);

    expect(rpc.calls).toHaveLength(1);
    const sent = VersionedTransaction.deserialize(rpc.calls[0]!.raw);
    expect(sent.message.recentBlockhash).toBe(BLOCKHASH);
    expect(sent.message.compiledInstructions).toHaveLength(5);
    expect(
      sent.message.staticAccountKeys.some((key) =>
        key.equals(LIGHTHOUSE_PROGRAM)
      )
    ).toBe(true);
  });

  test("accepts a Seeker-style full recompile with reordered static keys", async () => {
    activeHost = approvedHost({
      signVersioned(transaction) {
        // The Seeker vault rebuilds the whole message: fee instructions in
        // front, guard asserts behind, and freshly compiled (reordered) keys.
        const message = TransactionMessage.decompile(transaction.message);
        message.instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
          ...message.instructions,
          new TransactionInstruction({
            data: Buffer.from([4, 0]),
            keys: [
              { pubkey: RECIPIENT_A, isSigner: false, isWritable: false },
            ],
            programId: LIGHTHOUSE_PROGRAM,
          }),
        ];
        const recompiled = new VersionedTransaction(
          message.compileToV0Message()
        );
        recompiled.sign([WALLET]);
        return recompiled;
      },
    });
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    const originalSystemIndex = transaction.message.staticAccountKeys.findIndex(
      (key) => key.equals(SystemProgram.programId)
    );
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).resolves.toBe(RPC_SIGNATURE);

    expect(rpc.calls).toHaveLength(1);
    const sent = VersionedTransaction.deserialize(rpc.calls[0]!.raw);
    expect(sent.message.compiledInstructions).toHaveLength(4);
    expect(
      sent.message.staticAccountKeys.findIndex((key) =>
        key.equals(SystemProgram.programId)
      )
    ).not.toBe(originalSystemIndex);
    expect(
      nacl.sign.detached.verify(
        sent.message.serialize(),
        signatureForVersioned(sent, WALLET.publicKey),
        WALLET.publicKey.toBytes()
      )
    ).toBe(true);
  });

  test("rejects a recompile that swaps an original instruction account", async () => {
    activeHost = approvedHost({
      signVersioned(transaction) {
        const message = TransactionMessage.decompile(transaction.message);
        message.instructions = [instruction(RECIPIENT_B)];
        const recompiled = new VersionedTransaction(
          message.compileToV0Message()
        );
        recompiled.sign([WALLET]);
        return recompiled;
      },
    });
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).rejects.toThrow("different message");
    expect(rpc.calls).toHaveLength(0);
  });

  test("rejects a benign-looking modification when the transaction carried a prior signature", async () => {
    activeHost = approvedHost({
      signVersioned: seekerVaultStyleSigner(),
    });
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    transaction.sign([COSIGNER]);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).rejects.toThrow("different message");
    expect(rpc.calls).toHaveLength(0);
  });

  test("rejects a non-compute-budget instruction injected into an unsigned v0 transaction", async () => {
    activeHost = approvedHost({
      signVersioned(transaction) {
        transaction.message.recentBlockhash = OTHER_BLOCKHASH;
        transaction.message.compiledInstructions.push({
          accountKeyIndexes: [0, 2],
          data: new Uint8Array([9, 9, 9]),
          programIdIndex: transaction.message.staticAccountKeys.findIndex(
            (key) => key.equals(SystemProgram.programId)
          ),
        });
        const patched = new VersionedTransaction(transaction.message);
        patched.sign([WALLET]);
        return patched;
      },
    });
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).rejects.toThrow(
      `instructions inserted: ${SystemProgram.programId.toBase58()}`
    );
    expect(rpc.calls).toHaveLength(0);
  });

  test("rejects a changed v0 message before RPC submission", async () => {
    activeHost = approvedHost({
      signVersioned(transaction) {
        transaction.message.recentBlockhash = OTHER_BLOCKHASH;
        transaction.sign([WALLET]);
        return transaction;
      },
    });
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    transaction.sign([COSIGNER]);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).rejects.toThrow("different message");
    expect(rpc.calls).toHaveLength(0);
  });

  test("rejects an invalid legacy wallet signature before RPC submission", async () => {
    activeHost = approvedHost({
      signLegacy(transaction) {
        transaction.partialSign(WALLET);
        const walletSignature = transaction.signatures.find(({ publicKey }) =>
          publicKey.equals(WALLET.publicKey)
        );
        if (!walletSignature) {
          throw new Error("Wallet signature slot missing from fixture.");
        }
        walletSignature.signature = Buffer.alloc(64, 7);
        return transaction;
      },
    });
    const adapter = await connectedAdapter();
    const transaction = legacyTransaction(RECIPIENT_A);
    transaction.partialSign(COSIGNER);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).rejects.toThrow("invalid connected wallet signature");
    expect(rpc.calls).toHaveLength(0);
  });

  test("rejects a removed v0 prior signature before RPC submission", async () => {
    activeHost = approvedHost({
      signVersioned(transaction) {
        transaction.sign([WALLET]);
        const cosignerIndex = requiredSignerIndex(
          transaction,
          COSIGNER.publicKey
        );
        transaction.signatures[cosignerIndex] = new Uint8Array(64);
        return transaction;
      },
    });
    const adapter = await connectedAdapter();
    const transaction = versionedTransaction(RECIPIENT_A);
    transaction.sign([COSIGNER]);
    const rpc = recordingConnection();

    await expect(
      adapter.sendTransaction(transaction, rpc.connection)
    ).rejects.toThrow("preexisting transaction signature");
    expect(rpc.calls).toHaveLength(0);
  });

  test("rejects host refusal and reversed batches without RPC submission", async () => {
    const rejectingRpc = recordingConnection();
    activeHost = approvedHost({ rejectSigning: true });
    const rejectedAdapter = await connectedAdapter();
    const rejected = legacyTransaction(RECIPIENT_A);
    rejected.partialSign(COSIGNER);

    await expect(
      rejectedAdapter.sendTransaction(rejected, rejectingRpc.connection)
    ).rejects.toThrow("User rejected request");
    expect(rejectingRpc.calls).toHaveLength(0);

    activeHost = approvedHost({ reverseBatch: true });
    const reorderedAdapter = await connectedAdapter();
    const first = versionedTransaction(RECIPIENT_A);
    const second = versionedTransaction(RECIPIENT_B);
    first.sign([COSIGNER]);
    second.sign([COSIGNER]);

    await expect(
      reorderedAdapter.signAllTransactions([first, second])
    ).rejects.toThrow("different message");
  });
});

// Mirrors how an MWA device wallet (Seeker Vault) patches a transaction in
// place before signing: injected programs appended to the static keys and
// their instructions prepended, optionally with a fresh blockhash.
function seekerVaultStyleSigner(
  options: {
    inject?: Array<{ data: Uint8Array; programId: PublicKey }>;
    replaceBlockhash?: boolean;
  } = {}
) {
  const inject = options.inject ?? [
    {
      data: new Uint8Array(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }).data
      ),
      programId: ComputeBudgetProgram.programId,
    },
  ];
  return (transaction: VersionedTransaction): VersionedTransaction => {
    const message = transaction.message;
    if (options.replaceBlockhash ?? true) {
      message.recentBlockhash = OTHER_BLOCKHASH;
    }
    for (const { data, programId } of inject) {
      let programIdIndex = message.staticAccountKeys.findIndex((key) =>
        key.equals(programId)
      );
      if (programIdIndex < 0) {
        message.staticAccountKeys.push(programId);
        message.header.numReadonlyUnsignedAccounts += 1;
        programIdIndex = message.staticAccountKeys.length - 1;
      }
      message.compiledInstructions.unshift({
        accountKeyIndexes: [],
        data,
        programIdIndex,
      });
    }
    const patched = new VersionedTransaction(message);
    patched.sign([WALLET]);
    return patched;
  };
}

async function connectedAdapter() {
  const adapter = await createLoyalCherryWalletAdapter();
  await adapter.connect();
  return adapter;
}

function approvedHost(
  options: {
    rejectSigning?: boolean;
    reverseBatch?: boolean;
    signLegacy?: (transaction: Transaction) => Transaction;
    signVersioned?: (transaction: VersionedTransaction) => VersionedTransaction;
  } = {}
): HostHandler {
  const signLegacy =
    options.signLegacy ??
    ((transaction: Transaction) => {
      transaction.partialSign(WALLET);
      return transaction;
    });
  const signVersioned =
    options.signVersioned ??
    ((transaction: VersionedTransaction) => {
      transaction.sign([WALLET]);
      return transaction;
    });

  return (request) => {
    if (request.method === "wallet.connect") {
      return response(request, { publicKey: WALLET.publicKey.toBase58() });
    }
    if (options.rejectSigning) {
      return {
        type: "cherry:response",
        id: request.id,
        error: { code: "USER_REJECTED", message: "User rejected request." },
      };
    }
    if (request.method === "wallet.signMessage") {
      const message = base64ToBytes(requiredStringParam(request, "message"));
      return response(request, {
        signature: bytesToBase64(nacl.sign.detached(message, WALLET.secretKey)),
      });
    }
    if (request.method === "wallet.signTransaction") {
      const transaction = deserializeTransaction(
        requiredStringParam(request, "transaction")
      );
      const signed =
        transaction instanceof VersionedTransaction
          ? signVersioned(transaction)
          : signLegacy(transaction);
      return response(request, {
        transaction: serializeTransaction(signed),
      });
    }
    if (request.method === "wallet.signTransactions") {
      const encoded = request.params?.transactions;
      if (!Array.isArray(encoded)) {
        throw new Error("Expected a transaction batch.");
      }
      const signed = encoded.map((value) => {
        if (typeof value !== "string") {
          throw new Error("Expected a serialized transaction.");
        }
        const transaction = deserializeTransaction(value);
        return serializeTransaction(
          transaction instanceof VersionedTransaction
            ? signVersioned(transaction)
            : signLegacy(transaction)
        );
      });
      return response(request, {
        transactions: options.reverseBatch ? signed.reverse() : signed,
      });
    }
    throw new Error(`Unexpected Cherry method: ${request.method}`);
  };
}

function response(request: BridgeRequest, result: unknown): BridgeResponse {
  return { type: "cherry:response", id: request.id, result };
}

function dispatchBridgeResponse(response: BridgeResponse): void {
  for (const listener of messageListeners) {
    listener({ data: response });
  }
}

function requiredStringParam(request: BridgeRequest, name: string): string {
  const value = request.params?.[name];
  if (typeof value !== "string") {
    throw new Error(`${request.method} requires ${name}.`);
  }
  return value;
}

function legacyTransaction(recipient: typeof RECIPIENT_A): Transaction {
  return new Transaction({
    feePayer: WALLET.publicKey,
    recentBlockhash: BLOCKHASH,
  }).add(instruction(recipient));
}

function versionedTransaction(
  recipient: typeof RECIPIENT_A
): VersionedTransaction {
  const message = new TransactionMessage({
    instructions: [instruction(recipient)],
    payerKey: WALLET.publicKey,
    recentBlockhash: BLOCKHASH,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function instruction(recipient: typeof RECIPIENT_A): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.from([1]),
    keys: [
      { pubkey: WALLET.publicKey, isSigner: true, isWritable: true },
      { pubkey: COSIGNER.publicKey, isSigner: true, isWritable: false },
      { pubkey: recipient, isSigner: false, isWritable: true },
    ],
    programId: SystemProgram.programId,
  });
}

function serializeTransaction(
  transaction: Transaction | VersionedTransaction
): string {
  const bytes =
    transaction instanceof VersionedTransaction
      ? transaction.serialize()
      : transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
  return bytesToBase64(bytes);
}

function deserializeTransaction(
  encoded: string
): Transaction | VersionedTransaction {
  const bytes = base64ToBytes(encoded);
  try {
    const versioned = VersionedTransaction.deserialize(bytes);
    return versioned.version === "legacy" ? Transaction.from(bytes) : versioned;
  } catch {
    return Transaction.from(bytes);
  }
}

function signatureForLegacy(
  transaction: Transaction,
  publicKey: typeof WALLET.publicKey
): Uint8Array {
  const signature = transaction.signatures.find((entry) =>
    entry.publicKey.equals(publicKey)
  )?.signature;
  if (!signature) {
    throw new Error(`Missing fixture signature for ${publicKey.toBase58()}.`);
  }
  return signature;
}

function signatureForVersioned(
  transaction: VersionedTransaction,
  publicKey: typeof WALLET.publicKey
): Uint8Array {
  return transaction.signatures[requiredSignerIndex(transaction, publicKey)]!;
}

function requiredSignerIndex(
  transaction: VersionedTransaction,
  publicKey: typeof WALLET.publicKey
): number {
  const index = transaction.message.staticAccountKeys
    .slice(0, transaction.message.header.numRequiredSignatures)
    .findIndex((candidate) => candidate.equals(publicKey));
  if (index < 0) {
    throw new Error(`Missing fixture signer ${publicKey.toBase58()}.`);
  }
  return index;
}

function recordingConnection(failure?: Error): {
  calls: Array<{ raw: Uint8Array; options?: SendOptions }>;
  connection: Connection;
} {
  const calls: Array<{ raw: Uint8Array; options?: SendOptions }> = [];
  return {
    calls,
    connection: {
      async sendRawTransaction(
        raw: Uint8Array,
        options?: SendOptions
      ): Promise<string> {
        calls.push({ raw: new Uint8Array(raw), options });
        if (failure) {
          throw failure;
        }
        return RPC_SIGNATURE;
      },
    } as Connection,
  };
}

function keypair(seed: number): Keypair {
  return Keypair.fromSeed(new Uint8Array(32).fill(seed));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
