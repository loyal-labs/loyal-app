import { describe, expect, test } from "bun:test";

import {
  AUTH_SESSION_COOKIE_NAME,
  buildWalletAuthMessage,
  createAuthSessionTokenClaims,
  mapAuthSessionTokenClaimsToUser,
  walletChallengeTokenClaimsSchema,
} from "../index";

describe("session primitives", () => {
  test("uses the shared auth session cookie name", () => {
    expect(AUTH_SESSION_COOKIE_NAME).toBe("loyal_email_session");
  });

  test("maps session users to token claims and back", () => {
    const claims = createAuthSessionTokenClaims({
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      displayAddress: "wallet-1",
      provider: "solana",
      walletAddress: "wallet-1",
      smartAccountAddress: "smart-account-1",
    });

    expect(mapAuthSessionTokenClaimsToUser(claims)).toEqual({
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      displayAddress: "wallet-1",
      provider: "solana",
      walletAddress: "wallet-1",
      smartAccountAddress: "smart-account-1",
    });
  });
});

describe("wallet primitives", () => {
  test("accepts wallet challenge token claims", () => {
    const parsed = walletChallengeTokenClaimsSchema.safeParse({
      tokenType: "wallet_challenge",
      version: 1,
      origin: "https://app.askloyal.com",
      walletAddress: "wallet-1",
      message: "Sign in to askloyal",
    });

    expect(parsed.success).toBe(true);
  });

  test("builds a stable wallet auth message", () => {
    expect(
      buildWalletAuthMessage({
        appName: "askloyal",
        origin: "https://app.askloyal.com",
        walletAddress: "wallet-1",
        nonce: "nonce-1",
        issuedAt: "2099-03-11T12:00:00.000Z",
        expiresAt: "2099-03-11T12:10:00.000Z",
      })
    ).toContain("Sign in to askloyal");
  });
});
