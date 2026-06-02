import { describe, expect, test } from "bun:test";

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
  readSmartAccountOverviewCache,
  type SmartAccountSignerEntry,
  type SmartAccountVaultEntry,
  writeSmartAccountOverviewCacheGroup,
} from "./use-smart-account-sidebar-data";

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
