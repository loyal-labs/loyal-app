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
  SUBSCRIPTIONS_CREATE_RECURRING_DELEGATION,
  SUBSCRIPTIONS_INIT_AUTHORITY,
  SUBSCRIPTIONS_PROGRAM_ID,
  SUBSCRIPTIONS_REVOKE_DELEGATION,
  SUBSCRIPTIONS_TRANSFER_RECURRING,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET,
  SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET,
  SUBSCRIPTION_TRANSFER_MINT_OFFSET,
  Stablecoin,
  SwapLane,
  YIELD_ROUTE_STANDALONE_ACTION_SEED,
  createSubscriptionSweepPolicyPlan,
  createVaultSubscriptionSweepPolicyPlan,
  createVaultYieldRoutingPolicyPlan,
  createLoyalActionsSdk,
  createYieldRoutePolicyPlan,
  deriveRecurringDelegation,
  deriveSubscriptionAuthority,
  deriveSubscriptionEventAuthority,
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
  subscriptionCreateRecurringDelegationData,
  subscriptionInitAuthorityData,
  subscriptionRevokeDelegationData,
  subscriptionTransferRecurringData,
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

describe("Loyal cluster helpers", () => {
  test("normalizes canonical and legacy cluster names", () => {
    expect(normalizeLoyalCluster("devnet")).toBe(LoyalCluster.Devnet);
    expect(normalizeLoyalCluster("mainnet-beta")).toBe(
      LoyalCluster.MainnetBeta
    );
    expect(normalizeLoyalCluster("mainnet")).toBe(LoyalCluster.MainnetBeta);
  });

  test("maps Solana RPC envs into Earn persistence clusters", () => {
    expect(resolveLoyalClusterForSolanaEnv("devnet")).toBe(
      LoyalCluster.Devnet
    );
    expect(resolveLoyalClusterForSolanaEnv("mainnet")).toBe(
      LoyalCluster.MainnetBeta
    );
  });

  test("rejects unsupported Earn persistence envs", () => {
    expect(() => resolveLoyalClusterForSolanaEnv("localnet")).toThrow(
      "Earn persistence does not support Solana env: localnet"
    );
    expect(() => resolveLoyalClusterForSolanaEnv("testnet")).toThrow(
      "Earn persistence does not support Solana env: testnet"
    );
  });
});

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

function derivePolicy(settingsPda: PublicKey, policySeed: bigint): PublicKey {
  const seedBytes = new Uint8Array(8);
  new DataView(seedBytes.buffer).setBigUint64(0, policySeed, true);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("smart_account"),
      Buffer.from("policy"),
      settingsPda.toBytes(),
      seedBytes,
    ],
    new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG")
  )[0];
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      owner.toBytes(),
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBytes(),
      mint.toBytes(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  )[0];
}

type DecodedDataConstraint = {
  dataOffset: bigint;
  dataValue:
    | { type: "u8"; value: number }
    | { type: "u16Le"; value: number }
    | { type: "u32Le"; value: number }
    | { type: "u64Le"; value: bigint }
    | { type: "u128Le"; value: bigint }
    | { type: "u8Slice"; value: number[] };
  operator: string;
};

type DecodedAccountConstraint = {
  accountIndex: number;
  kind:
    | { type: "pubkey"; pubkeyIndexes: number[] }
    | { type: "accountData"; dataConstraints: DecodedDataConstraint[] };
  ownerIndex?: number;
};

type DecodedInstructionConstraint = {
  programIdIndex: number;
  accountConstraints: DecodedAccountConstraint[];
  dataConstraints: DecodedDataConstraint[];
};

function decodePolicyCreate(data: Uint8Array): {
  seed: bigint;
  payload: {
    accountIndex: number;
    pubkeyTable: PublicKey[];
    instructionConstraints: DecodedInstructionConstraint[];
  };
} {
  const cursor = new Cursor(data);
  expect(cursor.readBytes(8)).toEqual([
    138, 209, 64, 163, 79, 67, 233, 76,
  ]);
  expect(cursor.readU8()).toBe(1);
  expect(cursor.readU32()).toBe(1);
  expect(cursor.readU8()).toBe(7);
  const seed = cursor.readU64();
  expect(cursor.readU8()).toBe(4);
  const payload = decodeProgramInteractionPayload(cursor);
  return { seed, payload };
}

function decodeProgramInteractionPayload(cursor: Cursor) {
  const accountIndex = cursor.readU8();
  const pubkeyTable = cursor.readSmallVec(() => cursor.readPubkey());
  const instructionConstraints = cursor.readSmallVec(() => ({
    programIdIndex: cursor.readU8(),
    accountConstraints: cursor.readSmallVec(() =>
      decodeAccountConstraint(cursor)
    ),
    dataConstraints: cursor.readSmallVec(() => decodeDataConstraint(cursor)),
  }));
  return { accountIndex, pubkeyTable, instructionConstraints };
}

function decodeAccountConstraint(
  cursor: Cursor,
): DecodedAccountConstraint {
  const accountIndex = cursor.readU8();
  const kindTag = cursor.readU8();
  const kind =
    kindTag === 0
      ? {
          type: "pubkey" as const,
          pubkeyIndexes: cursor.readSmallVec(() => cursor.readU8()),
        }
      : {
          type: "accountData" as const,
          dataConstraints: cursor.readSmallVec(() =>
            decodeDataConstraint(cursor)
          ),
        };
  const ownerIndex = cursor.readOption(() => cursor.readU8());
  return { accountIndex, kind, ownerIndex };
}

function decodeDataConstraint(cursor: Cursor): DecodedDataConstraint {
  const dataOffset = cursor.readU64();
  const tag = cursor.readU8();
  const dataValue =
    tag === 0
      ? { type: "u8" as const, value: cursor.readU8() }
      : tag === 1
        ? { type: "u16Le" as const, value: cursor.readU16() }
        : tag === 2
          ? { type: "u32Le" as const, value: cursor.readU32() }
          : tag === 3
            ? { type: "u64Le" as const, value: cursor.readU64() }
            : tag === 4
              ? { type: "u128Le" as const, value: cursor.readU128() }
              : { type: "u8Slice" as const, value: cursor.readVecBytes() };
  return {
    dataOffset,
    dataValue,
    operator: ["equals", "notEquals", "greaterThan", "greaterThanOrEqualTo", "lessThan", "lessThanOrEqualTo"][cursor.readU8()] ?? "unknown",
  };
}

class Cursor {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  readU8(): number {
    const value = this.data[this.offset];
    if (value === undefined) {
      throw new Error("cursor overflow");
    }
    this.offset += 1;
    return value;
  }

  readU16(): number {
    const value = this.data[this.offset] | (this.data[this.offset + 1] << 8);
    this.offset += 2;
    return value;
  }

  readU32(): number {
    const value =
      (this.data[this.offset] |
        (this.data[this.offset + 1] << 8) |
        (this.data[this.offset + 2] << 16) |
        (this.data[this.offset + 3] << 24)) >>>
      0;
    this.offset += 4;
    return value;
  }

  readU64(): bigint {
    let value = BigInt(0);
    for (let index = 0; index < 8; index += 1) {
      value |= BigInt(this.readU8()) << BigInt(8 * index);
    }
    return value;
  }

  readU128(): bigint {
    const low = this.readU64();
    const high = this.readU64();
    return low | (high << BigInt(64));
  }

  readPubkey(): PublicKey {
    return new PublicKey(Uint8Array.from(this.readBytes(32)));
  }

  readBytes(length: number): number[] {
    const value = [...this.data.subarray(this.offset, this.offset + length)];
    this.offset += length;
    return value;
  }

  readVecBytes(): number[] {
    return this.readBytes(this.readU32());
  }

  readSmallVec<T>(decode: () => T): T[] {
    const length = this.readU8();
    return Array.from({ length }, decode);
  }

  readOption<T>(decode: () => T): T | undefined {
    return this.readU8() === 0 ? undefined : decode();
  }
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
      policySeed: YIELD_ROUTE_STANDALONE_ACTION_SEED,
      vaultIndex: squads.accountIndex,
      vault: squads.vault,
      lockKey: `${settings.toBase58()}:${squads.accountIndex}`,
    });
    expect(policy.persistence).toEqual({
      riskProfile: RiskBasket.Safe,
      universePreset: "canonical_stable_kamino",
      routeModes: ["same_mint_kamino", "jupiter"],
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
      swapLanes: [SwapLane.Jupiter] as const,
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
      policySeed: YIELD_ROUTE_STANDALONE_ACTION_SEED,
      vaultIndex,
      vault: explicitVault,
      lockKey: `${settings.toBase58()}:${vaultIndex}`,
    });
    expect(derived.spec.swapLanes).toEqual([SwapLane.Jupiter]);
    expect(derived.routes.jupiter.instructionConstraintIndexes).toEqual([
      0, 1, 2,
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

  test("vault-indexed routing exposes Jupiter persistence metadata", () => {
    const plan = createVaultYieldRoutingPolicyPlan({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
      risk: RiskBasket.Safe,
      vaultIndex: 0,
    });

    expect(plan.routes.jupiter.instructionConstraintIndexes).toEqual([0, 1, 2]);
    expect(plan.persistence.swapLanes).toEqual([
      {
        lane: SwapLane.Jupiter,
        actionAccount: plan.actionAccount.toBase58(),
        instructionConstraintIndexes: [0, 1, 2],
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
    expect(plan.routes.sameMint.instructionConstraintIndexes).toEqual([0, 2]);
    expect(plan.routes.jupiter.instructionConstraintIndexes).toEqual([0, 1, 2]);
    expect(plan.persistence).toMatchObject({
      riskProfile: RiskBasket.Safe,
      routeModes: ["same_mint_kamino", "jupiter"],
      threshold: 1,
      universePreset: "canonical_stable_kamino",
    });
  });

  test("allows callers to override the yield routing policy seed", () => {
    const plan = createVaultYieldRoutingPolicyPlan({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
      policySeed: 7,
      risk: RiskBasket.Safe,
      vaultIndex: 1,
    });
    const decoded = decodePolicyCreate(plan.instructions[0]!.data);

    expect(decoded.seed).toBe(BigInt(7));
    expect(plan.metadata.policySeed).toBe(BigInt(7));
    expect(plan.actionAccount).toEqual(derivePolicy(settings, BigInt(7)));
    expect(plan.actionAccount).not.toEqual(
      derivePolicy(settings, YIELD_ROUTE_STANDALONE_ACTION_SEED)
    );
  });
});

describe("subscription sweep policy plan compilers", () => {
  const delegator = new PublicKey("11111111111111111111111111111116");
  const maxAmountPerPeriodRaw = BigInt(250_000);

  test("creates a flexible subscription sweep policy with the caller seed", () => {
    const vaultIndex = 1;
    const plan = createVaultSubscriptionSweepPolicyPlan({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
      policySeed: 2,
      vaultIndex,
      delegator,
      maxAmountPerPeriodRaw,
    });
    const instruction = plan.instructions[0]!;
    const decoded = decodePolicyCreate(instruction.data);
    const subscriptionConstraint = decoded.payload.instructionConstraints[0]!;
    const accountConstraints = subscriptionConstraint.accountConstraints;
    const resolve = (index: number | undefined) =>
      index === undefined
        ? undefined
        : decoded.payload.pubkeyTable[index]?.toBase58();

    expect(instruction.programId.toBase58()).toBe(
      "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"
    );
    expect(
      instruction.keys.map((key) => [
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
      [plan.actionAccount.toBase58(), false, true],
    ]);
    expect(decoded.seed).toBe(BigInt(2));
    expect(plan.actionAccount).toEqual(derivePolicy(settings, BigInt(2)));
    expect(plan.actionAccount).not.toEqual(
      derivePolicy(settings, YIELD_ROUTE_STANDALONE_ACTION_SEED)
    );
    expect(decoded.payload.accountIndex).toBe(vaultIndex);
    expect(decoded.payload.instructionConstraints).toHaveLength(1);
    expect(resolve(subscriptionConstraint.programIdIndex)).toBe(
      SUBSCRIPTIONS_PROGRAM_ID.toBase58()
    );
    expect(accountConstraints.map((constraint) => constraint.accountIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);

    const recurringDelegation = accountConstraints[0]!;
    expect(recurringDelegation.kind.type).toBe("accountData");
    expect(resolve(recurringDelegation.ownerIndex)).toBe(
      SUBSCRIPTIONS_PROGRAM_ID.toBase58()
    );
    if (recurringDelegation.kind.type !== "accountData") {
      throw new Error("expected account data constraint");
    }
    expect(recurringDelegation.kind.dataConstraints).toEqual([
      {
        dataOffset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET),
        dataValue: {
          type: "u8",
          value: SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR,
        },
        operator: "equals",
      },
      {
        dataOffset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET),
        dataValue: { type: "u8Slice", value: [...delegator.toBytes()] },
        operator: "equals",
      },
      {
        dataOffset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET),
        dataValue: { type: "u8Slice", value: [...plan.metadata.vault.toBytes()] },
        operator: "equals",
      },
      {
        dataOffset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET),
        dataValue: {
          type: "u8Slice",
          value: [...plan.metadata.subscriptionAuthority.toBytes()],
        },
        operator: "equals",
      },
      {
        dataOffset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET),
        dataValue: { type: "u8Slice", value: [...plan.metadata.mint.toBytes()] },
        operator: "equals",
      },
      {
        dataOffset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET),
        dataValue: { type: "u64Le", value: maxAmountPerPeriodRaw },
        operator: "lessThanOrEqualTo",
      },
    ]);

    const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const expectedPubkeyAccounts = [
      [1, plan.metadata.subscriptionAuthority, SUBSCRIPTIONS_PROGRAM_ID],
      [2, plan.metadata.delegatorUsdcAta, new PublicKey(tokenProgram)],
      [3, plan.metadata.vaultUsdcAta, new PublicKey(tokenProgram)],
      [4, plan.metadata.mint, new PublicKey(tokenProgram)],
      [5, new PublicKey(tokenProgram), undefined],
      [6, plan.metadata.vault, undefined],
      [7, plan.metadata.eventAuthority, undefined],
      [8, SUBSCRIPTIONS_PROGRAM_ID, undefined],
    ] as const;

    for (const [accountIndex, pubkey, owner] of expectedPubkeyAccounts) {
      const constraint = accountConstraints[accountIndex]!;
      expect(constraint.kind.type).toBe("pubkey");
      if (constraint.kind.type !== "pubkey") {
        throw new Error("expected pubkey constraint");
      }
      expect(
        constraint.kind.pubkeyIndexes.map((index) => resolve(index))
      ).toEqual([pubkey.toBase58()]);
      expect(resolve(constraint.ownerIndex)).toBe(owner?.toBase58());
    }

    expect(subscriptionConstraint.dataConstraints).toEqual([
      {
        dataOffset: BigInt(0),
        dataValue: { type: "u8", value: SUBSCRIPTIONS_TRANSFER_RECURRING },
        operator: "equals",
      },
      {
        dataOffset: BigInt(SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET),
        dataValue: { type: "u8Slice", value: [...delegator.toBytes()] },
        operator: "equals",
      },
      {
        dataOffset: BigInt(SUBSCRIPTION_TRANSFER_MINT_OFFSET),
        dataValue: { type: "u8Slice", value: [...plan.metadata.mint.toBytes()] },
        operator: "equals",
      },
    ]);
    expect(plan.metadata).toEqual({
      policySeed: BigInt(2),
      vaultIndex,
      vault: deriveVault(settings, vaultIndex),
      delegator,
      mint: STABLECOIN_MINTS.USDC,
      subscriptionAuthority: deriveSubscriptionAuthority(
        delegator,
        STABLECOIN_MINTS.USDC
      ),
      eventAuthority: deriveSubscriptionEventAuthority(),
      delegatorUsdcAta: deriveAta(delegator, STABLECOIN_MINTS.USDC),
      vaultUsdcAta: deriveAta(deriveVault(settings, vaultIndex), STABLECOIN_MINTS.USDC),
      lockKey: `${settings.toBase58()}:${vaultIndex}`,
    });
  });

  test("explicit and SDK subscription sweep wrappers return the same plan", () => {
    const vaultIndex = 3;
    const sdk = createLoyalActionsSdk({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
    });
    const vaultPlan = createVaultSubscriptionSweepPolicyPlan({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
      policySeed: 2,
      vaultIndex,
      delegator,
      maxAmountPerPeriodRaw,
    });
    const explicitPlan = createSubscriptionSweepPolicyPlan({
      cluster: LoyalCluster.MainnetBeta,
      policySeed: 2,
      squads: {
        ...smartAccount,
        accountIndex: vaultIndex,
        vault: deriveVault(settings, vaultIndex),
      },
      delegator,
      maxAmountPerPeriodRaw,
    });
    const sdkPlan = sdk.initSubscriptionSweepPolicy({
      policySeed: 2,
      vaultIndex,
      delegator,
      maxAmountPerPeriodRaw,
    });

    expect(explicitPlan).toEqual(vaultPlan);
    expect(sdkPlan).toEqual(vaultPlan);
  });

  test("builds subscription PDA and data helper bytes", () => {
    const mint = STABLECOIN_MINTS.USDC;
    const subscriptionAuthority = deriveSubscriptionAuthority(delegator, mint);
    const delegation = deriveRecurringDelegation(
      subscriptionAuthority,
      delegator,
      vault,
      BigInt(9),
    );

    expect(subscriptionAuthority).toEqual(
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("SubscriptionAuthority"),
          delegator.toBytes(),
          mint.toBytes(),
        ],
        SUBSCRIPTIONS_PROGRAM_ID
      )[0]
    );
    expect(delegation).toEqual(
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("delegation"),
          subscriptionAuthority.toBytes(),
          delegator.toBytes(),
          vault.toBytes(),
          Uint8Array.from([9, 0, 0, 0, 0, 0, 0, 0]),
        ],
        SUBSCRIPTIONS_PROGRAM_ID
      )[0]
    );
    expect(subscriptionInitAuthorityData()).toEqual(
      Uint8Array.from([SUBSCRIPTIONS_INIT_AUTHORITY])
    );
    expect(subscriptionRevokeDelegationData()).toEqual(
      Uint8Array.from([SUBSCRIPTIONS_REVOKE_DELEGATION])
    );

    const createData = subscriptionCreateRecurringDelegationData({
      nonce: 9,
      amountPerPeriodRaw: 250_000,
      periodLengthSeconds: 3_600,
      startTimestamp: -1,
      expiryTimestamp: 86_400,
      expectedSubscriptionAuthorityInitId: -42,
    });
    expect(createData).toHaveLength(49);
    expect(createData[0]).toBe(SUBSCRIPTIONS_CREATE_RECURRING_DELEGATION);
    expect([...createData.subarray(1, 9)]).toEqual([9, 0, 0, 0, 0, 0, 0, 0]);
    expect([...createData.subarray(25, 33)]).toEqual([
      255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    expect([...createData.subarray(41, 49)]).toEqual([
      214, 255, 255, 255, 255, 255, 255, 255,
    ]);

    const transferData = subscriptionTransferRecurringData({
      amountRaw: 100_000,
      delegator,
      mint,
    });
    expect(transferData).toHaveLength(73);
    expect(transferData[0]).toBe(SUBSCRIPTIONS_TRANSFER_RECURRING);
    expect([...transferData.subarray(9, 41)]).toEqual([...delegator.toBytes()]);
    expect([...transferData.subarray(41, 73)]).toEqual([...mint.toBytes()]);
  });

  test("rejects invalid subscription inputs before instruction creation", () => {
    const sdkWithoutSmartAccount = createLoyalActionsSdk({
      cluster: LoyalCluster.MainnetBeta,
    });
    const sdk = createLoyalActionsSdk({
      cluster: LoyalCluster.MainnetBeta,
      smartAccount,
    });

    expect(() =>
      sdk.initSubscriptionSweepPolicy({
        policySeed: undefined as never,
        vaultIndex: 1,
        delegator,
        maxAmountPerPeriodRaw,
      })
    ).toThrow("policySeed is required");
    expect(() =>
      sdk.initSubscriptionSweepPolicy({
        policySeed: -1,
        vaultIndex: 1,
        delegator,
        maxAmountPerPeriodRaw,
      })
    ).toThrow("policySeed must be a u64");
    expect(() =>
      sdk.initSubscriptionSweepPolicy({
        policySeed: 2,
        vaultIndex: 256,
        delegator,
        maxAmountPerPeriodRaw,
      })
    ).toThrow("vaultIndex must be a u8");
    expect(() =>
      sdk.initSubscriptionSweepPolicy({
        policySeed: 2,
        vaultIndex: 1,
        delegator,
        maxAmountPerPeriodRaw: -1,
      })
    ).toThrow("maxAmountPerPeriodRaw must be a u64");
    expect(() =>
      sdk.initSubscriptionSweepPolicy({
        policySeed: 2,
        vaultIndex: 1,
        delegator: "bad" as never,
        maxAmountPerPeriodRaw,
      })
    ).toThrow("delegator must be a PublicKey");
    expect(() =>
      sdkWithoutSmartAccount.initSubscriptionSweepPolicy({
        policySeed: 2,
        vaultIndex: 1,
        delegator,
        maxAmountPerPeriodRaw,
      })
    ).toThrow("smartAccount config is required");
    expect(() =>
      subscriptionCreateRecurringDelegationData({
        nonce: 1,
        amountPerPeriodRaw: 1,
        periodLengthSeconds: 1,
        startTimestamp: BigInt("9223372036854775808"),
        expiryTimestamp: 0,
        expectedSubscriptionAuthorityInitId: 0,
      })
    ).toThrow("startTimestamp must be an i64");
    expect(() =>
      subscriptionTransferRecurringData({
        amountRaw: -1,
        delegator,
        mint: STABLECOIN_MINTS.USDC,
      })
    ).toThrow("amountRaw must be a u64");
    expect(() =>
      deriveRecurringDelegation(
        deriveSubscriptionAuthority(delegator, STABLECOIN_MINTS.USDC),
        delegator,
        vault,
        -1,
      )
    ).toThrow("nonce must be a u64");
  });
});
