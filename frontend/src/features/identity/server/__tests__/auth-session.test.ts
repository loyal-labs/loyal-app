import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let AuthGatewayError: typeof import("../auth-session").AuthGatewayError;
let issueAuthSessionToken: typeof import("../session-token").issueAuthSessionToken;
let mapAuthSessionUserToAuthenticatedPrincipal: typeof import("../auth-session").mapAuthSessionUserToAuthenticatedPrincipal;
let resolveAuthenticatedPrincipalFromRequest: typeof import("../auth-session").resolveAuthenticatedPrincipalFromRequest;

describe("auth session gateway", () => {
  beforeAll(async () => {
    ({
      AuthGatewayError,
      mapAuthSessionUserToAuthenticatedPrincipal,
      resolveAuthenticatedPrincipalFromRequest,
    } = await import("../auth-session"));
    ({ issueAuthSessionToken } = await import("../session-token"));
  });

  beforeEach(() => {
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.AUTH_JWT_SECRET = "local-auth-secret";
    delete process.env.AUTH_JWT_RS256_PUBLIC_KEY;
    delete process.env.AUTH_SESSION_RS256_PUBLIC_KEY;
  });

  test("maps wallet sessions to a stable authenticated principal", () => {
    expect(
      mapAuthSessionUserToAuthenticatedPrincipal({
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        provider: "solana",
        walletAddress: "wallet-1",
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      })
    ).toEqual({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      walletAddress: "wallet-1",
      smartAccountAddress: "smart-account-1",
      settingsPda: "settings-1",
    });
  });

  test("returns null when the request has no auth cookie", async () => {
    const principal = await resolveAuthenticatedPrincipalFromRequest(
      new Request("https://app.askloyal.com/api/chat")
    );

    expect(principal).toBeNull();
  });

  test("rejects authenticated non-wallet sessions at the gateway boundary", () => {
    expect(() =>
      mapAuthSessionUserToAuthenticatedPrincipal({
        authMethod: "email",
        subjectAddress: "user-1",
        displayAddress: "user-1",
        email: "user@example.com",
      })
    ).toThrow("Wallet authentication is required to use chat.");
  });

  test("rejects wallet sessions when no wallet identifier is available", () => {
    expect(() =>
      mapAuthSessionUserToAuthenticatedPrincipal({
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        provider: "solana",
      })
    ).toThrow("Wallet sessions must include a verified wallet address.");
  });

  test("rejects wallet sessions when subject and wallet differ", () => {
    try {
      mapAuthSessionUserToAuthenticatedPrincipal({
        authMethod: "wallet",
        subjectAddress: "subject-1",
        displayAddress: "wallet-1",
        provider: "solana",
        walletAddress: "wallet-1",
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      });
      throw new Error("Expected wallet principal mismatch to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthGatewayError);
      expect((error as InstanceType<typeof AuthGatewayError>).code).toBe(
        "invalid_wallet_principal"
      );
      expect((error as Error).message).toBe(
        "Wallet sessions must use the same subject and wallet address for chat."
      );
    }
  });

  test("rejects wallet sessions without smart account metadata", () => {
    expect(() =>
      mapAuthSessionUserToAuthenticatedPrincipal({
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        provider: "solana",
        walletAddress: "wallet-1",
      })
    ).toThrow(
      "Wallet sessions must include a provisioned smart account and settings PDA."
    );
  });

  test("verifies compatible local auth cookies without an upstream auth request", async () => {
    const token = await issueAuthSessionToken(
      {
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        provider: "solana",
        walletAddress: "wallet-1",
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      },
      process.env.AUTH_JWT_SECRET!,
      3600
    );

    const principal = await resolveAuthenticatedPrincipalFromRequest(
      new Request("https://app.askloyal.com/api/chat", {
        headers: {
          cookie: `loyal_wallet_session=${token}`,
        },
      })
    );

    expect(principal).toEqual({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      walletAddress: "wallet-1",
      smartAccountAddress: "smart-account-1",
      settingsPda: "settings-1",
    });
  });
});
