import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";

mock.module("server-only", () => ({}));

const principal: AuthenticatedPrincipal = {
  authMethod: "wallet",
  settingsPda: "settings",
  smartAccountAddress: "smart-account",
  subjectAddress: "wallet",
  provider: "solana",
  walletAddress: "wallet",
};
const resolveAuthenticatedPrincipalFromRequest = mock(
  async (): Promise<AuthenticatedPrincipal | null> => principal
);
const updateAutodepositTargetActive = mock(async () => ({
  active: false,
  balanceSweepPolicyId: BigInt(7),
  id: BigInt(11),
  lifecycleStatus: "active",
  policyAccount: "policy",
  recurringDelegation: "recurring",
  walletBalanceFloorRaw: BigInt(500_000_000),
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    updateAutodepositTargetActive,
  })
);

function createRequest(body: Record<string, unknown>) {
  return new Request("https://loyal.local/toggle", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

const { POST } = await import("./route");

describe("Earn autodeposit toggle confirm route", () => {
  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    updateAutodepositTargetActive.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(
      async () => principal
    );
    updateAutodepositTargetActive.mockImplementation(async () => ({
      active: false,
      balanceSweepPolicyId: BigInt(7),
      id: BigInt(11),
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      walletBalanceFloorRaw: BigInt(500_000_000),
    }));
  });

  test("updates target active state without signature metadata", async () => {
    const response = await POST(
      createRequest({
        active: false,
        policyAccount: "policy",
        recurringDelegation: "recurring",
        vaultIndex: 1,
      })
    );

    expect(response.status).toBe(200);
    expect(updateAutodepositTargetActive).toHaveBeenCalledWith({
      active: false,
      policyAccount: "policy",
      recurringDelegation: "recurring",
      settings: "settings",
      vaultIndex: 1,
      walletAddress: "wallet",
    });
    await expect(response.json()).resolves.toEqual({
      target: {
        active: false,
        balanceSweepPolicyId: "7",
        id: "11",
        lifecycleStatus: "active",
        policyAccount: "policy",
        recurringDelegation: "recurring",
        walletBalanceFloorRaw: "500000000",
      },
    });
  });

  test("rejects unauthenticated toggle requests", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(
      async () => null
    );

    const response = await POST(
      createRequest({
        active: true,
        policyAccount: "policy",
        recurringDelegation: "recurring",
        vaultIndex: 1,
      })
    );

    expect(response.status).toBe(401);
    expect(updateAutodepositTargetActive).not.toHaveBeenCalled();
  });
});
