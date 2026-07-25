// Guards the MWA rejection → failure-reason mapping behind ASK-1872. The
// native module signals every session problem with a string `code`, and
// lifecycle telemetry maps any coded error to `request_failed` — so an
// unreachable wallet paged on-call as an HTTP failure that never happened.
// Nothing in the type system catches a regression: every code is a valid
// string, so the classification is asserted directly against the codes
// SolanaMobileWalletAdapterModule.kt actually rejects with.

import { PublicKey } from "@solana/web3.js";

// web3.js loads its WebSocket client eagerly; these tests never touch RPC.
jest.mock("rpc-websockets", () => ({
  CommonClient: class CommonClient {},
  WebSocket: jest.fn(),
}));

// react-native ships untransformed Flow syntax and jest.config.js only
// transforms @noble — the signer's Platform/TurboModuleRegistry import would
// otherwise fail the suite before any assertion runs.
jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  TurboModuleRegistry: { get: () => ({}) },
}));

const mockTransact = jest.fn();

jest.mock(
  "@solana-mobile/mobile-wallet-adapter-protocol-web3js",
  () => ({ transact: (...args: unknown[]) => mockTransact(...args) }),
  { virtual: true },
);

jest.mock("@/config/env", () => ({ env: { solanaEnv: "mainnet" } }));

// Pulled in by the signer for auth-token persistence; untransformed ESM, and
// nothing here reaches the store.
jest.mock("../mwa-account-storage", () => ({
  clearMwaAccount: jest.fn(),
  storeMwaAccount: jest.fn(),
}));

// eslint-disable-next-line import/first
import { MwaSigner } from "../mwa-signer";
// eslint-disable-next-line import/first
import { WalletRejectedError } from "../rejection";
// eslint-disable-next-line import/first
import { WalletSessionError } from "../wallet-session-error";

function codedError(code: string | number, message = "native failure"): Error {
  return Object.assign(new Error(message), { code });
}

const publicKey = PublicKey.unique().toBase58();
const authToken = "auth-token";

function signer(): MwaSigner {
  return new MwaSigner(authToken, publicKey);
}

/** Rejects before the callback runs — `startSession` never resolved. */
function failBeforeSession(error: unknown) {
  mockTransact.mockImplementation(async () => {
    throw error;
  });
}

/**
 * Rejects after the callback runs — the session opened and reauthorized, so
 * the failure belongs to the signing call.
 */
function failAfterSession(error: unknown) {
  const wallet = {
    authorize: async () => ({
      accounts: [
        { address: Buffer.from(new PublicKey(publicKey).toBytes()).toString("base64") },
      ],
      auth_token: authToken,
    }),
    signMessages: async () => {
      throw error;
    },
  };
  mockTransact.mockImplementation(async (callback: (w: unknown) => unknown) =>
    callback(wallet),
  );
}

async function failureOf(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("MWA session error classification", () => {
  beforeEach(() => jest.clearAllMocks());

  // The ExecutionException raised when the wallet app never connects back to
  // the local association socket reaches JS as RN's catch-all EUNSPECIFIED.
  it("reports an unreachable wallet as connection_failed", async () => {
    failBeforeSession(codedError("EUNSPECIFIED"));

    const error = await failureOf(signer().signMessage(new Uint8Array([1])));

    expect(error).toBeInstanceOf(WalletSessionError);
    expect(error).toMatchObject({
      failure: "connection_failed",
      walletCode: "EUNSPECIFIED",
    });
  });

  // The module rejects with a sentence as the code, not a symbolic constant.
  it("reports the association wait as timeout", async () => {
    failBeforeSession(
      codedError("Timed out waiting for local association to be ready"),
    );

    expect(await failureOf(signer().signMessage(new Uint8Array([1])))).toMatchObject(
      { failure: "timeout" },
    );
  });

  it("reports a missing wallet app as unavailable", async () => {
    failBeforeSession(codedError("ERROR_WALLET_NOT_FOUND"));

    expect(await failureOf(signer().signMessage(new Uint8Array([1])))).toMatchObject(
      { failure: "unavailable" },
    );
  });

  // Same catch-all code as the unreachable case — only the session flag tells
  // them apart, and confusing them would point triage at the wrong system.
  it("reports a post-connect failure as signing_failed", async () => {
    failAfterSession(codedError("EUNSPECIFIED"));

    expect(await failureOf(signer().signMessage(new Uint8Array([1])))).toMatchObject(
      { failure: "signing_failed" },
    );
  });

  // Backing out of the chooser rejects with a sentence-shaped code that the
  // pre-ASK-1872 cancellation check missed, so it read as a hard failure.
  it("still treats backing out of the chooser as a rejection", async () => {
    failBeforeSession(
      codedError(
        "Session not established: Local association cancelled by user",
        "Local association cancelled by user",
      ),
    );

    expect(await failureOf(signer().signMessage(new Uint8Array([1])))).toBeInstanceOf(
      WalletRejectedError,
    );
  });

  it("still treats an in-wallet decline as a rejection", async () => {
    // ERROR_NOT_SIGNED.
    failAfterSession(codedError(-3));

    expect(await failureOf(signer().signMessage(new Uint8Array([1])))).toBeInstanceOf(
      WalletRejectedError,
    );
  });

  // Our own plain-Error instructions (reconnect, signature mismatch) must not
  // be swallowed into a generic session failure.
  it("passes uncoded errors through untouched", async () => {
    const raw = new Error("Wallet authorization is no longer valid.");
    failAfterSession(raw);

    expect(await failureOf(signer().signMessage(new Uint8Array([1])))).toBe(raw);
  });
});
