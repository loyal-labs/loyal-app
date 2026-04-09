import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const mockedServerEnv = {
  authJwtSecret: null as string | null,
  authSessionRs256PublicKey: null as string | null,
  gridAuthBaseUrl: "https://auth.askloyal.com",
};

mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => mockedServerEnv,
}));

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

  test("verifies compatible local auth cookies without an upstream auth request", async () => {
    mockedServerEnv.authJwtSecret = "local-auth-secret";
    const token = await issueAuthSessionToken(
      {
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        provider: "solana",
        walletAddress: "wallet-1",
      },
      mockedServerEnv.authJwtSecret,
      3600
    );
    const fetchFn = mock(async () => {
      throw new Error("Expected local auth cookie verification to short-circuit");
    });

    const principal = await resolveAuthenticatedPrincipalFromRequest(
      new Request("https://app.askloyal.com/api/chat", {
        headers: {
          cookie: `loyal_email_session=${token}`,
        },
      }),
      {
        fetchFn,
      }
    );

    expect(principal).toEqual({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      walletAddress: "wallet-1",
      gridUserId: null,
    });
    expect(fetchFn).not.toHaveBeenCalled();
    mockedServerEnv.authJwtSecret = null;
  });
});
