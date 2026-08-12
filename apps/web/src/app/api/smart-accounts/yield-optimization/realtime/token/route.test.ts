import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";

mock.module("server-only", () => ({}));

const principal: AuthenticatedPrincipal = {
  authMethod: "wallet",
  provider: "solana",
  settingsPda: "settings",
  smartAccountAddress: "smart-account",
  subjectAddress: "wallet",
  walletAddress: "wallet",
};

const resolveAuthenticatedPrincipalFromRequest = mock(
  async (): Promise<AuthenticatedPrincipal | null> => principal
);
const issueEarnRealtimeToken = mock(() => ({
  accessToken: "signed-token",
  expiresAt: "2026-07-14T00:04:00.000Z",
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));
mock.module("@/features/earn-realtime/server/token.server", () => ({
  issueEarnRealtimeToken,
}));
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    earnRealtime: {
      authSecret: "test-realtime-secret-that-is-at-least-32-bytes",
      eventsUrl: "http://127.0.0.1:10000/events",
    },
    loyalSmartAccounts: { programId: "program" },
    solanaEnv: "devnet",
  }),
}));

function createRequest(body?: unknown) {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return new Request("http://localhost:3000/realtime/token", init);
}

const { POST } = await import("./route");

describe("Earn realtime token route", () => {
  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(
      async () => principal
    );
    issueEarnRealtimeToken.mockClear();
  });

  test("rejects unauthenticated requests before minting a token", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(
      async () => null
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(issueEarnRealtimeToken).not.toHaveBeenCalled();
  });

  test("rejects client-controlled identity claims before minting", async () => {
    const response = await POST(
      createRequest({ walletAddress: "attacker-controlled-wallet" })
    );

    expect(response.status).toBe(400);
    expect(issueEarnRealtimeToken).not.toHaveBeenCalled();
  });

  test("mints from the authenticated principal and returns the local URL", async () => {
    const response = await POST(createRequest({}));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(issueEarnRealtimeToken).toHaveBeenCalledWith({
      authSecret: "test-realtime-secret-that-is-at-least-32-bytes",
      principal,
      programId: "program",
      solanaEnv: "devnet",
    });
    await expect(response.json()).resolves.toMatchObject({
      accessToken: "signed-token",
      eventsUrl: "http://127.0.0.1:10000/events",
      schemaVersion: 1,
    });
  });
});
