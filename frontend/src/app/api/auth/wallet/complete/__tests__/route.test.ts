import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

class MockWalletAuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { code: string; status: number; details?: unknown }
  ) {
    super(message);
    this.name = "WalletAuthError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}

const completeWalletAuth = mock(async () => ({
  user: {
    authMethod: "wallet" as const,
    subjectAddress: "wallet-1",
    displayAddress: "wallet-1",
    walletAddress: "wallet-1",
    provider: "solana",
    smartAccountAddress: "smart-account-1",
    settingsPda: "settings-1",
  },
  sessionToken: "session-token",
}));
const createSessionCookieOptions = mock(() => ({
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: true,
  path: "/" as const,
  maxAge: 7200,
}));
const isSmartAccountProvisioningError = mock(() => false);

mock.module("@/features/identity/server/wallet-auth-service", () => ({
  completeWalletAuth,
}));
mock.module("@/features/identity/server/wallet-auth-errors", () => ({
  WalletAuthError: MockWalletAuthError,
}));
mock.module("@/features/identity/server/session-cookie", () => ({
  WALLET_AUTH_SESSION_COOKIE_NAME: "loyal_wallet_session",
  createAuthSessionCookieService: () => ({
    createSessionCookieOptions,
  }),
}));
mock.module("@/features/smart-accounts/server/service", () => ({
  isSmartAccountProvisioningError,
}));

let POST: typeof import("../route").POST;

describe("wallet completion route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  beforeEach(() => {
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    completeWalletAuth.mockClear();
    createSessionCookieOptions.mockClear();
    isSmartAccountProvisioningError.mockClear();
  });

  test("returns the authenticated wallet user and sets the auth session cookie", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/wallet/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.askloyal.com",
        },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          signature: "signature",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(completeWalletAuth).toHaveBeenCalledWith(
      {
        challengeToken: "challenge-token",
        signature: "signature",
      },
      {
        requestOrigin: "https://app.askloyal.com",
      }
    );
    expect(createSessionCookieOptions).toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "loyal_wallet_session=session-token"
    );
    await expect(response.json()).resolves.toEqual({
      user: {
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        walletAddress: "wallet-1",
        provider: "solana",
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      },
    });
  });

  test("maps wallet auth failures to structured API errors", async () => {
    completeWalletAuth.mockImplementationOnce(async () => {
      throw new MockWalletAuthError("Wallet signature could not be verified.", {
        code: "invalid_wallet_signature",
        status: 401,
      });
    });

    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/wallet/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          signature: "signature",
        }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_wallet_signature",
        message: "Wallet signature could not be verified.",
      },
    });
  });
});
