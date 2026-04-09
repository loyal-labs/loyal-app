import { describe, expect, test } from "bun:test";

import {
  AuthApiClientError,
  createAuthApiClient,
  createSharedAuthApiClient,
  createWalletAuthApiClient,
} from "@/lib/auth/client";

function createRawClient(overrides: Record<string, unknown> = {}) {
  return {
    startEmailAuth: async () => ({ ok: true, status: 200, body: {} }),
    verifyEmailAuth: async () => ({ ok: true, status: 200, body: {} }),
    getAuthSession: async () => ({ ok: true, status: 200, body: {} }),
    logoutAuthSession: async () => ({ ok: true, status: 204, body: null }),
    startPasskeyRegistration: async () => ({ ok: true, status: 200, body: {} }),
    startPasskeySignIn: async () => ({ ok: true, status: 200, body: {} }),
    challengeWalletAuth: async () => ({ ok: true, status: 200, body: {} }),
    completeWalletAuth: async () => ({ ok: true, status: 200, body: {} }),
    getPasskeyAccount: async () => ({ ok: true, status: 200, body: {} }),
    ...overrides,
  };
}

describe("auth api client", () => {
  test("validates the start-email response shape", async () => {
    const client = createSharedAuthApiClient(
      createRawClient({
        startEmailAuth: async () => ({
          ok: true,
          status: 200,
          body: {
            authTicketId: "3fdb64ce-29ff-4ef8-b5e0-a9df0a3352b4",
            expiresAt: "2099-03-11T12:00:00.000Z",
            maskedEmail: "u***@example.com",
          },
        }),
      }) as never
    );

    await expect(
      client.startEmailAuth({ email: "user@example.com" })
    ).resolves.toMatchObject({
      maskedEmail: "u***@example.com",
    });
  });

  test("normalizes unauthenticated session lookups to null", async () => {
    const client = createSharedAuthApiClient(
      createRawClient({
        getAuthSession: async () => ({
          ok: false,
          status: 401,
          body: {
            error: {
              code: "unauthenticated",
              message: "No active auth session.",
            },
          },
        }),
      }) as never
    );

    await expect(client.getSession()).resolves.toBeNull();
  });

  test("raises typed errors for invalid verify responses", async () => {
    const client = createSharedAuthApiClient(
      createRawClient({
        verifyEmailAuth: async () => ({
          ok: true,
          status: 200,
          body: { nope: true },
        }),
      }) as never
    );

    await expect(
      client.verifyEmailAuth({
        authTicketId: "3fdb64ce-29ff-4ef8-b5e0-a9df0a3352b4",
        otpCode: "123456",
      })
    ).rejects.toBeInstanceOf(AuthApiClientError);
  });

  test("returns embedded passkey continue urls", async () => {
    const client = createSharedAuthApiClient(
      createRawClient({
        startPasskeySignIn: async () => ({
          ok: true,
          status: 200,
          body: {
            url: "https://auth.askloyal.com/continue?challenge=abc",
          },
        }),
      }) as never
    );

    expect(
      await client.startPasskeySignIn({
        metaInfo: {
          appName: "askloyal",
        },
      })
    ).toBe("https://auth.askloyal.com/continue?challenge=abc&embed=1&autostart=1");
  });

  test("validates wallet challenge responses", async () => {
    const client = createWalletAuthApiClient(
      createRawClient({
        challengeWalletAuth: async () => ({
          ok: true,
          status: 200,
          body: {
            challengeToken: "challenge-token",
            message: "Sign in to askloyal",
            expiresAt: "2099-03-11T12:00:00.000Z",
          },
        }),
      }) as never
    );

    await expect(
      client.challengeWalletAuth({
        walletAddress: "wallet-1",
      })
    ).resolves.toMatchObject({
      challengeToken: "challenge-token",
    });
  });

  test("returns wallet principals after completion", async () => {
    const client = createWalletAuthApiClient(
      createRawClient({
        completeWalletAuth: async () => ({
          ok: true,
          status: 200,
          body: {
            user: {
              authMethod: "wallet",
              subjectAddress: "wallet-1",
              displayAddress: "wallet-1",
              walletAddress: "wallet-1",
              provider: "solana",
            },
          },
        }),
      }) as never
    );

    await expect(
      client.completeWalletAuth({
        challengeToken: "challenge-token",
        signature: "signature",
      })
    ).resolves.toEqual({
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      displayAddress: "wallet-1",
      walletAddress: "wallet-1",
      provider: "solana",
    });
  });

  test("combines explicit shared and wallet auth authorities", async () => {
    const sharedClient = createSharedAuthApiClient(
      createRawClient({
        getAuthSession: async () => ({
          ok: true,
          status: 200,
          body: {
            user: {
              authMethod: "email",
              subjectAddress: "user-1",
              displayAddress: "user-1",
              email: "user@example.com",
            },
          },
        }),
      }) as never
    );
    const walletClient = createWalletAuthApiClient(
      createRawClient({
        challengeWalletAuth: async () => ({
          ok: true,
          status: 200,
          body: {
            challengeToken: "wallet-token",
            message: "wallet",
            expiresAt: "2099-03-11T12:00:00.000Z",
          },
        }),
        completeWalletAuth: async () => ({
          ok: true,
          status: 200,
          body: {
            user: {
              authMethod: "wallet",
              subjectAddress: "wallet-1",
              displayAddress: "wallet-1",
              walletAddress: "wallet-1",
              provider: "solana",
            },
          },
        }),
      }) as never
    );

    const client = createAuthApiClient({
      sharedClient,
      walletClient,
    });

    await expect(
      client.challengeWalletAuth({
        walletAddress: "wallet-1",
      })
    ).resolves.toMatchObject({
      challengeToken: "wallet-token",
    });

    await expect(
      client.completeWalletAuth({
        challengeToken: "challenge-token",
        signature: "signature",
      })
    ).resolves.toMatchObject({
      walletAddress: "wallet-1",
    });

    await expect(client.getSession()).resolves.toMatchObject({
      authMethod: "email",
      email: "user@example.com",
    });
  });
});
