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
const findCurrentEarnAutodepositState = mock(
  async (): Promise<ReturnType<typeof createState> | null> => createState()
);
const requestImmediateEarnAutodepositScheduledSweep = mock(
  async (): Promise<{
    acceleratedAmountRaw: bigint;
    acceleratedLotCount: number;
    eligibleAfter: Date;
    targetId: bigint;
  } | null> => ({
    acceleratedAmountRaw: BigInt(334_480_000),
    acceleratedLotCount: 2,
    eligibleAfter: new Date("2026-06-15T18:06:00.000Z"),
    targetId: BigInt(11),
  })
);

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    findCurrentEarnAutodepositState,
    requestImmediateEarnAutodepositScheduledSweep,
  })
);

function createState(overrides: Record<string, unknown> = {}) {
  return {
    policy: {
      id: BigInt(7),
      policyAccount: "policy",
    },
    status: "active",
    target: {
      active: true,
      balanceSweepPolicyId: BigInt(7),
      id: BigInt(11),
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      walletBalanceFloorRaw: BigInt(500_000_000),
    },
    ...overrides,
  };
}

function createRequest() {
  return new Request("https://loyal.local/sweeps/execute", {
    method: "POST",
  });
}

const { POST } = await import("./route");

describe("Earn autodeposit sweeps execute route", () => {
  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    findCurrentEarnAutodepositState.mockClear();
    requestImmediateEarnAutodepositScheduledSweep.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(
      async () => principal
    );
    findCurrentEarnAutodepositState.mockImplementation(async () =>
      createState()
    );
    requestImmediateEarnAutodepositScheduledSweep.mockImplementation(
      async () => ({
        acceleratedAmountRaw: BigInt(334_480_000),
        acceleratedLotCount: 2,
        eligibleAfter: new Date("2026-06-15T18:06:00.000Z"),
        targetId: BigInt(11),
      })
    );
  });

  test("rejects unauthenticated execute requests", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(
      async () => null
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(findCurrentEarnAutodepositState).not.toHaveBeenCalled();
    expect(
      requestImmediateEarnAutodepositScheduledSweep
    ).not.toHaveBeenCalled();
  });

  test("returns not found when no autodeposit target is loaded", async () => {
    findCurrentEarnAutodepositState.mockImplementation(async () => null);

    const response = await POST(createRequest());

    expect(response.status).toBe(404);
    expect(findCurrentEarnAutodepositState).toHaveBeenCalledWith({
      settings: "settings",
      vaultIndex: 1,
      walletAddress: "wallet",
    });
    expect(
      requestImmediateEarnAutodepositScheduledSweep
    ).not.toHaveBeenCalled();
  });

  test("rejects inactive autodeposit targets", async () => {
    findCurrentEarnAutodepositState.mockImplementation(async () =>
      createState({ status: "paused" })
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("autodeposit_not_active");
    expect(
      requestImmediateEarnAutodepositScheduledSweep
    ).not.toHaveBeenCalled();
  });

  test("returns conflict when no scheduled sweeps are open", async () => {
    requestImmediateEarnAutodepositScheduledSweep.mockImplementation(
      async () => null
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("no_scheduled_sweeps");
  });

  test("accelerates open scheduled lots without executing transactions", async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(requestImmediateEarnAutodepositScheduledSweep).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      status: "requested",
      sweepRequest: {
        acceleratedAmountRaw: "334480000",
        acceleratedLotCount: 2,
        targetId: "11",
      },
      target: {
        active: true,
        id: "11",
        lifecycleStatus: "active",
      },
    });
  });
});
