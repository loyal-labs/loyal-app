import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    authSessionRs256PublicKey: null,
    gridAuthBaseUrl: "https://auth.askloyal.com",
  }),
}));

let AuthGatewayError: typeof import("../auth-session").AuthGatewayError;
let mapAuthSessionUserToAuthenticatedPrincipal: typeof import("../auth-session").mapAuthSessionUserToAuthenticatedPrincipal;
let resolveAuthenticatedPrincipalFromRequest: typeof import("../auth-session").resolveAuthenticatedPrincipalFromRequest;

describe("auth session gateway", () => {
  beforeAll(async () => {
    ({
      AuthGatewayError,
      mapAuthSessionUserToAuthenticatedPrincipal,
      resolveAuthenticatedPrincipalFromRequest,
    } = await import("../auth-session"));
  });

  test("maps wallet sessions to a stable authenticated principal", () => {
    expect(
      mapAuthSessionUserToAuthenticatedPrincipal({
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        provider: "solana",
        walletAddress: "wallet-1",
        gridUserId: "grid-1",
      })
    ).toEqual({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      walletAddress: "wallet-1",
      gridUserId: "grid-1",
    });
  });

  test("returns null when the request has no auth cookie", async () => {
    const principal = await resolveAuthenticatedPrincipalFromRequest(
      new Request("https://app.askloyal.com/api/chat")
    );

    expect(principal).toBeNull();
  });

  test("throws when the auth service returns malformed claims", async () => {
    await expect(
      resolveAuthenticatedPrincipalFromRequest(
        new Request("https://app.askloyal.com/api/chat", {
          headers: { cookie: "session=1" },
        }),
        {
          authBaseUrl: "https://auth.askloyal.com",
          fetchFn: async () =>
            new Response(JSON.stringify({ user: { authMethod: "wallet" } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        }
      )
    ).rejects.toThrow("Auth session response was invalid");
  });

  test("rejects authenticated non-wallet sessions at the gateway boundary", () => {
    expect(() =>
      mapAuthSessionUserToAuthenticatedPrincipal({
        authMethod: "email",
        subjectAddress: "grid-1",
        displayAddress: "grid-1",
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
});
