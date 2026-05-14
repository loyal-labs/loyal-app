import { describe, expect, test } from "bun:test";

import { createSignInDataForEnv, verifySIWSForEnv } from "../sign-in";

describe("solana sign-in", () => {
  test("creates sign-in payloads with the active solana env as chain id", async () => {
    const payload = await createSignInDataForEnv("mainnet");

    expect(payload.chainId).toBe("mainnet");
  });

  test("rejects sign-in payloads from a different solana env", () => {
    const verified = verifySIWSForEnv(
      {
        domain: "askloyal.com",
        statement:
          "Clicking Sign or Approve only means you have proved this wallet is owned by you. This request will not trigger any blockchain transaction or cost any gas fee.",
        version: "1",
        nonce: "abcdefgh",
        chainId: "mainnet",
        issuedAt: new Date().toISOString(),
      },
      {
        account: {
          address: "ignored",
          publicKey: [],
          chains: [],
          features: [],
        },
        signature: [],
        signedMessage: [],
      },
      "devnet"
    );

    expect(verified).toBe(false);
  });
});
