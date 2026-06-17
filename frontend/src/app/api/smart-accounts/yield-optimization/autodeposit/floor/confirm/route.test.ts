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
function createScheduledFloorUpdateResult() {
  return {
    rebaselineSweep: {
      status: "scheduled" as const,
      sweep: {
        classification: "floor_rebaseline",
        confidence: "confirmed_projection",
        eligibleAfter: new Date("2026-06-16T01:00:00.000Z"),
        id: BigInt(51),
        originalAmountRaw: BigInt(600_000_000),
        reason: "Autodeposit floor update rebaseline",
        remainingAmountRaw: BigInt(600_000_000),
        status: "open",
      },
    },
    target: {
      active: true,
      balanceSweepPolicyId: BigInt(7),
      id: BigInt(11),
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      walletBalanceFloorRaw: BigInt(400_000_000),
    },
  };
}
const defaultUpdateAutodepositWalletBalanceFloor = mock(async () =>
  createScheduledFloorUpdateResult() as
    | ReturnType<typeof createScheduledFloorUpdateResult>
    | ReturnType<typeof createSkippedFloorUpdateResult>
);
mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    updateAutodepositWalletBalanceFloor:
      defaultUpdateAutodepositWalletBalanceFloor,
  })
);

const repositoryMock = await import(
  "@/lib/yield-optimization/earn-autodeposit-repository.server"
);
const updateAutodepositWalletBalanceFloor =
  repositoryMock.updateAutodepositWalletBalanceFloor as unknown as typeof defaultUpdateAutodepositWalletBalanceFloor;

function createSkippedFloorUpdateResult() {
  return {
    rebaselineSweep: {
      reason: "wallet_balance_projection_missing" as const,
      status: "skipped" as const,
    },
    target: {
      active: true,
      balanceSweepPolicyId: BigInt(7),
      id: BigInt(11),
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      walletBalanceFloorRaw: BigInt(400_000_000),
    },
  };
}

function createRequest(body: Record<string, unknown>) {
  return new Request("https://loyal.local/autodeposit/floor/confirm", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

const { POST } = await import("./route");

describe("Earn autodeposit floor confirm route", () => {
  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    updateAutodepositWalletBalanceFloor.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(
      async () => principal
    );
    updateAutodepositWalletBalanceFloor.mockImplementation(async () =>
      createScheduledFloorUpdateResult()
    );
  });

  test("returns scheduled rebaseline sweep after floor update", async () => {
    const response = await POST(
      createRequest({
        policyAccount: "policy",
        recurringDelegation: "recurring",
        vaultIndex: 1,
        walletBalanceFloorRaw: "400000000",
      })
    );

    expect(response.status).toBe(200);
    expect(updateAutodepositWalletBalanceFloor).toHaveBeenCalledWith({
      policyAccount: "policy",
      recurringDelegation: "recurring",
      settings: "settings",
      vaultIndex: 1,
      walletAddress: "wallet",
      walletBalanceFloorRaw: BigInt(400_000_000),
    });
    await expect(response.json()).resolves.toEqual({
      rebaselineSweep: {
        status: "scheduled",
        sweep: {
          classification: "floor_rebaseline",
          confidence: "confirmed_projection",
          eligibleAfter: "2026-06-16T01:00:00.000Z",
          id: "51",
          originalAmountRaw: "600000000",
          reason: "Autodeposit floor update rebaseline",
          remainingAmountRaw: "600000000",
          status: "open",
        },
      },
      target: {
        active: true,
        balanceSweepPolicyId: "7",
        id: "11",
        lifecycleStatus: "active",
        policyAccount: "policy",
        recurringDelegation: "recurring",
        walletBalanceFloorRaw: "400000000",
      },
    });
  });

  test("returns skipped rebaseline reason when no projection exists", async () => {
    updateAutodepositWalletBalanceFloor.mockImplementation(async () =>
      createSkippedFloorUpdateResult()
    );

    const response = await POST(
      createRequest({
        policyAccount: "policy",
        recurringDelegation: "recurring",
        vaultIndex: 1,
        walletBalanceFloorRaw: "400000000",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rebaselineSweep: {
        reason: "wallet_balance_projection_missing",
        status: "skipped",
      },
    });
  });

  test("rejects unauthenticated floor updates", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(
      async () => null
    );

    const response = await POST(
      createRequest({
        policyAccount: "policy",
        recurringDelegation: "recurring",
        vaultIndex: 1,
        walletBalanceFloorRaw: "400000000",
      })
    );

    expect(response.status).toBe(401);
    expect(updateAutodepositWalletBalanceFloor).not.toHaveBeenCalled();
  });
});
