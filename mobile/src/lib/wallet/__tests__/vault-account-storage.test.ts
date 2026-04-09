import {
  clearVaultAccount,
  hasVaultAccount,
  loadVaultAccount,
  storeVaultAccount,
} from "../vault-account-storage";

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

const sample = {
  authToken: 42,
  derivationPath: "m/44'/501'/0'/0'",
  publicKey: "9fSPbH1GX3wfwUdkr3ytxi6qSr7AJeEZ9W27qhRbvMX9",
};

describe("vault-account-storage", () => {
  it("reports no account by default", async () => {
    expect(await hasVaultAccount()).toBe(false);
    expect(await loadVaultAccount()).toBeNull();
  });

  it("round-trips a stored account", async () => {
    await storeVaultAccount(sample);
    expect(await hasVaultAccount()).toBe(true);
    expect(await loadVaultAccount()).toEqual(sample);
  });

  it("clears the stored account", async () => {
    await storeVaultAccount(sample);
    await clearVaultAccount();
    expect(await hasVaultAccount()).toBe(false);
    expect(await loadVaultAccount()).toBeNull();
  });

  it("returns null if persisted JSON is malformed", async () => {
    store.set("loyal.seedVaultAccount", "not-json-at-all");
    expect(await loadVaultAccount()).toBeNull();
  });

  it("returns null if persisted fields have wrong types", async () => {
    store.set(
      "loyal.seedVaultAccount",
      JSON.stringify({ authToken: "42", derivationPath: 1, publicKey: null }),
    );
    expect(await loadVaultAccount()).toBeNull();
  });
});
