import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  createYieldDepositRepositoryMock,
  findYieldPositionHistoryEvents,
} from "@/test/yield-route-mocks";

mock.module("server-only", () => ({}));

const canonicalTargetReserve = "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy";

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  displayAddress: "wallet-1",
  provider: "solana" as const,
  settingsPda: "settings-1",
  smartAccountAddress: "smart-account-1",
  subjectAddress: "wallet-1",
  walletAddress: "wallet-1",
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module(
  "@/lib/yield-optimization/yield-deposit-repository.server",
  createYieldDepositRepositoryMock
);

let GET: typeof import("../route").GET;

describe("smart-account earn transactions route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "devnet";
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    findYieldPositionHistoryEvents.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(async () => ({
      authMethod: "wallet" as const,
      displayAddress: "wallet-1",
      provider: "solana" as const,
      settingsPda: "settings-1",
      smartAccountAddress: "smart-account-1",
      subjectAddress: "wallet-1",
      walletAddress: "wallet-1",
    }));
    findYieldPositionHistoryEvents.mockImplementation(async () => [
      {
        amountRaw: BigInt(2_500_000),
        confirmedAt: new Date("2026-06-02T09:30:00.000Z"),
        confirmedSlot: BigInt(222),
        id: BigInt(2),
        signature: "withdraw-sig-2",
        type: "withdrawal" as const,
      },
      {
        amountRaw: BigInt(1),
        confirmedAt: new Date("2026-06-02T09:29:00.000Z"),
        confirmedSlot: BigInt(221),
        id: BigInt(3),
        signature: "dust-deposit-sig-3",
        type: "deposit" as const,
      },
      {
        amountRaw: BigInt(1_250_000),
        confirmedAt: new Date("2026-06-01T18:05:00.000Z"),
        confirmedSlot: BigInt(111),
        id: BigInt(1),
        signature: "deposit-sig-1",
        type: "deposit" as const,
      },
    ]);
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/earn-transactions"
      )
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: "No active auth session.",
      },
    });
    expect(findYieldPositionHistoryEvents).not.toHaveBeenCalled();
  });

  test("queries confirmed earn history for the authenticated wallet target", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/earn-transactions"
      )
    );

    expect(response.status).toBe(200);
    expect(findYieldPositionHistoryEvents).toHaveBeenCalledWith({
      cluster: "devnet",
      initialReserve: canonicalTargetReserve,
      settings: "settings-1",
      vaultIndex: 1,
      walletAddress: "wallet-1",
    });
  });

  test("returns serialized transactions in repository order", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/earn-transactions"
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.transactions.map((transaction: { id: string }) => transaction.id)
    ).toEqual(["withdraw-sig-2", "dust-deposit-sig-3", "deposit-sig-1"]);
    expect(body.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: "+2.5 USDC",
          kind: "withdraw",
        }),
        expect.objectContaining({
          amount: "-<0.01 USDC",
          kind: "deposit",
        }),
      ])
    );
  });

  test("returns an empty transaction list", async () => {
    findYieldPositionHistoryEvents.mockImplementationOnce(async () => []);

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/earn-transactions"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ transactions: [] });
  });
});
