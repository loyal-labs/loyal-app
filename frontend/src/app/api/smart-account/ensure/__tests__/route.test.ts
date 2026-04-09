import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const ensureCurrentUserSmartAccount = mock(async () => ({
  state: "ready" as const,
  solanaEnv: "devnet" as const,
  programId: "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
  settingsPda: "settings-1",
  smartAccountAddress: "smart-account-1",
  creationSignature: "sig-1",
  treasury: null,
}));

mock.module("@/features/smart-accounts/server/service", () => ({
  ensureCurrentUserSmartAccount,
  isSmartAccountProvisioningError: () => false,
}));

mock.module("@/features/identity/server/auth-session", () => ({
  isAuthGatewayError: () => false,
  resolveAuthenticatedPrincipalFromRequest: async () => ({
    provider: "solana" as const,
    authMethod: "wallet" as const,
    subjectAddress: "wallet-1",
    walletAddress: "wallet-1",
    gridUserId: null,
  }),
}));

mock.module("@/features/identity/server/local-dev-principal", () => ({
  LOCAL_DEV_PRINCIPAL: null,
}));

mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    appEnvironment: "dev",
  }),
}));

let POST: typeof import("../route").POST;

describe("smart-account ensure route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  beforeEach(() => {
    ensureCurrentUserSmartAccount.mockClear();
  });

  test("forwards the reconciliation payload through the single ensure endpoint", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/smart-account/ensure", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          refreshPending: true,
          settingsPda: "settings-1",
          signature: "sig-1",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(ensureCurrentUserSmartAccount).toHaveBeenCalledWith({
      principal: {
        provider: "solana",
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        walletAddress: "wallet-1",
        gridUserId: null,
      },
      refreshPending: true,
      settingsPda: "settings-1",
      signature: "sig-1",
    });
  });

  test("rejects invalid ensure payloads", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/smart-account/ensure", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          signature: "sig-1",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(ensureCurrentUserSmartAccount).not.toHaveBeenCalled();
  });
});
