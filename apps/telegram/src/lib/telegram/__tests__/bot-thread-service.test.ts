import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type EncryptResult = { ciphertext: string; iv: string } | null;

let encryptImpl: (plaintext: string) => Promise<EncryptResult> = async () => ({
  ciphertext: "ciphertext",
  iv: "iv",
});
const encryptCalls: string[] = [];

type BatchResult = unknown[];
let batchImpl: (queries: unknown[]) => Promise<BatchResult> = async () => [
  [{ id: "message-1" }],
  [],
];
const batchCalls: unknown[][] = [];

mock.module("@/lib/encryption", () => ({
  encrypt: async (plaintext: string) => {
    encryptCalls.push(plaintext);
    return encryptImpl(plaintext);
  },
  decrypt: async () => null,
}));

mock.module("@/lib/core/database", () => ({
  getDatabase: () => ({
    batch: async (queries: unknown[]) => {
      batchCalls.push(queries);
      return batchImpl(queries);
    },
    insert: () => ({
      values: () => ({
        returning: () => ({ kind: "insert-returning" }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ kind: "update-where" }),
      }),
    }),
  }),
}));

let addMessage: typeof import("../bot-thread-service").addMessage;

describe("addMessage", () => {
  beforeAll(async () => {
    const loadedModule = await import("../bot-thread-service");
    addMessage = loadedModule.addMessage;
  });

  beforeEach(() => {
    encryptCalls.length = 0;
    batchCalls.length = 0;

    encryptImpl = async () => ({
      ciphertext: "ciphertext",
      iv: "iv",
    });

    batchImpl = async (queries: unknown[]) => {
      expect(queries).toHaveLength(2);
      return [[{ id: "message-1" }], []];
    };
  });

  test("returns message id when batch insert succeeds", async () => {
    const messageId = await addMessage({
      threadId: "thread-1",
      senderType: "user",
      content: "hello",
      telegramMessageId: BigInt(42),
    });

    expect(messageId).toBe("message-1");
    expect(batchCalls).toHaveLength(1);
    expect(encryptCalls).toHaveLength(1);
  });

  test("returns null when encryption fails", async () => {
    encryptImpl = async () => null;

    const messageId = await addMessage({
      threadId: "thread-1",
      senderType: "bot",
      content: "hi",
    });

    expect(messageId).toBeNull();
    expect(batchCalls).toHaveLength(0);
  });

  test("throws when database batch fails", async () => {
    batchImpl = async () => {
      throw new Error("db unavailable");
    };

    await expect(
      addMessage({
        threadId: "thread-1",
        senderType: "user",
        content: "hello",
      })
    ).rejects.toThrow("db unavailable");
  });
});
