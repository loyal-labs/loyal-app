import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { createKeypairMessageSigner } from "../src/webcrypto";

const ED25519_ALGORITHM = { name: "Ed25519" } as const;

function toBase64Url(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

describe("createKeypairMessageSigner", () => {
  test("signs a message that verifies with WebCrypto", async () => {
    const keypair = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    const signMessage = createKeypairMessageSigner(keypair);
    const message = new TextEncoder().encode("loyal-private-transactions");

    const signature = await signMessage(message);
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      {
        crv: "Ed25519",
        ext: false,
        kty: "OKP",
        x: toBase64Url(keypair.publicKey.toBytes()),
      },
      ED25519_ALGORITHM,
      false,
      ["verify"]
    );

    const isValid = await crypto.subtle.verify(
      ED25519_ALGORITHM,
      publicKey,
      signature,
      message
    );

    expect(signature).toHaveLength(64);
    expect(isValid).toBe(true);
  });
});
