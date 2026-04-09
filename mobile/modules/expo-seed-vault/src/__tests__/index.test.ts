/**
 * Unit tests for the expo-seed-vault TS wrapper. The native bridge is
 * stubbed so the tests cover type-dispatch and base58/base64 plumbing.
 */

import { Keypair } from "@solana/web3.js";

// Mock before imports so requireNativeModule resolves to the stub.
const nativeStub = {
  isAvailable: jest.fn<Promise<boolean>, []>(),
  authorizeExistingSeed: jest.fn(),
  createNewSeed: jest.fn(),
  importSeed: jest.fn(),
  deauthorize: jest.fn(),
  signTransaction: jest.fn(),
  signMessage: jest.fn(),
  getPublicKey: jest.fn(),
};

jest.mock("expo-modules-core", () => ({
  requireNativeModule: jest.fn(() => nativeStub),
}));

// React Native's Platform is mocked so we can flip OS per-test.
jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

import {
  DEFAULT_SOLANA_DERIVATION_PATH,
  __test__,
  authorizeExistingSeed,
  createNewSeed,
  deauthorize,
  getPublicKey,
  importSeed,
  isAvailable,
  signMessage,
  signTransaction,
} from "../index";

const { encodeBase58, uint8ToBase64, base64ToUint8 } = __test__;

beforeEach(() => {
  Object.values(nativeStub).forEach((fn) => fn.mockReset());
});

describe("default derivation path", () => {
  it("is m/44'/501'/0'/0'", () => {
    expect(DEFAULT_SOLANA_DERIVATION_PATH).toBe("m/44'/501'/0'/0'");
  });
});

describe("base58 encoder", () => {
  it("round-trips through @solana/web3.js PublicKey", () => {
    // Keypair.generate gives a known public key; our encoder should produce
    // the same base58 string as web3.js's toBase58().
    const kp = Keypair.generate();
    const expected = kp.publicKey.toBase58();
    const actual = encodeBase58(kp.publicKey.toBytes());
    expect(actual).toBe(expected);
  });

  it("handles leading-zero bytes", () => {
    const bytes = new Uint8Array([0, 0, 1]);
    expect(encodeBase58(bytes)).toBe("112");
  });
});

describe("base64 helpers", () => {
  it("round-trip arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const b64 = uint8ToBase64(bytes);
    expect(Array.from(base64ToUint8(b64))).toEqual(Array.from(bytes));
  });
});

describe("isAvailable", () => {
  it("delegates to native on Android", async () => {
    nativeStub.isAvailable.mockResolvedValueOnce(true);
    const result = await isAvailable();
    expect(result).toBe(true);
    expect(nativeStub.isAvailable).toHaveBeenCalledTimes(1);
  });

  it("returns false if native throws", async () => {
    nativeStub.isAvailable.mockRejectedValueOnce(new Error("boom"));
    expect(await isAvailable()).toBe(false);
  });
});

describe("seed authorization flows", () => {
  const kp = Keypair.generate();
  const nativeAccount = {
    authToken: 42,
    derivationPath: DEFAULT_SOLANA_DERIVATION_PATH,
    publicKey: uint8ToBase64(kp.publicKey.toBytes()),
  };

  it("authorizeExistingSeed decodes base64 pubkey to base58 address", async () => {
    nativeStub.authorizeExistingSeed.mockResolvedValueOnce(nativeAccount);
    const account = await authorizeExistingSeed();
    expect(nativeStub.authorizeExistingSeed).toHaveBeenCalledWith(
      DEFAULT_SOLANA_DERIVATION_PATH,
    );
    expect(account.authToken).toBe(42);
    expect(account.derivationPath).toBe(DEFAULT_SOLANA_DERIVATION_PATH);
    expect(account.publicKey).toBe(kp.publicKey.toBase58());
  });

  it("createNewSeed forwards the path argument", async () => {
    nativeStub.createNewSeed.mockResolvedValueOnce(nativeAccount);
    await createNewSeed("m/44'/501'/7'/0'");
    expect(nativeStub.createNewSeed).toHaveBeenCalledWith("m/44'/501'/7'/0'");
  });

  it("importSeed uses default path when omitted", async () => {
    nativeStub.importSeed.mockResolvedValueOnce(nativeAccount);
    await importSeed();
    expect(nativeStub.importSeed).toHaveBeenCalledWith(
      DEFAULT_SOLANA_DERIVATION_PATH,
    );
  });
});

describe("signing", () => {
  it("signTransaction base64-encodes payload and decodes signature", async () => {
    const tx = new Uint8Array([1, 2, 3, 4]);
    const sig = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
    nativeStub.signTransaction.mockResolvedValueOnce(uint8ToBase64(sig));

    const out = await signTransaction({
      authToken: 42,
      derivationPath: DEFAULT_SOLANA_DERIVATION_PATH,
      txBytes: tx,
    });

    expect(nativeStub.signTransaction).toHaveBeenCalledWith(
      42,
      DEFAULT_SOLANA_DERIVATION_PATH,
      uint8ToBase64(tx),
    );
    expect(Array.from(out)).toEqual(Array.from(sig));
  });

  it("signMessage base64-encodes payload and decodes signature", async () => {
    const message = new TextEncoder().encode("hello");
    const sig = new Uint8Array([1, 2, 3]);
    nativeStub.signMessage.mockResolvedValueOnce(uint8ToBase64(sig));

    const out = await signMessage({
      authToken: 7,
      derivationPath: DEFAULT_SOLANA_DERIVATION_PATH,
      message,
    });

    expect(nativeStub.signMessage).toHaveBeenCalledWith(
      7,
      DEFAULT_SOLANA_DERIVATION_PATH,
      uint8ToBase64(message),
    );
    expect(Array.from(out)).toEqual(Array.from(sig));
  });
});

describe("getPublicKey", () => {
  it("decodes the native base64 pubkey to base58", async () => {
    const kp = Keypair.generate();
    nativeStub.getPublicKey.mockResolvedValueOnce(
      uint8ToBase64(kp.publicKey.toBytes()),
    );
    const address = await getPublicKey({
      authToken: 42,
      derivationPath: DEFAULT_SOLANA_DERIVATION_PATH,
    });
    expect(address).toBe(kp.publicKey.toBase58());
  });
});

describe("deauthorize", () => {
  it("forwards the auth token to native", async () => {
    nativeStub.deauthorize.mockResolvedValueOnce(undefined);
    await deauthorize(42);
    expect(nativeStub.deauthorize).toHaveBeenCalledWith(42);
  });
});
