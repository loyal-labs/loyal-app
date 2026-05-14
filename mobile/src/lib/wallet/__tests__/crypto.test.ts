import { encryptSecret, decryptSecret } from "../crypto";

describe("wallet crypto", () => {
  it("encrypts and decrypts a secret key round-trip", async () => {
    const secret = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));
    const password = "testPassword123!";
    const encrypted = await encryptSecret(secret, password);
    const parsed = JSON.parse(encrypted);
    expect(parsed).toHaveProperty("salt");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("data");
    const decrypted = await decryptSecret(encrypted, password);
    expect(decrypted).toBe(secret);
  });

  it("returns null for wrong password", async () => {
    const secret = "test-secret-data";
    const encrypted = await encryptSecret(secret, "correctPassword");
    const decrypted = await decryptSecret(encrypted, "wrongPassword");
    expect(decrypted).toBeNull();
  });

  it("returns null for corrupted ciphertext", async () => {
    const decrypted = await decryptSecret("not-valid-json", "password");
    expect(decrypted).toBeNull();
  });
});
