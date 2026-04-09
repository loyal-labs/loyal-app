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

const mockSignMessage = jest.fn<Promise<Uint8Array>, [unknown]>();
const mockSignTransaction = jest.fn<Promise<Uint8Array>, [unknown]>();

jest.mock("expo-seed-vault", () => ({
  signMessage: (args: unknown) => mockSignMessage(args),
  signTransaction: (args: unknown) => mockSignTransaction(args),
}));

// eslint-disable-next-line import/first
import { SeedVaultSigner } from "../seed-vault-signer";

const authToken = 42;
const derivationPath = "m/44'/501'/0'/0'";
const kp = Keypair.generate();
const address = kp.publicKey.toBase58();

beforeEach(() => {
  mockSignMessage.mockReset();
  mockSignTransaction.mockReset();
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
      authToken: number;
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

  it("signAllTransactions signs each transaction sequentially", async () => {
    const signer = new SeedVaultSigner(authToken, derivationPath, address);
    mockSignTransaction
      .mockResolvedValueOnce(new Uint8Array(64))
      .mockResolvedValueOnce(new Uint8Array(64));

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
    expect(mockSignTransaction).toHaveBeenCalledTimes(2);
  });
});
