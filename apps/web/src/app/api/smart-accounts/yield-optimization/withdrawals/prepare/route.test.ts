import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

mock.module("server-only", () => ({}));

const principal = {
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  walletAddress: "11111111111111111111111111111114",
};
const activePolicy = {
  policyAccount: "11111111111111111111111111111117",
  policySeed: BigInt(7),
};
const activeSetupPolicy = {
  policyAccount: "11111111111111111111111111111118",
  policySeed: BigInt(8),
};
const activePosition = {
  currentLiquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  currentMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  currentReserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
  principalAmountRaw: BigInt(1_000_026),
};
const secondMarket = "11111111111111111111111111111119";
const secondReserve = "6UeJYTLU1adaoHWeApWsoj1xNEDbWA2RhMbrZgYFutJk";
const idleTokenAccount = "11111111111111111111111111111116";

function kaminoHolding(args: {
  amountRaw: string;
  market: string;
  reserve: string;
}) {
  return {
    amountRaw: args.amountRaw,
    kind: "kamino" as const,
    label: "Kamino USDC",
    liquidityMint: activePosition.currentLiquidityMint,
    market: args.market,
    marketName: "Kamino",
    observedAt: "2026-07-13T00:00:00.000Z",
    observedSlot: "1",
    provenance: {
      reserveCollateralMint: "11111111111111111111111111111115",
    },
    reserve: args.reserve,
    sourceId: `reserve:${args.reserve}`,
    supplyApyBps: "300",
    tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
  };
}

function idleHolding(amountRaw: string) {
  return {
    amountRaw,
    kind: "idle" as const,
    label: "Idle USDC",
    liquidityMint: activePosition.currentLiquidityMint,
    market: null,
    marketName: "Wallet",
    observedAt: "2026-07-13T00:00:00.000Z",
    observedSlot: "1",
    provenance: { tokenAccount: idleTokenAccount },
    reserve: null,
    sourceId: `idle:${idleTokenAccount}`,
    supplyApyBps: null,
    tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
  };
}

type SnapshotHolding =
  | ReturnType<typeof idleHolding>
  | ReturnType<typeof kaminoHolding>;

function holdingsSnapshot(holdings: SnapshotHolding[]) {
  return {
    completeness: "complete" as const,
    currentTotalAmountRaw: "0",
    currentTotalNominalUsdMicros: "0",
    holdings,
    observedAt: "2026-07-13T00:00:00.000Z",
    observedSlot: "1",
    provenance: {
      accountCount: 0,
      chunkCount: 0,
      commitment: "confirmed" as const,
      source: "rpc_getMultipleAccounts" as const,
      watchedAccounts: [],
    },
  };
}

let currentPrincipal: typeof principal | null = principal;
let currentPolicy: typeof activePolicy | null = activePolicy;
let currentSnapshot = holdingsSnapshot([
  kaminoHolding({
    amountRaw: "600000",
    market: activePosition.currentMarket,
    reserve: activePosition.currentReserve,
  }),
  kaminoHolding({
    amountRaw: "400000",
    market: secondMarket,
    reserve: secondReserve,
  }),
  idleHolding("10000"),
]);
let prepareCalls: Record<string, unknown>[] = [];
let policyLookupCount = 0;
let policyMissesRemaining = 0;

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => currentPrincipal,
}));

mock.module("@/features/smart-accounts/server/service", () => ({
  assertAuthenticatedWalletControlsSettings: async () => {},
  isSmartAccountProvisioningError: () => false,
}));

mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    loyalSmartAccounts: {
      programId: "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
    },
  }),
}));

mock.module("@/lib/core/config/solana-env-override", () => ({
  resolveLoyalWebSolanaEnvFromEnv: () => "mainnet",
}));

mock.module("@/lib/solana/rpc-endpoints.server", () => ({
  getServerSolanaEndpoints: () => ({
    rpcEndpoint: "http://127.0.0.1:8899",
    websocketEndpoint: "ws://127.0.0.1:8900",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetchImpl: typeof fetch) => fetchImpl,
}));

mock.module("@/lib/yield-optimization/deployment-policy-signer.server", () => ({
  getDeploymentPolicySignerPublicKey: () =>
    new PublicKey("11111111111111111111111111111115"),
}));

mock.module("@/lib/yield-optimization/earn-rpc-holdings.client", () => ({
  fetchEarnRpcHoldingsSnapshot: async () => currentSnapshot,
}));

mock.module(
  "@/lib/yield-optimization/earn-state-serializers.server",
  () => ({
    serializeRoutePolicyState: () => ({ vaultIndex: 1 }),
  })
);

mock.module(
  "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared",
  () => ({
    parseEarnWithdrawPrepareRequestBody: (body: {
      amountRaw: string;
      sourceId?: string;
      mode?: "partial" | "full";
      source?: Record<string, unknown> | null;
    }) => ({
      amountRaw: body.amountRaw === "max" ? "max" : BigInt(body.amountRaw),
      sourceId: body.sourceId ?? null,
      legacy:
        body.sourceId === undefined && body.mode
          ? { mode: body.mode, source: body.source ?? null }
          : null,
    }),
    serializePreparedEarnUsdcWithdraw: () => ({ ok: true }),
  })
);

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldRoutePolicyPair: async () => {
    policyLookupCount += 1;
    if (policyMissesRemaining > 0) {
      policyMissesRemaining -= 1;
      return null;
    }
    return currentPolicy
      ? {
          routePolicy: currentPolicy,
          setupPolicy: activeSetupPolicy,
        }
      : null;
  },
}));

mock.module("@loyal-labs/smart-account-vaults", () => ({
  createSmartAccountVaultsClient: () => ({
    prepareEarnUsdcWithdraw: async (input: Record<string, unknown>) => {
      prepareCalls.push(input);
      return { prepared: true, input };
    },
  }),
  // The input-resolution module imports this too; an incomplete module mock
  // fails the whole suite at import time.
  isEarnWithdrawRequiredAccountMissingError: () => false,
}));

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/withdrawals/prepare", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

describe("Earn withdrawal prepare route", () => {
  beforeEach(() => {
    currentPrincipal = principal;
    currentPolicy = activePolicy;
    currentSnapshot = holdingsSnapshot([
      kaminoHolding({
        amountRaw: "600000",
        market: activePosition.currentMarket,
        reserve: activePosition.currentReserve,
      }),
      kaminoHolding({
        amountRaw: "400000",
        market: secondMarket,
        reserve: secondReserve,
      }),
      idleHolding("10000"),
    ]);
    prepareCalls = [];
    policyLookupCount = 0;
    policyMissesRemaining = 0;
  });

  test("max drains only the exact selected source", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "max",
        sourceId: `reserve:${activePosition.currentReserve}`,
      })
    );

    expect(response.status).toBe(200);
    expect(prepareCalls[0]?.amountRaw).toBe(BigInt(600_000));
    expect(prepareCalls[0]?.source).toMatchObject({
      id: activePosition.currentReserve,
      reserve: new PublicKey(activePosition.currentReserve),
      type: "reserve",
    });
    expect(prepareCalls[0]?.fullWithdrawalTargets).toBeUndefined();
    expect(prepareCalls[0]?.mode).toBe("partial");
    expect(prepareCalls[0]?.closePoliciesOnFullWithdrawal).toBe(false);
  });

  test("does not expand a selected reserve into another reserve", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "600000",
        sourceId: `reserve:${activePosition.currentReserve}`,
      })
    );

    expect(response.status).toBe(200);
    expect(prepareCalls[0]?.amountRaw).toBe(BigInt(600_000));
    expect(prepareCalls[0]?.source).toMatchObject({
      id: activePosition.currentReserve,
    });
    expect(prepareCalls[0]?.fullWithdrawalTargets).toBeUndefined();
  });

  test("selects the requested snapshot source for a partial withdrawal", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "300000",
        sourceId: `reserve:${secondReserve}`,
      })
    );

    expect(response.status).toBe(200);
    expect(prepareCalls[0]?.amountRaw).toBe(BigInt(300_000));
    expect(prepareCalls[0]?.source).toMatchObject({
      id: secondReserve,
      type: "reserve",
    });
  });

  test("rejects a partial withdrawal larger than its requested source", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "400001",
        sourceId: `reserve:${secondReserve}`,
      })
    );
    const payload = await response.json();

    // 409, not 500: the caller's balance was stale, which is not a server
    // fault. Reporting it as one paged the team every time a user typed an
    // amount their source no longer covered (ASK-1903).
    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("earn_withdraw_amount_exceeds_source");
    expect(payload.error.message).toBe(
      "Withdrawal exceeds the selected Earn source amount."
    );
    expect(prepareCalls).toHaveLength(0);
  });

  test("returns a retryable response while the route policy is still projecting", async () => {
    const { POST } = await import("./route");
    currentPolicy = null;

    const response = await POST(
      createRequest({
        amountRaw: "max",
        sourceId: `reserve:${activePosition.currentReserve}`,
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(payload.error.code).toBe("earn_policy_projection_pending");
    expect(policyLookupCount).toBe(5);
  });

  test("recovers when LaserStream projects the policy during the retry window", async () => {
    const { POST } = await import("./route");
    policyMissesRemaining = 1;

    const response = await POST(
      createRequest({
        amountRaw: "max",
        sourceId: `reserve:${activePosition.currentReserve}`,
      })
    );

    expect(response.status).toBe(200);
    expect(policyLookupCount).toBe(2);
    expect(prepareCalls).toHaveLength(1);
  });

  test("prepares from chain state without a projected active-position row", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "max",
        sourceId: `reserve:${activePosition.currentReserve}`,
      })
    );
    expect(response.status).toBe(200);
    expect(prepareCalls).toHaveLength(1);
  });

  test("returns missing_earn_withdraw_source when the snapshot holds nothing", async () => {
    const { POST } = await import("./route");
    currentSnapshot = holdingsSnapshot([]);

    const response = await POST(
      createRequest({
        amountRaw: "max",
        sourceId: `reserve:${activePosition.currentReserve}`,
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("missing_earn_withdraw_source");
    expect(prepareCalls).toHaveLength(0);
  });

  test("returns source-changed when the exact source ID is absent", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "1000",
        sourceId: "reserve:11111111111111111111111111111121",
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("earn_withdraw_source_changed");
    expect(prepareCalls).toHaveLength(0);
  });

  // Legacy `{ amountRaw, mode, source }` bodies — the shape every shipped
  // mobile binary/OTA still sends (ASK-2099).
  test("resolves a legacy partial body by raw reserve id (ASK-2099)", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "300000",
        mode: "partial",
        source: {
          id: secondReserve,
          reserve: secondReserve,
          type: "reserve",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(prepareCalls[0]?.amountRaw).toBe(BigInt(300_000));
    expect(prepareCalls[0]?.mode).toBe("partial");
    expect(prepareCalls[0]?.source).toMatchObject({
      id: secondReserve,
      type: "reserve",
    });
    expect(prepareCalls[0]?.fullWithdrawalTargets).toBeUndefined();
  });

  test("resolves a legacy partial body holding a new-format source id (ASK-2099)", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "300000",
        mode: "partial",
        source: { id: `reserve:${secondReserve}`, type: "reserve" },
      })
    );

    expect(response.status).toBe(200);
    expect(prepareCalls[0]?.source).toMatchObject({
      id: secondReserve,
      type: "reserve",
    });
  });

  test("legacy full exit aggregates every source (ASK-2099)", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "1010000",
        mode: "full",
        source: null,
      })
    );

    expect(response.status).toBe(200);
    expect(prepareCalls[0]?.mode).toBe("full");
    // 600000 + 400000 + 10000 — every source, not just the largest.
    expect(prepareCalls[0]?.amountRaw).toBe(BigInt(1_010_000));
    expect(prepareCalls[0]?.fullWithdrawalTargets).toHaveLength(2);
    expect(prepareCalls[0]?.source).toMatchObject({
      id: activePosition.currentReserve,
      type: "reserve",
    });
  });

  test("legacy idle withdrawal keeps a reserve routing target (ASK-2099)", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({
        amountRaw: "10000",
        mode: "partial",
        source: { id: idleTokenAccount, type: "idle" },
      })
    );

    expect(response.status).toBe(200);
    expect(prepareCalls[0]?.source).toMatchObject({
      id: idleTokenAccount,
      type: "idle",
    });
    expect(prepareCalls[0]?.target).toMatchObject({
      reserve: new PublicKey(activePosition.currentReserve),
    });
  });
});
