import { PublicKey } from "@solana/web3.js";

import {
  migrateSignerToPrivy,
  PRIVY_MIGRATION_DONE_KEY,
} from "../privy-migration";
import { WalletRejectedError } from "../rejection";
import type { Signer } from "../signer";

jest.mock("@/lib/storage", () => ({ mmkv: {} }));

function memStorage() {
  const m = new Map<string, boolean>();
  return {
    getBoolean: (k: string) => m.get(k),
    setBoolean: (k: string, v: boolean) => {
      m.set(k, v);
    },
  };
}

function signerWith(sign: () => Promise<Uint8Array>): Signer {
  return {
    kind: "local",
    publicKey: new PublicKey("11111111111111111111111111111111"),
    signMessage: sign,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  };
}

const siws = () => ({
  generateMessage: jest.fn(async () => ({ message: "msg" })),
  login: jest.fn(async () => ({})),
});

test("declined signature leaves the done flag unset and does not log in", async () => {
  const storage = memStorage();
  const s = siws();
  const result = await migrateSignerToPrivy(
    signerWith(async () => {
      throw new WalletRejectedError();
    }),
    s,
    storage,
  );
  expect(result).toBe("declined");
  expect(storage.getBoolean(PRIVY_MIGRATION_DONE_KEY)).toBeUndefined();
  expect(s.login).not.toHaveBeenCalled();
});

test("successful login sets the done flag and sends a base64 signature", async () => {
  const storage = memStorage();
  const s = siws();
  const result = await migrateSignerToPrivy(
    signerWith(async () => new Uint8Array([1, 2, 3])),
    s,
    storage,
  );
  expect(result).toBe("done");
  expect(storage.getBoolean(PRIVY_MIGRATION_DONE_KEY)).toBe(true);
  expect(s.login).toHaveBeenCalledWith({ message: "msg", signature: "AQID" });
});

test("done flag short-circuits without signing", async () => {
  const storage = memStorage();
  storage.setBoolean(PRIVY_MIGRATION_DONE_KEY, true);
  const sign = jest.fn();
  const result = await migrateSignerToPrivy(signerWith(sign), siws(), storage);
  expect(result).toBe("skipped");
  expect(sign).not.toHaveBeenCalled();
});
