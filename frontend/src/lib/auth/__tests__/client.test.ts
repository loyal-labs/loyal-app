import { afterEach, describe, expect, mock, test } from "bun:test";

import { AuthApiClientError, createAuthApiClient } from "@/lib/auth/client";

const originalFetch = globalThis.fetch;

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });
}

describe("auth api client", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("validates wallet challenge responses", async () => {
    globalThis.fetch = mock(async () =>
      createJsonResponse({
        challengeToken: "challenge-token",
        message: "Sign in to Loyal",
        expiresAt: "2099-03-11T12:00:00.000Z",
      })
    ) as typeof fetch;

    const client = createAuthApiClient();

    await expect(
      client.challengeWalletAuth({
        walletAddress: "wallet-1",
      })
    ).resolves.toMatchObject({
      challengeToken: "challenge-token",
    });
  });

  test("returns wallet principals after completion", async () => {
    globalThis.fetch = mock(async () =>
      createJsonResponse({
        user: {
          authMethod: "wallet",
          subjectAddress: "wallet-1",
          displayAddress: "wallet-1",
          walletAddress: "wallet-1",
          provider: "solana",
          smartAccountAddress: "smart-account-1",
          settingsPda: "settings-1",
        },
      })
    ) as typeof fetch;

    const client = createAuthApiClient();

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
      smartAccountAddress: "smart-account-1",
      settingsPda: "settings-1",
    });
  });

  test("normalizes unauthenticated session lookups to null", async () => {
    globalThis.fetch = mock(async () =>
      createJsonResponse(
        {
          error: {
            code: "unauthenticated",
            message: "No active auth session.",
          },
        },
        { status: 401 }
      )
    ) as typeof fetch;

    const client = createAuthApiClient();

    await expect(client.getSession()).resolves.toBeNull();
  });

  test("returns wallet session envelopes from the local session route", async () => {
    globalThis.fetch = mock(async () =>
      createJsonResponse({
        user: {
          authMethod: "wallet",
          subjectAddress: "wallet-1",
          displayAddress: "wallet-1",
          walletAddress: "wallet-1",
          provider: "solana",
          smartAccountAddress: "smart-account-1",
          settingsPda: "settings-1",
        },
        session: {
          expiresAt: "2099-03-18T12:00:00.000Z",
          refreshAfter: "2099-03-12T12:00:00.000Z",
        },
      })
    ) as typeof fetch;

    const client = createAuthApiClient();

    await expect(client.getSession()).resolves.toEqual({
      user: {
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        walletAddress: "wallet-1",
        provider: "solana",
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      },
      session: {
        expiresAt: "2099-03-18T12:00:00.000Z",
        refreshAfter: "2099-03-12T12:00:00.000Z",
      },
    });
  });

  test("normalizes unauthenticated refresh attempts to null", async () => {
    globalThis.fetch = mock(async () =>
      createJsonResponse(
        {
          error: {
            code: "unauthenticated",
            message: "No active auth session.",
          },
        },
        { status: 401 }
      )
    ) as typeof fetch;

    const client = createAuthApiClient();

    await expect(client.refreshSession()).resolves.toBeNull();
  });

  test("raises typed errors for invalid wallet completion responses", async () => {
    globalThis.fetch = mock(async () =>
      createJsonResponse({
        nope: true,
      })
    ) as typeof fetch;

    const client = createAuthApiClient();

    await expect(
      client.completeWalletAuth({
        challengeToken: "challenge-token",
        signature: "signature",
      })
    ).rejects.toBeInstanceOf(AuthApiClientError);
  });

  test("uses the local logout route", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createAuthApiClient();
    await client.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });
});
