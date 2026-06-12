import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

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
const activePosition = {
  principalAmountRaw: BigInt(1_000_026),
};
const completeAutodepositState = {
  policy: {
    policyAccount: "11111111111111111111111111111118",
  },
  target: {
    id: BigInt(11),
    recurringDelegation: "11111111111111111111111111111119",
  },
};

let currentPrincipal: typeof principal | null = principal;
let currentAutodepositState: typeof completeAutodepositState | null = null;
let currentPosition: typeof activePosition | null = activePosition;
let findAutodepositCalls: unknown[] = [];
let findPolicyCalls: unknown[] = [];
let findPositionCalls: unknown[] = [];
let prepareCalls: Record<string, unknown>[] = [];

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => currentPrincipal,
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

mock.module("@/lib/yield-optimization/deployment-policy-signer.server", () => ({
  getDeploymentPolicySignerPublicKey: () =>
    new PublicKey("11111111111111111111111111111115"),
}));

mock.module(
  "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared",
  () => ({
    parseEarnWithdrawPrepareRequestBody: (body: {
      amountRaw: string;
      mode: "partial" | "full";
    }) => ({
      amountRaw: BigInt(body.amountRaw),
      mode: body.mode,
    }),
    serializePreparedEarnUsdcWithdraw: () => ({ ok: true }),
  })
);

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    findCurrentEarnAutodepositState: async (input: unknown) => {
      findAutodepositCalls.push(input);
      return currentAutodepositState;
    },
  })
);

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldPosition: async (input: unknown) => {
    findPositionCalls.push(input);
    return currentPosition;
  },
  findActiveYieldRoutePolicy: async (input: unknown) => {
    findPolicyCalls.push(input);
    return activePolicy;
  },
}));

mock.module("@loyal-labs/smart-account-vaults", () => ({
  createSmartAccountVaultsClient: () => ({
    prepareEarnUsdcWithdraw: async (input: Record<string, unknown>) => {
      prepareCalls.push(input);
      return { prepared: true, input };
    },
  }),
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
    currentAutodepositState = null;
    currentPosition = activePosition;
    findAutodepositCalls = [];
    findPolicyCalls = [];
    findPositionCalls = [];
    prepareCalls = [];
  });

  test("does not fetch autodeposit state for partial withdrawals", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({ amountRaw: "1000000", mode: "partial" })
    );

    expect(response.status).toBe(200);
    expect(findPolicyCalls).toHaveLength(1);
    expect(findAutodepositCalls).toHaveLength(0);
    expect(findPositionCalls).toHaveLength(0);
    expect(prepareCalls[0]?.amountRaw).toBe(BigInt(1_000_000));
    expect(prepareCalls[0]?.mode).toBe("partial");
    expect(prepareCalls[0]?.autodepositClose).toBeUndefined();
  });

  test("passes complete active autodeposit close metadata for full withdrawals", async () => {
    const { POST } = await import("./route");
    currentAutodepositState = completeAutodepositState;

    const response = await POST(
      createRequest({ amountRaw: "1000000", mode: "full" })
    );

    expect(response.status).toBe(200);
    expect(findPositionCalls).toEqual([
      {
        cluster: "mainnet-beta",
        initialReserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
        settings: principal.settingsPda,
        vaultIndex: 1,
        walletAddress: principal.walletAddress,
      },
    ]);
    expect(prepareCalls[0]?.amountRaw).toBe(activePosition.principalAmountRaw);
    expect(findAutodepositCalls).toEqual([
      {
        settings: principal.settingsPda,
        vaultIndex: 1,
        walletAddress: principal.walletAddress,
      },
    ]);
    expect(
      (
        prepareCalls[0]?.autodepositClose as {
          policy: PublicKey;
          recurringDelegation: PublicKey;
        }
      ).policy.toBase58()
    ).toBe(completeAutodepositState.policy.policyAccount);
    expect(
      (
        prepareCalls[0]?.autodepositClose as {
          policy: PublicKey;
          recurringDelegation: PublicKey;
        }
      ).recurringDelegation.toBase58()
    ).toBe(completeAutodepositState.target.recurringDelegation);
  });

  test("omits autodeposit close metadata when full withdrawal state is incomplete", async () => {
    const { POST } = await import("./route");
    currentAutodepositState = {
      ...completeAutodepositState,
      target: {
        ...completeAutodepositState.target,
        recurringDelegation: null,
      },
    } as never;

    const response = await POST(
      createRequest({ amountRaw: "1000000", mode: "full" })
    );

    expect(response.status).toBe(200);
    expect(findAutodepositCalls).toHaveLength(1);
    expect(findPositionCalls).toHaveLength(1);
    expect(prepareCalls[0]?.autodepositClose).toBeUndefined();
  });

  test("rejects full withdrawals when no active position exists", async () => {
    const { POST } = await import("./route");
    currentPosition = null;

    const response = await POST(
      createRequest({ amountRaw: "1000000", mode: "full" })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("missing_earn_position");
    expect(prepareCalls).toHaveLength(0);
  });
});
