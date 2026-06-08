import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const createWalletAuthChallenge = mock(async () => ({
  challengeToken: "challenge-token",
  message: "Sign in to askloyal",
  expiresAt: "2099-03-11T12:00:00.000Z",
}));

mock.module("@/features/identity/server/wallet-auth-service", () => ({
  createWalletAuthChallenge,
}));

const verifyTurnstileToken = mock(
  async (): Promise<{ ok: true } | { ok: false; reason: string }> => ({
    ok: true,
  })
);

mock.module("@/features/identity/server/turnstile-verification", () => ({
  verifyTurnstileToken,
}));

mock.module("@/features/identity/server/wallet-auth-errors", () => ({
  WalletAuthError: class WalletAuthError extends Error {
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
  },
}));

let POST: typeof import("../route").POST;

describe("wallet challenge route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  beforeEach(() => {
    createWalletAuthChallenge.mockClear();
    verifyTurnstileToken.mockClear();
    verifyTurnstileToken.mockImplementation(async () => ({ ok: true }));
  });

  test("returns a local wallet auth challenge", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/wallet/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.askloyal.com",
        },
        body: JSON.stringify({
          walletAddress: "wallet-1",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(createWalletAuthChallenge).toHaveBeenCalledWith(
      {
        walletAddress: "wallet-1",
      },
      {
        requestOrigin: "https://app.askloyal.com",
      }
    );
    await expect(response.json()).resolves.toMatchObject({
      challengeToken: "challenge-token",
      message: "Sign in to askloyal",
    });
  });

  test("rejects with 403 when turnstile verification fails", async () => {
    verifyTurnstileToken.mockImplementationOnce(async () => ({
      ok: false,
      reason: "turnstile_verification_failed",
    }));

    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/wallet/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.askloyal.com",
        },
        body: JSON.stringify({
          walletAddress: "wallet-1",
          turnstileToken: "bad-token",
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(createWalletAuthChallenge).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "turnstile_verification_failed" },
    });
  });

  test("strips the turnstile token before creating the challenge", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/wallet/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.askloyal.com",
        },
        body: JSON.stringify({
          walletAddress: "wallet-1",
          turnstileToken: "good-token",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(verifyTurnstileToken).toHaveBeenCalledTimes(1);
    expect(createWalletAuthChallenge).toHaveBeenCalledWith(
      { walletAddress: "wallet-1" },
      { requestOrigin: "https://app.askloyal.com" }
    );
  });

  test("maps invalid request bodies to a 400 response", async () => {
    createWalletAuthChallenge.mockImplementationOnce(async () => {
      const error = new Error("Invalid request");
      error.name = "ZodError";
      throw error;
    });

    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/wallet/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_wallet_challenge_request",
        message: "Wallet challenge request is invalid.",
      },
    });
  });
});
