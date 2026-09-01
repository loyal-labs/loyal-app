import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Connection, PublicKey } from "@solana/web3.js";

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

let activeAutodepositRows: Array<{
  id: bigint;
  policyAccount: string;
}> = [];
let activeManagedVaultRows: unknown[] = [];
let activePositionRows: unknown[] = [];
let prepareClosePoliciesSyncCalls: unknown[] = [];
let routePolicyRows: Array<{
  id: bigint;
  policyAccount: string;
}> = [];

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => principal,
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
    fetchPolicyOverview: async () => ({
      policies: [
        {
          accountIndex: 1,
          address: autodepositPolicyAccount,
          seed: "7",
          state: "ProgramInteraction",
        },
      ],
    }),
    prepareClosePoliciesSync: async (input: unknown) => {
      prepareClosePoliciesSyncCalls.push(input);
      return { prepared: true };
    },
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
          crossMintSwapPolicies: query([]),
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
      id: "userYieldPositions.id",
      policyAccount: "userYieldPositions.policyAccount",
      settings: "userYieldPositions.settings",
      status: "userYieldPositions.status",
      vaultIndex: "userYieldPositions.vaultIndex",
    },
  };
});

function createRequest(): Request {
  return new Request("http://localhost/policy-refunds/prepare", {
    body: JSON.stringify({ policyAccount: autodepositPolicyAccount }),
    method: "POST",
  });
}

describe("policy refund prepare route", () => {
  beforeEach(() => {
    activeAutodepositRows = [
      { id: BigInt(1), policyAccount: autodepositPolicyAccount },
    ];
    activeManagedVaultRows = [];
    activePositionRows = [];
    prepareClosePoliciesSyncCalls = [];
    routePolicyRows = [];
    (
      Connection.prototype as unknown as {
        getAccountInfo: (key: PublicKey) => Promise<{ lamports: number }>;
        getProgramAccounts: () => Promise<unknown[]>;
      }
    ).getAccountInfo = async () => ({ lamports: 1000 });
    (
      Connection.prototype as unknown as {
        getProgramAccounts: () => Promise<unknown[]>;
      }
    ).getProgramAccounts = async () => [];
  });

  test("rejects a direct refund prepare for an active Autodeposit policy", async () => {
    const { POST } = await import("./route");

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toEqual({
      code: "policy_active",
      message: "Active Autodeposit policy",
    });
    expect(prepareClosePoliciesSyncCalls).toHaveLength(0);
  });
});
