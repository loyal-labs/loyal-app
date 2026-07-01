import { describe, expect, mock, test } from "bun:test";
import { WALLET_AUTH_SIWS_STATEMENT } from "@loyal-labs/auth-core";
import { createSignInMessage } from "@solana/wallet-standard-util";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

mock.module("server-only", () => ({}));

const { createWalletAuthSignInInput, verifyWalletSignInOutput } = await import(
  "./wallet-auth-siws"
);

function serializeBytes(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}

function createSignedOutput(args: {
  address?: string;
  input: ReturnType<typeof createWalletAuthSignInInput>;
  keypair: Keypair;
}) {
  const address = args.address ?? args.keypair.publicKey.toBase58();
  const signedMessage = createSignInMessage({
    ...args.input,
    address,
    domain: args.input.domain!,
  });
  const signature = nacl.sign.detached(signedMessage, args.keypair.secretKey);

  return {
    account: {
      address,
      publicKey: serializeBytes(args.keypair.publicKey.toBytes()),
      features: ["solana:signIn"],
      chains: [args.input.chainId!],
    },
    signedMessage: serializeBytes(signedMessage),
    signature: serializeBytes(signature),
    signatureType: "ed25519" as const,
  };
}

describe("wallet SIWS auth verification", () => {
  test("verifies a Wallet Standard sign-in output and derives the address", () => {
    const keypair = Keypair.generate();
    const input = createWalletAuthSignInInput({
      expiresAt: new Date("2099-03-11T12:10:00.000Z"),
      issuedAt: new Date("2099-03-11T12:00:00.000Z"),
      nonce: "abc12345",
      origin: "https://preview.askloyal.com",
      solanaEnv: "devnet",
      statement: WALLET_AUTH_SIWS_STATEMENT,
    });

    const walletAddress = verifyWalletSignInOutput({
      input,
      output: createSignedOutput({ input, keypair }),
    });

    expect(walletAddress).toBe(keypair.publicKey.toBase58());
  });

  test("rejects output signed for a different nonce", () => {
    const keypair = Keypair.generate();
    const input = createWalletAuthSignInInput({
      expiresAt: new Date("2099-03-11T12:10:00.000Z"),
      issuedAt: new Date("2099-03-11T12:00:00.000Z"),
      nonce: "abc12345",
      origin: "https://preview.askloyal.com",
      solanaEnv: "devnet",
      statement: WALLET_AUTH_SIWS_STATEMENT,
    });
    const tamperedInput = {
      ...input,
      nonce: "different123",
    };

    expect(() =>
      verifyWalletSignInOutput({
        input,
        output: createSignedOutput({ input: tamperedInput, keypair }),
      })
    ).toThrow("Wallet sign-in could not be verified.");
  });

  test("rejects address mismatch against the output public key", () => {
    const keypair = Keypair.generate();
    const otherAddress = Keypair.generate().publicKey.toBase58();
    const input = createWalletAuthSignInInput({
      expiresAt: new Date("2099-03-11T12:10:00.000Z"),
      issuedAt: new Date("2099-03-11T12:00:00.000Z"),
      nonce: "abc12345",
      origin: "https://preview.askloyal.com",
      solanaEnv: "devnet",
      statement: WALLET_AUTH_SIWS_STATEMENT,
    });

    expect(() =>
      verifyWalletSignInOutput({
        input,
        output: createSignedOutput({
          address: otherAddress,
          input,
          keypair,
        }),
      })
    ).toThrow("Wallet sign-in account address does not match the public key.");
  });
});
