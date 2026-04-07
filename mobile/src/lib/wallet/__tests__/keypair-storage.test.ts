import {
  generateKeypairInMemory,
  storeKeypair,
  importKeypair,
  loadKeypair,
  hasStoredKeypair,
  clearStoredKeypair,
  getStoredPublicKey,
  changePassword,
} from "../keypair-storage";

const store = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(store.get(key) ?? null),
  ),
  setItemAsync: jest.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    store.delete(key);
    return Promise.resolve();
  }),
}));

beforeEach(() => store.clear());

describe("keypair-storage", () => {
  const password = "strongPassword1!";

  async function generateAndStore(pw: string) {
    const kp = generateKeypairInMemory();
    await storeKeypair(kp, pw);
    return kp;
  }

  it("generates, stores, and loads a keypair", async () => {
    const keypair = await generateAndStore(password);
    expect(keypair.publicKey).toBeTruthy();
    const loaded = await loadKeypair(password);
    expect(loaded).not.toBeNull();
    expect(loaded!.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it("returns null for wrong password", async () => {
    await generateAndStore(password);
    const loaded = await loadKeypair("wrongPassword");
    expect(loaded).toBeNull();
  });

  it("reports hasStoredKeypair correctly", async () => {
    expect(await hasStoredKeypair()).toBe(false);
    await generateAndStore(password);
    expect(await hasStoredKeypair()).toBe(true);
  });

  it("clears stored keypair", async () => {
    await generateAndStore(password);
    await clearStoredKeypair();
    expect(await hasStoredKeypair()).toBe(false);
  });

  it("imports a keypair from secret key bytes", async () => {
    const generated = await generateAndStore(password);
    const secretKey = generated.secretKey;
    await clearStoredKeypair();
    const imported = await importKeypair(secretKey, password);
    expect(imported.publicKey.toBase58()).toBe(
      generated.publicKey.toBase58(),
    );
  });

  it("stores and retrieves public key", async () => {
    const keypair = await generateAndStore(password);
    const storedPk = await getStoredPublicKey();
    expect(storedPk).toBe(keypair.publicKey.toBase58());
  });

  it("changes password successfully", async () => {
    const keypair = await generateAndStore(password);
    const newPassword = "newStrongPass2!";
    await changePassword(keypair, newPassword);
    const loadedOld = await loadKeypair(password);
    expect(loadedOld).toBeNull();
    const loadedNew = await loadKeypair(newPassword);
    expect(loadedNew).not.toBeNull();
    expect(loadedNew!.publicKey.toBase58()).toBe(
      keypair.publicKey.toBase58(),
    );
  });
});
