import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PublicKey, Connection } from "@solana/web3.js";

mock.module("server-only", () => ({}));

mock.module("drizzle-orm", () => {
  const sql = Object.assign((strings: TemplateStringsArray) => ({ strings }), {
    join: (values: unknown[]) => values,
  });
  return {
    and: (...conditions: unknown[]) => ({ conditions, op: "and" }),
    eq: (left: unknown, right: unknown) => ({ left, op: "eq", right }),
    inArray: (left: unknown, right: unknown) => ({
      left,
      op: "inArray",
      right,
    }),
    ne: (left: unknown, right: unknown) => ({ left, op: "ne", right }),
    sql,
  };
});

const principal = {
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  walletAddress: "11111111111111111111111111111114",
};
const autodepositPolicyAccount = "11111111111111111111111111111115";
const refundablePolicyAccount = "11111111111111111111111111111116";

let activeAutodepositRows: Array<{
  id: bigint;
  policyAccount: string;
}> = [];
let activeAutoswapRows: Array<{ policyAccount: string }> = [];
let activeManagedVaultRows: unknown[] = [];
let activePositionRows: Array<{ policyAccount: string }> = [];
let routePolicyRows: Array<{
  id: bigint;
  policyAccount: string;
}> = [];

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => principal,
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

mock.module("@/lib/solana/rpc-endpoints", () => ({
  getFrontendSolanaEndpoints: () => ({
    rpcEndpoint: "http://127.0.0.1:8899",
    websocketEndpoint: "ws://127.0.0.1:8900",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetchImpl: typeof fetch) => fetchImpl,
}));

mock.module("@loyal-labs/smart-account-vaults", () => ({
  createSmartAccountVaultsClient: () => ({
    fetchEarnVaultRefundSnapshot: async () => ({
      lamports: BigInt(0),
      tokenAccounts: [],
      vaultPda: new PublicKey(principal.smartAccountAddress),
      vaultUsdcAta: new PublicKey(principal.smartAccountAddress),
    }),
    fetchPolicyOverview: async () => ({
      policies: [
        {
          accountIndex: 1,
          address: autodepositPolicyAccount,
          seed: "7",
          state: "ProgramInteraction",
        },
        {
          accountIndex: 1,
          address: refundablePolicyAccount,
          seed: "8",
          state: "ProgramInteraction",
        },
      ],
    }),
  }),
}));

mock.module("@/lib/yield-optimization/yield-neon-client.server", () => {
  const query = (rows: unknown[]) => ({
    findFirst: async () => rows[0],
    findMany: async () => rows,
  });
  const selectQuery = {
    from() {
      return selectQuery;
    },
    innerJoin() {
      return selectQuery;
    },
    where() {
      return activeAutodepositRows;
    },
  };

  return {
    balanceSweepLotClaims: {
      status: "balanceSweepLotClaims.status",
      targetId: "balanceSweepLotClaims.targetId",
    },
    balanceSweepPolicies: {
      active: "balanceSweepPolicies.active",
      id: "balanceSweepPolicies.id",
      policyAccount: "balanceSweepPolicies.policyAccount",
      policyType: "balanceSweepPolicies.policyType",
      settings: "balanceSweepPolicies.settings",
      vaultIndex: "balanceSweepPolicies.vaultIndex",
    },
    balanceSweepSurplusLots: {
      remainingAmountRaw: "balanceSweepSurplusLots.remainingAmountRaw",
      status: "balanceSweepSurplusLots.status",
      targetId: "balanceSweepSurplusLots.targetId",
    },
    balanceSweepTargets: {
      balanceSweepPolicyId: "balanceSweepTargets.balanceSweepPolicyId",
      lifecycleStatus: "balanceSweepTargets.lifecycleStatus",
      policyAccount: "balanceSweepTargets.policyAccount",
      settings: "balanceSweepTargets.settings",
      vaultIndex: "balanceSweepTargets.vaultIndex",
    },
    crossMintSwapPolicies: {
      active: "crossMintSwapPolicies.active",
      id: "crossMintSwapPolicies.id",
      policyAccount: "crossMintSwapPolicies.policyAccount",
      settings: "crossMintSwapPolicies.settings",
      vaultIndex: "crossMintSwapPolicies.vaultIndex",
    },
    getYieldOptimizationClient: () => ({
      db: {
        execute: async () => ({ rows: [] }),
        query: {
          balanceSweepTargets: query([]),
          crossMintSwapPolicies: query(activeAutoswapRows),
          managedVaults: query(activeManagedVaultRows),
          routePolicies: query(routePolicyRows),
          userYieldPositions: query(activePositionRows),
        },
        select: () => selectQuery,
      },
    }),
    managedVaults: {
      active: "managedVaults.active",
      activePolicyId: "managedVaults.activePolicyId",
      settings: "managedVaults.settings",
      setupPolicyId: "managedVaults.setupPolicyId",
      vaultIndex: "managedVaults.vaultIndex",
    },
    routePolicies: {
      id: "routePolicies.id",
      policyAccount: "routePolicies.policyAccount",
      settings: "routePolicies.settings",
      vaultIndex: "routePolicies.vaultIndex",
    },
    userYieldPositions: {
      policyAccount: "userYieldPositions.policyAccount",
      settings: "userYieldPositions.settings",
      status: "userYieldPositions.status",
      vaultIndex: "userYieldPositions.vaultIndex",
    },
  };
});

describe("policy refund scan route", () => {
  beforeEach(() => {
    activeAutodepositRows = [
      {
        id: BigInt(1),
        policyAccount: autodepositPolicyAccount,
      },
    ];
    activeAutoswapRows = [];
    activeManagedVaultRows = [];
    activePositionRows = [];
    routePolicyRows = [];
    (
      Connection.prototype as unknown as {
        getProgramAccounts: () => Promise<unknown[]>;
      }
    ).getProgramAccounts = async () => [];
    (
      Connection.prototype as unknown as {
        getMultipleAccountsInfo: (
          keys: PublicKey[]
        ) => Promise<Array<{ lamports: number }>>;
      }
    ).getMultipleAccountsInfo = async (keys: PublicKey[]) =>
      keys.map((_, index) => ({ lamports: 1000 + index }));
  });

  test("marks an active Autodeposit policy as non-refundable", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/policy-refunds/scan", {
        method: "POST",
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.policies).toEqual([
      expect.objectContaining({
        account: autodepositPolicyAccount,
        activeAutodeposit: true,
        blockedReason: "Active Autodeposit policy",
        canRefund: false,
      }),
      expect.objectContaining({
        account: refundablePolicyAccount,
        activeAutodeposit: false,
        blockedReason: null,
        canRefund: true,
      }),
    ]);
  });

  test("protects both active Autoswap policy shards from refunds", async () => {
    activeAutodepositRows = [];
    activeAutoswapRows = [
      { policyAccount: autodepositPolicyAccount },
      { policyAccount: refundablePolicyAccount },
    ];
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/policy-refunds/scan", { method: "POST" })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.policies).toEqual([
      expect.objectContaining({
        account: autodepositPolicyAccount,
        activeAutoswap: true,
        blockedReason: "Active Autoswap policy",
        canRefund: false,
      }),
      expect.objectContaining({
        account: refundablePolicyAccount,
        activeAutoswap: true,
        blockedReason: "Active Autoswap policy",
        canRefund: false,
      }),
    ]);
  });
});
