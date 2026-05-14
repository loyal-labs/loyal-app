import {
  generateKeypairInMemory,
  storeKeypair,
  importKeypair,
  loadKeypair,
  hasStoredKeypair,
  clearStoredKeypair,
  getStoredPublicKey,
  changePin,
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
  const pin = "1234";

  async function generateAndStore(value: string) {
    const kp = generateKeypairInMemory();
    await storeKeypair(kp, value);
    return kp;
  }

  it("generates, stores, and loads a keypair", async () => {
    const keypair = await generateAndStore(pin);
    expect(keypair.publicKey).toBeTruthy();
    const loaded = await loadKeypair(pin);
    expect(loaded).not.toBeNull();
    expect(loaded!.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it("returns null for wrong PIN", async () => {
    await generateAndStore(pin);
    const loaded = await loadKeypair("9999");
    expect(loaded).toBeNull();
  });

  it("reports hasStoredKeypair correctly", async () => {
    expect(await hasStoredKeypair()).toBe(false);
    await generateAndStore(pin);
    expect(await hasStoredKeypair()).toBe(true);
  });

  it("clears stored keypair", async () => {
    await generateAndStore(pin);
    await clearStoredKeypair();
    expect(await hasStoredKeypair()).toBe(false);
  });

  it("imports a keypair from secret key bytes", async () => {
    const generated = await generateAndStore(pin);
    const secretKey = generated.secretKey;
    await clearStoredKeypair();
    const imported = await importKeypair(secretKey, pin);
    expect(imported.publicKey.toBase58()).toBe(
      generated.publicKey.toBase58(),
    );
  });

  it("stores and retrieves public key", async () => {
    const keypair = await generateAndStore(pin);
    const storedPk = await getStoredPublicKey();
    expect(storedPk).toBe(keypair.publicKey.toBase58());
  });

  it("changes PIN successfully", async () => {
    const keypair = await generateAndStore(pin);
    const newPin = "6789";
    await changePin(keypair, newPin);
    const loadedOld = await loadKeypair(pin);
    expect(loadedOld).toBeNull();
    const loadedNew = await loadKeypair(newPin);
    expect(loadedNew).not.toBeNull();
    expect(loadedNew!.publicKey.toBase58()).toBe(
      keypair.publicKey.toBase58(),
    );
  });
});
