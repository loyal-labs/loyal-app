import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let encrypt: (plaintext: string) => Promise<{
  ciphertext: string;
  iv: string;
} | null>;

const TEST_KEY = "0fegoicH8L0zl6r5Xn7v2y7e8UAhDOyxwWtBTQXWT/A=";

describe("encrypt", () => {
  beforeAll(async () => {
    const loadedModule = await import("../encrypt");
    encrypt = loadedModule.encrypt;
  });

  beforeEach(() => {
    process.env.MESSAGE_ENCRYPTION_KEY = TEST_KEY;
  });

  test("generates different IVs for each encryption", async () => {
    const result1 = await encrypt("same message");
    const result2 = await encrypt("same message");

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.iv).not.toBe(result2!.iv);
    expect(result1!.ciphertext).not.toBe(result2!.ciphertext);
  });

  test("returns null when key is not set", async () => {
    delete process.env.MESSAGE_ENCRYPTION_KEY;

    const result = await encrypt("test");

    expect(result).toBeNull();
  });

  test("returns null when key is invalid length", async () => {
    process.env.MESSAGE_ENCRYPTION_KEY = "dG9vc2hvcnQ="; // "tooshort" base64

    const result = await encrypt("test");

    expect(result).toBeNull();
  });

  test("returns null when key is not valid base64", async () => {
    process.env.MESSAGE_ENCRYPTION_KEY = "not-valid-base64!!!";

    const result = await encrypt("test");

    expect(result).toBeNull();
  });

  test("IV is 12 bytes when decoded", async () => {
    const result = await encrypt("test");

    expect(result).not.toBeNull();
    const ivBytes = Buffer.from(result!.iv, "base64");
    expect(ivBytes.length).toBe(12);
  });
});
