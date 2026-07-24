/**
 * Tests for SeedVaultSigner. The `expo-seed-vault` module is mocked so
 * these tests cover the signer's contract: kind/publicKey accessors,
 * signMessage forwarding, transaction message-byte extraction, and
 * signature injection into Legacy / VersionedTransactions.
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";

// web3.js loads its WebSocket client eagerly, but these signer tests never use
// RPC. Jest hoists this mock ahead of the web3 import so it does not evaluate
// the ESM-only uuid dependency nested under rpc-websockets.
jest.mock("rpc-websockets", () => ({
  CommonClient: class CommonClient {},
  WebSocket: jest.fn(),
}));

const mockSignMessage = jest.fn<Promise<Uint8Array>, [unknown]>();
const mockSignTransaction = jest.fn<Promise<Uint8Array>, [unknown]>();
const mockSignTransactions = jest.fn<Promise<Uint8Array[]>, [unknown]>();
const mockListAuthorizedSeeds = jest.fn<
  Promise<{ authToken: string; derivationPath: string; publicKey: string }[]>,
  [unknown?]
>();

jest.mock("expo-seed-vault", () => ({
  signMessage: (args: unknown) => mockSignMessage(args),
  signTransaction: (args: unknown) => mockSignTransaction(args),
  signTransactions: (args: unknown) => mockSignTransactions(args),
  listAuthorizedSeeds: (args?: unknown) => mockListAuthorizedSeeds(args),
}));

const mockStoreVaultAccount = jest.fn<Promise<void>, [unknown]>();
const mockClearVaultAccount = jest.fn<Promise<void>, []>();

jest.mock("../vault-account-storage", () => ({
  storeVaultAccount: (account: unknown) => mockStoreVaultAccount(account),
  clearVaultAccount: () => mockClearVaultAccount(),
}));

// eslint-disable-next-line import/first
import { SeedVaultSigner } from "../seed-vault-signer";
// eslint-disable-next-line import/first
import { WalletRejectedError } from "../rejection";

const authToken = "42";
const derivationPath = "m/44'/501'/0'/0'";
const kp = Keypair.generate();
const address = kp.publicKey.toBase58();

const invalidAuthTokenError = () =>
  new Error("signMessages failed with result=1002");
const walletDeclineError = () => new Error("signMessages failed with result=0");

beforeEach(() => {
  mockSignMessage.mockReset();
  mockSignTransaction.mockReset();
  mockSignTransactions.mockReset();
  mockListAuthorizedSeeds.mockReset();
  mockStoreVaultAccount.mockReset();
  mockClearVaultAccount.mockReset();
  mockStoreVaultAccount.mockResolvedValue(undefined);
  mockClearVaultAccount.mockResolvedValue(undefined);
});

describe("SeedVaultSigner", () => {
  it("exposes kind and public key", () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    expect(signer.kind).toBe("seed-vault");
    expect(signer.publicKey.toBase58()).toBe(address);
    expect(signer.authToken).toBe(authToken);
    expect(signer.derivationPath).toBe(derivationPath);
  });

  it("signMessage forwards the bytes to the native bridge", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    const stubSig = new Uint8Array([9, 8, 7]);
    mockSignMessage.mockResolvedValueOnce(stubSig);

    const msg = new TextEncoder().encode("hello");
    const sig = await signer.signMessage(msg);

    expect(mockSignMessage).toHaveBeenCalledWith({
      authToken,
      derivationPath,
      message: msg,
    });
    expect(sig).toBe(stubSig);
  });

  it("signTransaction extracts message bytes and injects sig for Legacy tx", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    // 64 bytes of zeros — stand-in for a vault signature
    const fakeSig = new Uint8Array(64);
    mockSignTransaction.mockResolvedValueOnce(fakeSig);

    const recipient = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(address),
        toPubkey: recipient,
        lamports: 1,
      }),
    );
    tx.feePayer = new PublicKey(address);
    tx.recentBlockhash = new PublicKey(
      "11111111111111111111111111111112",
    ).toBase58();

    const expectedMessage = tx.serializeMessage();

    await signer.signTransaction(tx);

    // Native bridge was invoked with the message bytes (not the full tx).
    expect(mockSignTransaction).toHaveBeenCalledTimes(1);
    const callArg = mockSignTransaction.mock.calls[0][0] as {
      authToken: string;
      derivationPath: string;
      txBytes: Uint8Array;
    };
    expect(callArg.authToken).toBe(authToken);
    expect(callArg.derivationPath).toBe(derivationPath);
    expect(Array.from(callArg.txBytes)).toEqual(Array.from(expectedMessage));

    // The fake signature is injected into the transaction.
    expect(tx.signatures).toHaveLength(1);
    expect(tx.signatures[0].publicKey.toBase58()).toBe(address);
    expect(tx.signatures[0].signature).not.toBeNull();
    expect(Array.from(tx.signatures[0].signature!)).toEqual(
      Array.from(fakeSig),
    );
  });

  it("signTransaction injects sig at slot 0 for VersionedTransaction", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    const fakeSig = new Uint8Array(64);
    mockSignTransaction.mockResolvedValueOnce(fakeSig);

    const payer = new PublicKey(address);
    const recipient = Keypair.generate().publicKey;
    const blockhash = new PublicKey(
      "11111111111111111111111111111112",
    ).toBase58();
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: recipient,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(message);

    const expectedMessage = vtx.message.serialize();

    await signer.signTransaction(vtx);

    const callArg = mockSignTransaction.mock.calls[0][0] as {
      txBytes: Uint8Array;
    };
    expect(Array.from(callArg.txBytes)).toEqual(Array.from(expectedMessage));
    expect(Array.from(vtx.signatures[0])).toEqual(Array.from(fakeSig));
  });

  it("signAllTransactions batches into one vault prompt", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    mockSignTransactions.mockResolvedValueOnce([
      new Uint8Array(64),
      new Uint8Array(64),
    ]);

    const payer = new PublicKey(address);
    const blockhash = new PublicKey(
      "11111111111111111111111111111112",
    ).toBase58();
    const txs = [1, 2].map((lamports) => {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: Keypair.generate().publicKey,
          lamports,
        }),
      );
      tx.feePayer = payer;
      tx.recentBlockhash = blockhash;
      return tx;
    });

    await signer.signAllTransactions(txs);
    expect(mockSignTransactions).toHaveBeenCalledTimes(1);
    expect(mockSignTransaction).not.toHaveBeenCalled();
    const callArg = mockSignTransactions.mock.calls[0][0] as {
      txs: Uint8Array[];
    };
    expect(callArg.txs).toHaveLength(2);
    // Every transaction got its signature injected.
    for (const tx of txs) {
      expect(tx.signatures[0].signature).not.toBeNull();
    }
  });

  it("recovers from an invalid auth token via listAuthorizedSeeds and retries", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    const stubSig = new Uint8Array([1, 2, 3]);
    mockSignMessage
      .mockRejectedValueOnce(invalidAuthTokenError())
      .mockResolvedValueOnce(stubSig);
    mockListAuthorizedSeeds.mockResolvedValueOnce([
      { authToken: "77", derivationPath, publicKey: address },
    ]);

    const sig = await signer.signMessage(new Uint8Array([0]));

    expect(sig).toBe(stubSig);
    // Retry used the refreshed token, and it was persisted for next launch.
    expect(
      (mockSignMessage.mock.calls[1][0] as { authToken: string }).authToken,
    ).toBe("77");
    expect(signer.authToken).toBe("77");
    expect(mockStoreVaultAccount).toHaveBeenCalledWith({
      authToken: "77",
      derivationPath,
      publicKey: address,
    });
    expect(mockClearVaultAccount).not.toHaveBeenCalled();
  });

  it("maps a direct vault decline to WalletRejectedError", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    mockSignMessage.mockRejectedValueOnce(walletDeclineError());

    await expect(
      signer.signMessage(new Uint8Array([0])),
    ).rejects.toBeInstanceOf(WalletRejectedError);
    expect(mockListAuthorizedSeeds).not.toHaveBeenCalled();
    expect(mockClearVaultAccount).not.toHaveBeenCalled();
  });

  it("maps a decline after auth-token recovery to WalletRejectedError", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    mockSignMessage
      .mockRejectedValueOnce(invalidAuthTokenError())
      .mockRejectedValueOnce(walletDeclineError());
    mockListAuthorizedSeeds.mockResolvedValueOnce([
      { authToken: "77", derivationPath, publicKey: address },
    ]);

    await expect(
      signer.signMessage(new Uint8Array([0])),
    ).rejects.toBeInstanceOf(WalletRejectedError);
    expect(mockSignMessage).toHaveBeenCalledTimes(2);
    expect(mockStoreVaultAccount).toHaveBeenCalledWith({
      authToken: "77",
      derivationPath,
      publicKey: address,
    });
    expect(mockClearVaultAccount).not.toHaveBeenCalled();
  });

  it("clears the stored account and asks to reconnect when no live authorization exists", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    mockSignMessage.mockRejectedValue(invalidAuthTokenError());
    mockListAuthorizedSeeds.mockResolvedValueOnce([]);

    await expect(signer.signMessage(new Uint8Array([0]))).rejects.toThrow(
      /reconnect your wallet/i,
    );
    expect(mockSignMessage).toHaveBeenCalledTimes(1); // no blind retry
    expect(mockClearVaultAccount).toHaveBeenCalledTimes(1);
  });

  it("does not run recovery for unrelated errors", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    mockSignMessage.mockRejectedValueOnce(
      new Error("signMessages failed with result=1004"),
    );

    await expect(signer.signMessage(new Uint8Array([0]))).rejects.toThrow(
      "result=1004",
    );
    expect(mockListAuthorizedSeeds).not.toHaveBeenCalled();
    expect(mockClearVaultAccount).not.toHaveBeenCalled();
  });
});
