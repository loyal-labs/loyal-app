import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { Connection, PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const principal = {
  authMethod: "wallet" as const,
  provider: "solana" as const,
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  subjectAddress: "11111111111111111111111111111114",
  walletAddress: "11111111111111111111111111111114",
};
const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey(principal.settingsPda);
const policyAccounts = [11, 12].map((policySeed) =>
  pda.getPolicyPda({ policySeed, programId, settingsPda })[0].toBase58()
) as [string, string];
const pausedEnrollment = {
  boundPolicies: [
    {
      account: policyAccounts[0],
      seed: "11",
      sourceShard: "classic" as const,
    },
    {
      account: policyAccounts[1],
      seed: "12",
      sourceShard: "token_2022" as const,
    },
  ] as const,
  dailySourceMintSpendingCap: "100000000",
  enabled: false,
  generation: "2",
  maxSlippageBps: 50,
};
const setEarnCrossMintEnabled = mock(async () => ({
  enrollment: pausedEnrollment,
  kind: "applied" as const,
}));
const hasNonTerminalEarnCrossMintMovement = mock(async () => true);
const prepareClosePoliciesSync = mock(async () => ({ operation: "close" }));
const getMultipleAccountsInfo = spyOn(
  Connection.prototype,
  "getMultipleAccountsInfo"
);

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
mock.module("@loyal-labs/smart-account-vaults", () => ({
  createSmartAccountVaultsClient: () => ({ prepareClosePoliciesSync }),
}));
mock.module("@/lib/smart-accounts/prepared-operation-wire.shared", () => ({
  serializePreparedOperation: () => ({ operation: "close" }),
}));
mock.module(
  "@/lib/yield-optimization/earn-cross-mint-repository.server",
  () => ({
    hasNonTerminalEarnCrossMintMovement,
    removeEarnCrossMintOptIn: async () => {},
    setEarnCrossMintEnabled,
  })
);

const { POST } = await import("./route");

beforeEach(() => {
  hasNonTerminalEarnCrossMintMovement.mockClear();
  hasNonTerminalEarnCrossMintMovement.mockResolvedValue(true);
  prepareClosePoliciesSync.mockClear();
  setEarnCrossMintEnabled.mockClear();
});

test("Autoswap deletion commits pause but refuses active movement cleanup", async () => {
  const response = await POST(
    new Request("https://loyal.local/delete", {
      body: JSON.stringify({ expectedGeneration: "1" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "movement_in_progress" },
  });
  expect(setEarnCrossMintEnabled).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false, expectedGeneration: BigInt(1) })
  );
});

test("Autoswap deletion closes the one remaining bound policy", async () => {
  hasNonTerminalEarnCrossMintMovement.mockResolvedValue(false);
  getMultipleAccountsInfo.mockResolvedValue([
    null,
    { data: Buffer.alloc(0) } as never,
  ]);

  const response = await POST(
    new Request("https://loyal.local/delete", {
      body: JSON.stringify({ expectedGeneration: "2" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  expect(response.status).toBe(200);
  expect(prepareClosePoliciesSync).toHaveBeenCalledWith(
    expect.objectContaining({
      policies: [new PublicKey(policyAccounts[1])],
    })
  );
  await expect(response.json()).resolves.toMatchObject({
    policies: policyAccounts,
    status: "prepared",
  });
});
