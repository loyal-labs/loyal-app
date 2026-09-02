import {
  type Connection,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";

import { LocalKeypairSigner } from "@/lib/wallet/signer";

import {
  REBROADCAST_INTERVAL_MS,
  REBROADCAST_MAX_RESENDS,
  signAndSendPreparedOperations,
} from "../send-prepared";

const payer = Keypair.generate();
const signer = new LocalKeypairSigner(payer);
const operation = {
  payer: payer.publicKey,
  instructions: [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  ],
  lookupTableAccounts: [],
};

// A pending signature that never confirms, then expires — the exact case the
// old loop turned into an unbounded stream of paid resends.
function makeConnection(overrides: Partial<Connection> = {}) {
  let sends = 0;
  const connection = {
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100,
    }),
    sendRawTransaction: jest.fn(async () => `sig-${++sends}`),
    confirmTransaction: jest.fn(
      () =>
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Signature has expired")),
            REBROADCAST_INTERVAL_MS * (REBROADCAST_MAX_RESENDS + 5),
          );
        }),
    ),
    getSignatureStatuses: jest.fn().mockResolvedValue({ value: [null] }),
    ...overrides,
  };
  return connection as unknown as Connection & typeof connection;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await jest.runAllTimersAsync();
  return outcome;
}

describe("signAndSendPreparedOperations rebroadcast bounds", () => {
  test("a pending tx sends at most 1 + REBROADCAST_MAX_RESENDS times", async () => {
    const connection = makeConnection();
    const result = await settle(
      signAndSendPreparedOperations({
        connection,
        signer,
        operations: [operation],
      }),
    );
    expect(result.ok).toBe(false);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(
      1 + REBROADCAST_MAX_RESENDS,
    );
  });

  test("send-all-before-confirm stops every loop once a confirm fails", async () => {
    const connection = makeConnection({
      confirmTransaction: jest
        .fn()
        .mockRejectedValue(new Error("Signature has expired")),
    } as Partial<Connection>);
    const result = await settle(
      signAndSendPreparedOperations({
        connection,
        signer,
        operations: [operation, operation],
        sendMode: "send-all-before-confirm",
      }),
    );
    expect(result.ok).toBe(false);
    // Two first-sends; the stop() in `finally` must win before any timer fires.
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("stops resending as soon as confirmation lands", async () => {
    const connection = makeConnection({
      confirmTransaction: jest.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve({ context: { slot: 7 }, value: { err: null } }),
              REBROADCAST_INTERVAL_MS * 2 + 1,
            );
          }),
      ),
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ slot: 7, err: null, confirmationStatus: "confirmed" }],
      }),
    } as Partial<Connection>);
    const result = await settle(
      signAndSendPreparedOperations({
        connection,
        signer,
        operations: [operation],
      }),
    );
    expect(result.ok).toBe(true);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });
});
