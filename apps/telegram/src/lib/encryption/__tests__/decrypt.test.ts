import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { EncryptedData } from "../types";

mock.module("server-only", () => ({}));

let encrypt: (plaintext: string) => Promise<EncryptedData | null>;
let decrypt: (encrypted: EncryptedData) => Promise<string | null>;

const TEST_KEY = "0fegoicH8L0zl6r5Xn7v2y7e8UAhDOyxwWtBTQXWT/A=";

describe("decrypt", () => {
  beforeAll(async () => {
    const [encryptModule, decryptModule] = await Promise.all([
      import("../encrypt"),
      import("../decrypt"),
    ]);
    encrypt = encryptModule.encrypt;
    decrypt = decryptModule.decrypt;
  });

  beforeEach(() => {
    process.env.MESSAGE_ENCRYPTION_KEY = TEST_KEY;
  });

  test("decrypts encrypted data back to original", async () => {
    const original = "hello world";
    const encrypted = await encrypt(original);

    expect(encrypted).not.toBeNull();
    const decrypted = await decrypt(encrypted!);

    expect(decrypted).toBe(original);
  });

  test("decrypts empty string", async () => {
    const encrypted = await encrypt("");

    expect(encrypted).not.toBeNull();
    const decrypted = await decrypt(encrypted!);

    expect(decrypted).toBe("");
  });

  test("decrypts unicode characters", async () => {
    const original = "Hello 👋 World 🌍 日本語";
    const encrypted = await encrypt(original);

    expect(encrypted).not.toBeNull();
    const decrypted = await decrypt(encrypted!);

    expect(decrypted).toBe(original);
  });

  test("decrypts long messages", async () => {
    const original = "a".repeat(10000);
    const encrypted = await encrypt(original);

    expect(encrypted).not.toBeNull();
    const decrypted = await decrypt(encrypted!);

    expect(decrypted).toBe(original);
  });

  test("returns null for tampered ciphertext", async () => {
    const encrypted = await encrypt("secret message");
    expect(encrypted).not.toBeNull();

    const tampered: EncryptedData = {
      ...encrypted!,
      ciphertext: encrypted!.ciphertext.slice(0, -4) + "XXXX",
    };

    const result = await decrypt(tampered);
    expect(result).toBeNull();
  });

  test("returns null for tampered IV", async () => {
    const encrypted = await encrypt("secret message");
    expect(encrypted).not.toBeNull();

    const tampered: EncryptedData = {
      ...encrypted!,
      iv: Buffer.from("tampered1234").toString("base64"),
    };

    const result = await decrypt(tampered);
    expect(result).toBeNull();
  });

  test("returns null when key is not set", async () => {
    const encrypted = await encrypt("test");
    expect(encrypted).not.toBeNull();

    delete process.env.MESSAGE_ENCRYPTION_KEY;

    const result = await decrypt(encrypted!);
    expect(result).toBeNull();
  });

  test("returns null when key is wrong", async () => {
    const encrypted = await encrypt("test");
    expect(encrypted).not.toBeNull();

    // Different key
    process.env.MESSAGE_ENCRYPTION_KEY =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    const result = await decrypt(encrypted!);
    expect(result).toBeNull();
  });

  test("returns null for invalid base64 ciphertext", async () => {
    const invalid: EncryptedData = {
      ciphertext: "not-valid-base64!!!",
      iv: Buffer.from("123456789012").toString("base64"),
    };

    const result = await decrypt(invalid);
    expect(result).toBeNull();
  });

  test("returns null for empty ciphertext", async () => {
    const invalid: EncryptedData = {
      ciphertext: "",
      iv: Buffer.from("123456789012").toString("base64"),
    };

    const result = await decrypt(invalid);
    expect(result).toBeNull();
  });
});
