import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_MAX_FEE_BPS,
  KAMINO_ALTCOINS_MARKET,
  KAMINO_BITCOIN_MARKET,
  KAMINO_HUMA_MARKET,
  KAMINO_JLP_MARKET,
  KAMINO_SOLSTICE_MARKET,
  KAMINO_SUPERSTATE_OPENING_BELL_MARKET,
  KAMINO_XSTOCKS_MARKET,
  LoyalCluster,
  MaxFeeBps,
  RISK_BASKET_MARKETS,
  RiskBasket,
  STABLECOIN_MINTS,
  Stablecoin,
  SwapLane,
  createVaultYieldRoutingPolicyPlan,
  createLoyalActionsSdk,
  createYieldRoutePolicyPlan,
} from "../src/index.js";

const settings = new PublicKey("11111111111111111111111111111112");
const authority = new PublicKey("11111111111111111111111111111113");
const delegatedSigner = new PublicKey("11111111111111111111111111111114");
const vault = new PublicKey("11111111111111111111111111111115");

const squads = {
  settings,
  authority,
  delegatedSigner,
  accountIndex: 0,
  vault,
};
const smartAccount = {
  settings,
  authority,
  delegatedSigner,
};

function deriveVault(settingsPda: PublicKey, vaultIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("smart_account"),
      settingsPda.toBytes(),
      Buffer.from("smart_account"),
      Uint8Array.from([vaultIndex]),
    ],
    new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG")
  )[0];
}

describe("initYieldRoutePolicy", () => {
  test("builds one all-in-one policy instruction and route indexes for Jupiter", () => {
    const sdk = createLoyalActionsSdk({ cluster: LoyalCluster.MainnetBeta });
    const policy = sdk.initYieldRoutePolicy({
      risk: RiskBasket.Safe,
      swapLanes: [SwapLane.Jupiter] as const,
      squads,
    });

    expect(policy.instructions).toHaveLength(1);
    expect(policy.instructions[0]?.programId.toBase58()).toBe(
      "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"
    );
    expect(
      policy.instructions[0]?.keys.map((key) => [
        key.pubkey.toBase58(),
        key.isSigner,
        key.isWritable,
      ])
    ).toEqual([
      [settings.toBase58(), false, true],
      [authority.toBase58(), true, true],
      ["11111111111111111111111111111111", false, false],
      ["SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG", false, false],
      [authority.toBase58(), true, false],
      [policy.actionAccount.toBase58(), false, true],
    ]);
    expect(policy.instructions[0]?.data.subarray(0, 8).toJSON().data).toEqual([
      138, 209, 64, 163, 79, 67, 233, 76,
    ]);
    expect(policy.routes.sameMint.instructionConstraintIndexes).toEqual([0, 2]);
    expect(policy.routes.jupiter.instructionConstraintIndexes).toEqual([
      0, 1, 2,
    ]);
    expect(policy.routes.loyal).toBeUndefined();
    expect(policy.spec.maxFeeBps).toBe(DEFAULT_MAX_FEE_BPS);
    expect(policy.metadata).toEqual({
      vaultIndex: squads.accountIndex,
      vault: squads.vault,
      lockKey: `${settings.toBase58()}:${squads.accountIndex}`,
    });
    expect(policy.persistence).toEqual({
      riskProfile: RiskBasket.Safe,
      universePreset: "canonical_stable_kamino",
      routeModes: ["same_mint_kamino", "jupiter", "loyal"],
      stableMints: policy.spec.stableMints.map((mint) => mint.toBase58()),
      kaminoMarkets: policy.spec.kaminoMarkets.map((market) =>
        market.toBase58()
      ),
      kaminoLiquidityMints: policy.spec.kaminoLiquidityMints.map((mint) =>
        mint.toBase58()
      ),
      swapLanes: [
        {
          lane: SwapLane.Jupiter,
          actionAccount: policy.actionAccount.toBase58(),
          instructionConstraintIndexes: [0, 1, 2],
        },
      ],
      threshold: 1,
    });
  });

  test("computes route indexes for Loyal and combined lane order", () => {
    const sdk = createLoyalActionsSdk({ cluster: LoyalCluster.MainnetBeta });
    const loyalOnly = sdk.initYieldRoutePolicy({
      risk: RiskBasket.Safe,
      swapLanes: [SwapLane.Loyal] as const,
      squads,
    });
    const both = sdk.initYieldRoutePolicy({
      risk: RiskBasket.Safe,
      swapLanes: [SwapLane.Jupiter, SwapLane.Loyal] as const,
      maxFeeBps: MaxFeeBps.Bps150,
      squads,
    });

    expect(loyalOnly.routes.sameMint.instructionConstraintIndexes).toEqual([
      0, 2,
    ]);
    expect(loyalOnly.routes.loyal.instructionConstraintIndexes).toEqual([
      0, 1, 2,
    ]);
    expect(loyalOnly.routes.jupiter).toBeUndefined();
    expect(both.routes.sameMint.instructionConstraintIndexes).toEqual([0, 3]);
    expect(both.routes.jupiter.instructionConstraintIndexes).toEqual([0, 1, 3]);
    expect(both.routes.loyal.instructionConstraintIndexes).toEqual([0, 2, 3]);
    expect(both.spec.maxFeeBps).toBe(MaxFeeBps.Bps150);
  });

  test("derives stable exposure internally from the approved seven symbols", () => {
    const sdk = createLoyalActionsSdk({ cluster: LoyalCluster.MainnetBeta });
    const policy = sdk.initYieldRoutePolicy({
      risk: RiskBasket.Safe,
      swapLanes: [SwapLane.Jupiter] as const,
      squads,
    });

    expect(Object.values(Stablecoin).map(String)).toEqual([
      "USDC",
      "USDT",
      "PYUSD",
      "USDS",
      "USDG",
      "USDE",
      "SUSDE",
    ]);
    expect(Object.keys(STABLECOIN_MINTS)).toEqual(Object.values(Stablecoin));
    expect(policy.spec.stablecoins).toEqual(Object.values(Stablecoin));
    expect(policy.spec.stableMints.map((mint) => mint.toBase58())).toEqual([
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
      "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
      "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT",
      "Eh6XEPhSwoLv5wFApukmnaVSHQ6sAnoD9BmgmwQoN2sN",
    ]);
    expect(policy.spec.kaminoLiquidityMints).toEqual(policy.spec.stableMints);
  });

  test("keeps risk baskets cumulative and curated", () => {
    const safe = RISK_BASKET_MARKETS[RiskBasket.Safe];
    const medium = RISK_BASKET_MARKETS[RiskBasket.Medium];
    const aggressive = RISK_BASKET_MARKETS[RiskBasket.Aggressive];

    expect(safe.every((market) => medium.includes(market))).toBe(true);
    expect(medium.every((market) => aggressive.includes(market))).toBe(true);
    for (const market of [
      KAMINO_JLP_MARKET,
      KAMINO_HUMA_MARKET,
      KAMINO_XSTOCKS_MARKET,
      KAMINO_SOLSTICE_MARKET,
      KAMINO_ALTCOINS_MARKET,
    ]) {
      expect(safe).not.toContain(market);
    }
    for (const market of [
      KAMINO_JLP_MARKET,
      KAMINO_BITCOIN_MARKET,
      KAMINO_SUPERSTATE_OPENING_BELL_MARKET,
    ]) {
      expect(medium).toContain(market);
    }
    expect(medium).not.toContain(KAMINO_ALTCOINS_MARKET);
    expect(aggressive).toContain(KAMINO_ALTCOINS_MARKET);
  });

  test("rejects invalid inputs before instruction creation", () => {
    const sdk = createLoyalActionsSdk({ cluster: LoyalCluster.MainnetBeta });

    expect(() =>
      sdk.initYieldRoutePolicy({
        risk: RiskBasket.Safe,
        swapLanes: [],
        squads,
      })
    ).toThrow("at least one swap lane is required");
    expect(() =>
      sdk.initYieldRoutePolicy({
        risk: RiskBasket.Safe,
        swapLanes: [SwapLane.Jupiter, SwapLane.Jupiter],
        squads,
      })
    ).toThrow("duplicate swap lane");
    expect(() =>
      sdk.initYieldRoutePolicy({
        risk: RiskBasket.Safe,
        swapLanes: [SwapLane.Jupiter],
        maxFeeBps: 99 as MaxFeeBps,
        squads,
      })
    ).toThrow("unsupported maxFeeBps");
    expect(() =>
      createLoyalActionsSdk({ cluster: "localnet" as LoyalCluster })
    ).toThrow("unsupported Loyal cluster");
  });
});

describe("initYieldRoutingPolicy", () => {
  test("derives the Squads vault and delegates to the explicit all-in-one builder", () => {
    const vaultIndex = 7;
    const explicitVault = deriveVault(settings, vaultIndex);
    const sdk = createLoyalActionsSdk({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
    });
    const explicit = sdk.initYieldRoutePolicy({
      risk: RiskBasket.Safe,
      swapLanes: [SwapLane.Jupiter, SwapLane.Loyal] as const,
      maxFeeBps: MaxFeeBps.Bps125,
      squads: {
        ...smartAccount,
        accountIndex: vaultIndex,
        vault: explicitVault,
      },
    });

    const derived = sdk.initYieldRoutingPolicy({
      risk: RiskBasket.Safe,
      vaultIndex,
      maxFeeBps: MaxFeeBps.Bps125,
    });

    expect(derived.instructions).toEqual(explicit.instructions);
    expect(derived.actionAccount).toEqual(explicit.actionAccount);
    expect(derived.routes).toEqual(explicit.routes);
    expect(derived.spec).toEqual(explicit.spec);
    expect(derived.metadata).toEqual({
      vaultIndex,
      vault: explicitVault,
      lockKey: `${settings.toBase58()}:${vaultIndex}`,
    });
    expect(derived.spec.swapLanes).toEqual([SwapLane.Jupiter, SwapLane.Loyal]);
    expect(derived.routes.jupiter.instructionConstraintIndexes).toEqual([
      0, 1, 3,
    ]);
    expect(derived.routes.loyal.instructionConstraintIndexes).toEqual([
      0, 2, 3,
    ]);
  });

  test("uses the default max fee when callers omit one", () => {
    const sdk = createLoyalActionsSdk({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
    });

    const policy = sdk.initYieldRoutingPolicy({
      risk: RiskBasket.Safe,
      vaultIndex: 0,
    });

    expect(policy.spec.maxFeeBps).toBe(DEFAULT_MAX_FEE_BPS);
  });

  test("rejects missing smart-account config and invalid vault indexes", () => {
    const sdkWithoutSmartAccount = createLoyalActionsSdk({
      cluster: LoyalCluster.MainnetBeta,
    });
    const sdk = createLoyalActionsSdk({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
    });

    expect(() =>
      sdkWithoutSmartAccount.initYieldRoutingPolicy({
        risk: RiskBasket.Safe,
        vaultIndex: 0,
      })
    ).toThrow("smartAccount config is required");
    expect(() =>
      sdk.initYieldRoutingPolicy({
        risk: RiskBasket.Safe,
        vaultIndex: 256,
      })
    ).toThrow("vaultIndex must be a u8");
    expect(() =>
      sdk.initYieldRoutingPolicy({
        risk: RiskBasket.Safe,
        vaultIndex: -1,
      })
    ).toThrow("vaultIndex must be a u8");
    expect(() =>
      sdk.initYieldRoutingPolicy({
        risk: "weird" as RiskBasket,
        vaultIndex: 0,
      })
    ).toThrow("unsupported risk basket");
  });
});

describe("yield route policy plan compilers", () => {
  test("explicit plan matches the compatibility wrapper shape", () => {
    const sdk = createLoyalActionsSdk({ cluster: LoyalCluster.MainnetBeta });
    const input = {
      cluster: LoyalCluster.MainnetBeta,
      risk: RiskBasket.Medium,
      swapLanes: [SwapLane.Jupiter, SwapLane.Loyal] as const,
      maxFeeBps: MaxFeeBps.Bps75,
      squads,
    };

    const plan = createYieldRoutePolicyPlan(input);
    const wrappedPlan = sdk.initYieldRoutePolicy({
      risk: input.risk,
      swapLanes: input.swapLanes,
      maxFeeBps: input.maxFeeBps,
      squads: input.squads,
    });

    expect(wrappedPlan.instructions).toEqual(plan.instructions);
    expect(wrappedPlan.actionAccount).toEqual(plan.actionAccount);
    expect(wrappedPlan.routes).toEqual(plan.routes);
    expect(wrappedPlan.spec).toEqual(plan.spec);
    expect(wrappedPlan.metadata).toEqual(plan.metadata);
    expect(wrappedPlan.persistence).toEqual(plan.persistence);
  });

  test("vault-indexed plan derives the same vault PDA as manual Squads derivation", () => {
    const vaultIndex = 9;
    const plan = createVaultYieldRoutingPolicyPlan({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
      risk: RiskBasket.Safe,
      vaultIndex,
    });

    expect(plan.metadata.vault).toEqual(deriveVault(settings, vaultIndex));
    expect(plan.metadata.vaultIndex).toBe(vaultIndex);
    expect(plan.metadata.lockKey).toBe(`${settings.toBase58()}:${vaultIndex}`);
  });

  test("vault-indexed wrapper returns the same plan as the public compiler", () => {
    const sdk = createLoyalActionsSdk({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
    });
    const input = {
      risk: RiskBasket.Safe,
      vaultIndex: 7,
      maxFeeBps: MaxFeeBps.Bps125,
    };

    const plan = createVaultYieldRoutingPolicyPlan({
      ...input,
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
    });
    const wrappedPlan = sdk.initYieldRoutingPolicy(input);

    expect(wrappedPlan).toEqual(plan);
  });

  test("vault-indexed routing exposes Jupiter and Loyal persistence metadata", () => {
    const plan = createVaultYieldRoutingPolicyPlan({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
      risk: RiskBasket.Safe,
      vaultIndex: 0,
    });

    expect(plan.routes.jupiter.instructionConstraintIndexes).toEqual([0, 1, 3]);
    expect(plan.routes.loyal.instructionConstraintIndexes).toEqual([0, 2, 3]);
    expect(plan.persistence.swapLanes).toEqual([
      {
        lane: SwapLane.Jupiter,
        actionAccount: plan.actionAccount.toBase58(),
        instructionConstraintIndexes: [0, 1, 3],
      },
      {
        lane: SwapLane.Loyal,
        actionAccount: plan.actionAccount.toBase58(),
        instructionConstraintIndexes: [0, 2, 3],
      },
    ]);
  });

  test("safe earn policy metadata exposes vault 1 and withdraw/same-mint indexes", () => {
    const plan = createVaultYieldRoutingPolicyPlan({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
      risk: RiskBasket.Safe,
      vaultIndex: 1,
    });

    expect(plan.metadata.vaultIndex).toBe(1);
    expect(plan.routes.sameMint.instructionConstraintIndexes).toEqual([0, 3]);
    expect(plan.routes.jupiter.instructionConstraintIndexes).toEqual([0, 1, 3]);
    expect(plan.routes.loyal.instructionConstraintIndexes).toEqual([0, 2, 3]);
    expect(plan.persistence).toMatchObject({
      riskProfile: RiskBasket.Safe,
      routeModes: ["same_mint_kamino", "jupiter", "loyal"],
      threshold: 1,
      universePreset: "canonical_stable_kamino",
    });
  });
});
