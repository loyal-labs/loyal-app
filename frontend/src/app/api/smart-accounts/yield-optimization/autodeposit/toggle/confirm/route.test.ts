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
  "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared",
  () => ({
    parseEarnAutodepositToggleConfirmRequestBody: (
      body: Record<string, unknown>
    ) => ({
      active: Boolean(body.active),
      policyAccount: String(body.policyAccount),
      recurringDelegation: String(body.recurringDelegation),
      vaultIndex: 1,
    }),
  })
);

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
    expect(updateAutodepositTargetActive).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      target: {
        active: false,
        id: "11",
        lifecycleStatus: "active",
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
