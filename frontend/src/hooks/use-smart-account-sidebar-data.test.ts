import { describe, expect, mock, test } from "bun:test";
import { LoyalCluster } from "@loyal/actions";
import { PublicKey } from "@solana/web3.js";

import type {
  SmartAccountOverviewBase,
  SmartAccountPolicyOverview,
  SmartAccountProposalSnapshot,
  SmartAccountVaultSnapshot,
} from "@loyal-labs/smart-account-vaults";

import {
  createOverviewFromCache,
  type CurrentBestApyReserveByStablecoinCache,
  getSmartAccountTotalUsd,
  hasInitializedEarnYieldRoutingPolicy,
  prepareEarnDepositOnServer,
  prepareEarnWithdrawOnServer,
  readSmartAccountOverviewCache,
  shouldInitializeEarnYieldRoutingPolicyForDeposit,
  shouldSkipSmartAccountProposalLoad,
  sendPreparedEarnWithClusterPreflight,
  type SmartAccountSignerEntry,
  type SmartAccountVaultEntry,
  writeSmartAccountOverviewCacheGroup,
} from "./use-smart-account-sidebar-data";

const TEST_PUBLIC_KEYS = Array.from({ length: 10 }, () =>
  PublicKey.unique().toBase58()
);

function createMemoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function makeOverviewBase(): SmartAccountOverviewBase {
  return {
    accountUtilization: 0,
    canonicalVaultAddress: "vault-0",
    fetchedAt: 100,
    programId: "program",
    settingsPda: "settings",
    signers: [],
    staleTransactionIndex: "0",
    threshold: 1,
    timeLock: 0,
    transactionIndex: "0",
    vaults: [{ accountIndex: 0, address: "vault-0" }],
  };
}

function makeVaultSnapshot(): SmartAccountVaultSnapshot {
  return {
    accountIndex: 0,
    activity: { activities: [] },
    address: "vault-0",
    lamports: 5,
    portfolio: {
      fetchedAt: 200,
      nativeBalanceLamports: 5,
      owner: "vault-0",
      positions: [],
      totals: {
        effectiveSolPriceUsd: null,
        pricedCount: 0,
        totalSol: null,
        totalUsd: 12,
        unpricedCount: 0,
      },
    },
    signers: [],
    spendingLimits: [],
  };
}

function makePolicyOverview(): SmartAccountPolicyOverview {
  return {
    policies: [],
    signers: [
      {
        address: "signer-1",
        canExecute: true,
        canInitiate: true,
        canVote: true,
        consensusAddress: "settings",
        lamports: null,
        permissionMask: 7,
        permissions: ["initiate", "vote", "execute"],
        policyAddress: null,
        policySeed: null,
        scope: "settings",
        threshold: 1,
        timeLock: 0,
      },
    ],
    spendingLimits: [],
  };
}

function makeProposal(): SmartAccountProposalSnapshot {
  return {
    accountIndex: null,
    approvals: [],
    cancellations: [],
    consensusAddress: "settings",
    creator: null,
    decodedInstructions: [],
    payloadType: "settings_transaction",
    proposalAddress: "proposal",
    rejections: [],
    status: "active",
    statusTimestamp: null,
    summary: {
      amountRaw: null,
      amountUi: null,
      decimals: null,
      destination: null,
      instructionCount: 0,
      kind: "settings_change",
      mint: null,
      programId: null,
      subtitle: "Settings change",
      symbol: null,
      title: "Settings change",
    },
    transactionAddress: "transaction",
    transactionIndex: "1",
  };
}

function makeBestApyReserves(): CurrentBestApyReserveByStablecoinCache {
  return {
    riskProfile: "safe",
    reserves: [
      {
        borrowApy: 0.01,
        liquidityMint: "usdc-mint",
        market: "market",
        marketName: "Main",
        observedAt: "2026-06-01T00:00:00.000Z",
        reserve: "reserve-usdc",
        slot: 1,
        stablecoin: "USDC",
        supplyApy: 0.12,
        symbol: "USDC",
        totalBorrowUsdEstimate: 10,
        totalSupplyUsdEstimate: 1_000_000,
        utilization: 0.2,
      },
    ],
  };
}

function makeSigner(
  address: string,
  totalUsd: number
): SmartAccountSignerEntry {
  return {
    accessLabel: "Suggest",
    accessLevel: "suggest",
    address,
    balanceFraction: ".00",
    balanceWhole: "$0",
    canExecute: false,
    canInitiate: true,
    canVote: false,
    icon: "/agents/Agent-01.svg",
    id: `policy:${address}`,
    label: "Agent 1",
    permissions: ["initiate"],
    policyAddress: null,
    scope: "policy",
    scopeLabel: "Constrained policy",
    shortAddress: `${address.slice(0, 4)}…${address.slice(-4)}`,
    spendingLimit: null,
    spendingLimits: [],
    totalUsd,
  };
}

function makeVault(
  accountIndex: number,
  totalUsd: number,
  signers: SmartAccountSignerEntry[]
): SmartAccountVaultEntry {
  return {
    accountIndex,
    address: `vault-${accountIndex}`,
    balanceFraction: ".00",
    balanceWhole: "$0",
    label: "Stash",
    signers,
    totalUsd,
  };
}

describe("getSmartAccountTotalUsd", () => {
  test("adds stash balances and non-main signer balances", () => {
    const totalUsd = getSmartAccountTotalUsd({
      authenticatedWalletAddress: "MAIN1111",
      vaultEntries: [
        makeVault(0, 25, [
          makeSigner("MAIN1111", 100),
          makeSigner("AGENT111", 7),
        ]),
        makeVault(1, 10, [makeSigner("AGENT111", 7)]),
      ],
    });

    expect(totalUsd).toBe(42);
  });
});

describe("Earn policy detection", () => {
  test("treats missing Earn policy as a first deposit", () => {
    expect(
      hasInitializedEarnYieldRoutingPolicy({
        policies: [],
      } as never)
    ).toBe(false);
  });

  test("treats seed 1 ProgramInteraction policy on vault 1 as a top-up", () => {
    expect(
      hasInitializedEarnYieldRoutingPolicy({
        policies: [
          {
            accountIndex: 1,
            seed: "1",
            state: "ProgramInteraction",
          },
        ],
      } as never)
    ).toBe(true);
  });

  test("ignores ProgramInteraction policies on other seeds or vaults", () => {
    expect(
      hasInitializedEarnYieldRoutingPolicy({
        policies: [
          {
            accountIndex: 1,
            seed: "2",
            state: "ProgramInteraction",
          },
          {
            accountIndex: 0,
            seed: "1",
            state: "ProgramInteraction",
          },
        ],
      } as never)
    ).toBe(false);
  });

  test("uses active Earn position as top-up evidence when policy overview is stale", () => {
    expect(
      shouldInitializeEarnYieldRoutingPolicyForDeposit({
        hasActiveEarnPosition: true,
        overview: {
          policies: [],
        } as never,
      })
    ).toBe(false);
  });

  test("uses DB-backed Earn policy as top-up evidence when overview policy is absent", () => {
    expect(
      shouldInitializeEarnYieldRoutingPolicyForDeposit({
        hasActiveEarnPosition: false,
        hasEarnPolicy: true,
        overview: {
          policies: [],
        } as never,
      })
    ).toBe(false);
  });

  test("initializes policy when neither overview policy nor active position exists", () => {
    expect(
      shouldInitializeEarnYieldRoutingPolicyForDeposit({
        hasActiveEarnPosition: false,
        hasEarnPolicy: false,
        overview: {
          policies: [],
        } as never,
      })
    ).toBe(true);
  });
});

describe("prepareEarnDepositOnServer", () => {
  test("posts amountRaw to the server prepare endpoint and hydrates the operation", async () => {
    const fetchImpl = mock(async () => {
      return Response.json({
        preparedDeposit: {
          persistence: {
            cluster: LoyalCluster.Devnet,
            depositMint: TEST_PUBLIC_KEYS[0],
            liquidityMint: TEST_PUBLIC_KEYS[0],
            market: TEST_PUBLIC_KEYS[1],
            policyAccount: TEST_PUBLIC_KEYS[2],
            policyId: "2",
            policyInitialization: "reuse",
            policySeed: "2",
            principalAmountRaw: "1000000",
            settings: TEST_PUBLIC_KEYS[3],
            targetReserve: TEST_PUBLIC_KEYS[4],
            targetSupplyApyBps: null,
            vaultIndex: 1,
            vaultPubkey: TEST_PUBLIC_KEYS[5],
            walletAddress: TEST_PUBLIC_KEYS[6],
          },
          policy: {
            account: TEST_PUBLIC_KEYS[2],
            id: "2",
            sameMintInstructionConstraintIndexes: [0, 1],
            seed: "2",
          },
          prepared: {
            instructions: [
              {
                dataBase64: "AQID",
                keys: [
                  {
                    isSigner: true,
                    isWritable: true,
                    pubkey: TEST_PUBLIC_KEYS[6],
                  },
                ],
                programId: TEST_PUBLIC_KEYS[7],
              },
            ],
            lookupTableAccounts: [],
            operation: "earnUsdcDeposit",
            payer: TEST_PUBLIC_KEYS[6],
            programId: TEST_PUBLIC_KEYS[7],
            requiresConfirmation: true,
          },
          targetReserve: {
            liquidityMint: TEST_PUBLIC_KEYS[0],
            market: TEST_PUBLIC_KEYS[1],
            reserve: TEST_PUBLIC_KEYS[4],
            supplyApyBps: null,
          },
          vault: {
            accountIndex: 1,
            pubkey: TEST_PUBLIC_KEYS[5],
            usdcAta: TEST_PUBLIC_KEYS[7],
          },
        },
      });
    });

    const preparedDeposit = await prepareEarnDepositOnServer({
      amountRaw: BigInt(1_000_000),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/smart-accounts/yield-optimization/deposits/prepare",
      {
        body: JSON.stringify({ amountRaw: "1000000" }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
    expect(preparedDeposit.persistence.policyInitialization).toBe("reuse");
    expect(preparedDeposit.persistence.principalAmountRaw).toBe("1000000");
    expect(preparedDeposit.prepared.operation).toBe("earnUsdcDeposit");
    expect([...preparedDeposit.prepared.instructions[0].data]).toEqual([
      1, 2, 3,
    ]);
    expect(preparedDeposit.prepared.instructions[0].keys[0]).toMatchObject({
      isSigner: true,
      isWritable: true,
    });
    expect(
      preparedDeposit.prepared.instructions[0].keys[0].pubkey.toBase58()
    ).toBe(TEST_PUBLIC_KEYS[6]);
  });

  test("surfaces prepare endpoint errors before wallet send", async () => {
    const fetchImpl = mock(async () => {
      return Response.json(
        {
          error: {
            code: "missing_earn_policy",
            message: "Set up the Earn policy before adding more USDC.",
          },
        },
        { status: 409 }
      );
    });

    await expect(
      prepareEarnDepositOnServer({
        amountRaw: BigInt(1_000_000),
        fetchImpl,
      })
    ).rejects.toThrow("Set up the Earn policy before adding more USDC.");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("prepareEarnWithdrawOnServer", () => {
  test("posts amountRaw and mode to the server prepare endpoint", async () => {
    const fetchImpl = mock(async () => {
      return Response.json({
        preparedWithdraw: {
          amountRaw: "500000",
          mode: "partial",
          persistence: {
            cluster: LoyalCluster.Devnet,
            liquidityMint: TEST_PUBLIC_KEYS[0],
            market: TEST_PUBLIC_KEYS[1],
            mode: "partial",
            policyAccount: TEST_PUBLIC_KEYS[2],
            policyId: "2",
            policySeed: "2",
            settings: TEST_PUBLIC_KEYS[3],
            targetReserve: TEST_PUBLIC_KEYS[4],
            vaultIndex: 1,
            vaultPubkey: TEST_PUBLIC_KEYS[5],
            walletAddress: TEST_PUBLIC_KEYS[6],
            withdrawnAmountRaw: "500000",
          },
          policy: {
            account: TEST_PUBLIC_KEYS[2],
            id: "2",
            sameMintInstructionConstraintIndexes: [0, 1],
            seed: "2",
            withdrawInstructionConstraintIndex: 0,
          },
          prepared: {
            instructions: [
              {
                dataBase64: "BAUG",
                keys: [
                  {
                    isSigner: true,
                    isWritable: true,
                    pubkey: TEST_PUBLIC_KEYS[6],
                  },
                ],
                programId: TEST_PUBLIC_KEYS[7],
              },
            ],
            lookupTableAccounts: [],
            operation: "earnUsdcWithdraw",
            payer: TEST_PUBLIC_KEYS[6],
            programId: TEST_PUBLIC_KEYS[7],
            requiresConfirmation: true,
          },
          targetReserve: {
            liquidityMint: TEST_PUBLIC_KEYS[0],
            market: TEST_PUBLIC_KEYS[1],
            reserve: TEST_PUBLIC_KEYS[4],
          },
          vault: {
            accountIndex: 1,
            collateralAta: TEST_PUBLIC_KEYS[8],
            pubkey: TEST_PUBLIC_KEYS[5],
            usdcAta: TEST_PUBLIC_KEYS[9],
          },
        },
      });
    });

    const preparedWithdraw = await prepareEarnWithdrawOnServer({
      amountRaw: BigInt(500_000),
      fetchImpl,
      mode: "partial",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/smart-accounts/yield-optimization/withdrawals/prepare",
      {
        body: JSON.stringify({ amountRaw: "500000", mode: "partial" }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
    expect(preparedWithdraw.amountRaw).toBe(BigInt(500_000));
    expect(preparedWithdraw.mode).toBe("partial");
    expect(preparedWithdraw.persistence.withdrawnAmountRaw).toBe("500000");
    expect(preparedWithdraw.prepared.operation).toBe("earnUsdcWithdraw");
    expect([...preparedWithdraw.prepared.instructions[0].data]).toEqual([
      4, 5, 6,
    ]);
  });

  test("surfaces withdrawal prepare endpoint errors before wallet send", async () => {
    const fetchImpl = mock(async () => {
      return Response.json(
        {
          error: {
            code: "prepare_failed",
            message: "Failed to prepare Earn withdrawal.",
          },
        },
        { status: 500 }
      );
    });

    await expect(
      prepareEarnWithdrawOnServer({
        amountRaw: BigInt(500_000),
        fetchImpl,
        mode: "partial",
      })
    ).rejects.toThrow("Failed to prepare Earn withdrawal.");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("Earn prepared cluster preflight", () => {
  test("blocks signing when prepared metadata would be rejected by the server", async () => {
    const send = mock(async () => "signature");

    const result = await sendPreparedEarnWithClusterPreflight({
      expectedCluster: LoyalCluster.MainnetBeta,
      operation: "deposit",
      preparedCluster: LoyalCluster.Devnet,
      send,
    });

    expect(result).toEqual({
      success: false,
      error:
        "Internal Earn configuration error: prepared deposit cluster devnet does not match configured cluster mainnet-beta.",
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("smart-account overview cache", () => {
  test("reads matching cache entries and rejects mismatched environment", () => {
    const storage = createMemoryStorage();
    writeSmartAccountOverviewCacheGroup({
      data: makeOverviewBase(),
      group: "base",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });

    expect(
      readSmartAccountOverviewCache({
        settingsPda: "settings",
        solanaEnv: "devnet",
        storage,
      })?.groups.base?.data.settingsPda
    ).toBe("settings");

    expect(
      readSmartAccountOverviewCache({
        settingsPda: "settings",
        solanaEnv: "mainnet",
        storage,
      })
    ).toBeNull();
  });

  test("preserves existing cached groups when writing another group", () => {
    const storage = createMemoryStorage();

    writeSmartAccountOverviewCacheGroup({
      data: makeOverviewBase(),
      group: "base",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });
    writeSmartAccountOverviewCacheGroup({
      data: [makeVaultSnapshot()],
      group: "vaults",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });

    const cache = readSmartAccountOverviewCache({
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });

    expect(cache?.groups.base?.data.settingsPda).toBe("settings");
    expect(cache?.groups.vaults?.data[0]?.portfolio.totals.totalUsd).toBe(12);
  });

  test("caches best APY reserves independently from overview groups", () => {
    const storage = createMemoryStorage();

    writeSmartAccountOverviewCacheGroup({
      data: makeOverviewBase(),
      group: "base",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });
    writeSmartAccountOverviewCacheGroup({
      data: makeBestApyReserves(),
      group: "bestApyReserves",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });

    const cache = readSmartAccountOverviewCache({
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });

    expect(cache?.groups.base?.data.settingsPda).toBe("settings");
    expect(cache?.groups.bestApyReserves?.data.reserves[0]?.reserve).toBe(
      "reserve-usdc"
    );
  });

  test("rebuilds an overview from cached partial groups", () => {
    const storage = createMemoryStorage();

    writeSmartAccountOverviewCacheGroup({
      data: makeOverviewBase(),
      group: "base",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });
    writeSmartAccountOverviewCacheGroup({
      data: [makeVaultSnapshot()],
      group: "vaults",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });
    writeSmartAccountOverviewCacheGroup({
      data: makePolicyOverview(),
      group: "policies",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });
    writeSmartAccountOverviewCacheGroup({
      data: [makeProposal()],
      group: "proposals",
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });

    const cache = readSmartAccountOverviewCache({
      settingsPda: "settings",
      solanaEnv: "devnet",
      storage,
    });
    expect(cache).not.toBeNull();

    const overview = cache ? createOverviewFromCache(cache) : null;

    expect(overview?.settingsPda).toBe("settings");
    expect(overview?.vaults[0]?.portfolio.totals.totalUsd).toBe(12);
    expect(overview?.vaults[0]?.signers[0]?.address).toBe("signer-1");
    expect(overview?.proposals[0]?.proposalAddress).toBe("proposal");
  });
});

describe("smart-account proposals fast path", () => {
  test("skips proposal loading when root settings has no fresh transactions", () => {
    expect(
      shouldSkipSmartAccountProposalLoad({
        staleTransactionIndex: "0",
        transactionIndex: "0",
      })
    ).toBe(true);
    expect(
      shouldSkipSmartAccountProposalLoad({
        staleTransactionIndex: "2",
        transactionIndex: "2",
      })
    ).toBe(true);
  });

  test("loads proposals when root settings has unprocessed transactions", () => {
    expect(
      shouldSkipSmartAccountProposalLoad({
        staleTransactionIndex: "0",
        transactionIndex: "1",
      })
    ).toBe(false);
  });
});
