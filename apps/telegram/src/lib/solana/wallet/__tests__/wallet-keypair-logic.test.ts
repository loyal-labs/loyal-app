import { Keypair } from "@solana/web3.js";
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

// --- Mock cloud-storage module ---

type GetCloudValueFn = (key: string) => Promise<string | null>;
type SetCloudValueFn = (key: string, value: string) => Promise<boolean>;
type DeleteCloudValueFn = (keys: string | string[]) => Promise<boolean>;

let getCloudValueImpl: GetCloudValueFn = async () => null;
let setCloudValueImpl: SetCloudValueFn = async () => true;
let deleteCloudValueImpl: DeleteCloudValueFn = async () => true;

let getCloudValueCalls: string[] = [];

mock.module("@/lib/telegram/mini-app/cloud-storage", () => ({
  getCloudValue: async (key: string) => {
    getCloudValueCalls.push(key);
    return getCloudValueImpl(key);
  },
  setCloudValue: async (key: string, value: string) =>
    setCloudValueImpl(key, value),
  deleteCloudValue: async (keys: string | string[]) =>
    deleteCloudValueImpl(keys),
}));

let ensureWalletKeypair: typeof import("../wallet-keypair-logic").ensureWalletKeypair;
let CloudStorageUnavailableError: typeof import("../wallet-keypair-logic").CloudStorageUnavailableError;

beforeAll(async () => {
  const mod = await import("../wallet-keypair-logic");
  ensureWalletKeypair = mod.ensureWalletKeypair;
  CloudStorageUnavailableError = mod.CloudStorageUnavailableError;
});

beforeEach(() => {
  getCloudValueCalls = [];
  getCloudValueImpl = async () => null;
  setCloudValueImpl = async () => true;
  deleteCloudValueImpl = async () => true;
});

// Helper: create a stored keypair in cloud storage format
const makeStoredKeypair = () => {
  const kp = Keypair.generate();
  const publicKeyStr = kp.publicKey.toBase58();
  const secretKeyStr = JSON.stringify(Array.from(kp.secretKey));
  return {
    keypair: kp,
    stored: {
      solana_public_key: publicKeyStr,
      solana_secret_key: secretKeyStr,
    },
    // Mock that returns per-key values for individual getCloudValue calls
    perKeyImpl: async (key: string) => {
      if (key === "solana_public_key") return publicKeyStr;
      if (key === "solana_secret_key") return secretKeyStr;
      return null;
    },
  };
};

describe("ensureWalletKeypair", () => {
  test("returns existing keypair when cloud storage has valid data", async () => {
    const { keypair, perKeyImpl } = makeStoredKeypair();
    getCloudValueImpl = perKeyImpl;

    const result = await ensureWalletKeypair();

    expect(result.isNew).toBe(false);
    expect(result.keypair.publicKey.toBase58()).toBe(
      keypair.publicKey.toBase58()
    );
  });

  test("generates new keypair when cloud storage returns empty strings (new user)", async () => {
    getCloudValueImpl = async () => "";

    const result = await ensureWalletKeypair();

    expect(result.isNew).toBe(true);
    expect(result.keypair).toBeDefined();
  });

  test("retries when cloud storage returns null, then succeeds", async () => {
    const { keypair, perKeyImpl } = makeStoredKeypair();
    let round = 0;
    let callsInRound = 0;
    getCloudValueImpl = async (key: string) => {
      callsInRound += 1;
      // Each round fetches 2 keys (public + secret in parallel)
      if (callsInRound > 2) {
        callsInRound = 1;
        round += 1;
      }
      if (round === 0) callsInRound = callsInRound; // first 2 calls = round 0
      // First 2 rounds fail (return null), third succeeds
      const currentRound = Math.floor((getCloudValueCalls.length - 1) / 2);
      if (currentRound < 2) return null;
      return perKeyImpl(key);
    };

    const result = await ensureWalletKeypair();

    expect(result.isNew).toBe(false);
    expect(result.keypair.publicKey.toBase58()).toBe(
      keypair.publicKey.toBase58()
    );
    // 3 rounds × 2 keys per round = 6 individual calls
    expect(getCloudValueCalls.length).toBe(6);
  });

  test("throws CloudStorageUnavailableError after all retries return null", async () => {
    getCloudValueImpl = async () => null;

    await expect(ensureWalletKeypair()).rejects.toThrow(
      CloudStorageUnavailableError
    );
  });

  test("retries when cloud storage throws, then succeeds", async () => {
    const { keypair, perKeyImpl } = makeStoredKeypair();
    let callCount = 0;
    getCloudValueImpl = async (key: string) => {
      callCount += 1;
      // First round (calls 1-2) throws
      if (callCount <= 2) throw new Error("SDK not ready");
      return perKeyImpl(key);
    };

    const result = await ensureWalletKeypair();

    expect(result.isNew).toBe(false);
    expect(result.keypair.publicKey.toBase58()).toBe(
      keypair.publicKey.toBase58()
    );
  });

  test("throws CloudStorageUnavailableError after all retries throw", async () => {
    getCloudValueImpl = async () => {
      throw new Error("SDK not ready");
    };

    await expect(ensureWalletKeypair()).rejects.toThrow(
      CloudStorageUnavailableError
    );
  });

  test("generates new keypair only when cloud storage returns empty strings on first attempt", async () => {
    // Empty strings on first try = genuinely new user (no retry needed)
    getCloudValueImpl = async () => "";

    const result = await ensureWalletKeypair();

    expect(result.isNew).toBe(true);
    // Should NOT have retried — empty strings are a definitive "not found"
    // 2 individual calls (public + secret) in a single round
    expect(getCloudValueCalls.length).toBe(2);
  });
});
