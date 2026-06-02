import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_MAX_FEE_BPS,
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
  getStablecoinMintsForCluster,
  getStablecoinsForCluster,
} from "./constants.ts";
import { clusterConfigFor } from "./cluster.ts";
import { kaminoDepositConstraint, kaminoWithdrawConstraint, jupiterConstraint, loyalHubConstraint, uniquePubkeys } from "./internal/protocols.ts";
import { createProgramInteractionPolicyInstruction, deriveActionAccount } from "./internal/squads.ts";
import { LoyalCluster, MaxFeeBps, RiskBasket, SwapLane } from "./types.ts";
import type {
  CreateVaultYieldRoutingPolicyPlanInput,
  CreateYieldRoutePolicyPlanInput,
  CreateLoyalActionsSdkConfig,
  InitYieldRoutePolicyInput,
  InitYieldRoutePolicyResult,
  InitYieldRoutingPolicyInput,
  InitYieldRoutingPolicyResult,
  LoyalActionsSdk,
  LoyalActionRoute3,
  LoyalSmartAccountConfig,
  VaultYieldRoutingPolicyPlan,
  YieldRoutePolicyPlan,
} from "./types.ts";

const VALID_MAX_FEE_BPS = new Set<number>([
  MaxFeeBps.Bps50,
  MaxFeeBps.Bps75,
  MaxFeeBps.Bps100,
  MaxFeeBps.Bps125,
  MaxFeeBps.Bps150,
]);

const SQUADS_SEED_PREFIX = new TextEncoder().encode("smart_account");

const DEFAULT_YIELD_ROUTING_SWAP_LANES = [
  SwapLane.Jupiter,
] as const;

const YIELD_ROUTE_UNIVERSE_PRESET = "canonical_stable_kamino";
const YIELD_ROUTE_MODES = ["same_mint_kamino", "jupiter"] as const;
const YIELD_ROUTE_POLICY_THRESHOLD = 1;

export function createYieldRoutePolicyPlan<const Lanes extends readonly SwapLane[]>(
  input: CreateYieldRoutePolicyPlanInput<Lanes>,
): YieldRoutePolicyPlan<Lanes> {
  if (!Object.values(LoyalCluster).includes(input.cluster)) {
    throw new Error(`unsupported Loyal cluster: ${String(input.cluster)}`);
  }
  const clusterConfig = clusterConfigFor(input.cluster);
  validateInput(input);

  const maxFeeBps = input.maxFeeBps ?? DEFAULT_MAX_FEE_BPS;
  const stableMints = [...getStablecoinMintsForCluster(input.cluster)];
  if (uniquePubkeys(stableMints).length !== stableMints.length) {
    throw new Error("stablecoin mint registry contains duplicates");
  }
  const kaminoMarkets = [
    ...getRiskBasketMarketsForCluster(input.cluster, input.risk),
  ];
  const kaminoEarnTarget = getKaminoUsdcEarnTargetForCluster(input.cluster);
  const kaminoLiquidityMints = [...stableMints];
  const actionAccount = deriveActionAccount(clusterConfig, input.squads.settings);
  const constraints = [
    kaminoWithdrawConstraint(
      clusterConfig,
      input.squads.vault,
      kaminoMarkets,
      kaminoLiquidityMints,
      kaminoEarnTarget.lendProgramId,
      kaminoEarnTarget.withdrawDiscriminator,
    ),
    ...input.swapLanes.map((lane) =>
      lane === SwapLane.Jupiter
        ? jupiterConstraint(clusterConfig, input.squads.vault, stableMints, maxFeeBps)
        : loyalHubConstraint(clusterConfig, input.squads.vault, stableMints, maxFeeBps),
    ),
    kaminoDepositConstraint(
      clusterConfig,
      input.squads.vault,
      kaminoMarkets,
      kaminoLiquidityMints,
      kaminoEarnTarget.lendProgramId,
      kaminoEarnTarget.depositDiscriminator,
    ),
  ];

  const instruction = createProgramInteractionPolicyInstruction(clusterConfig, input.squads, constraints);
  const depositIndex = 1 + input.swapLanes.length;
  const routes: Record<string, unknown> = {
    sameMint: {
      actionAccount,
      instructionConstraintIndexes: [0, depositIndex] as const,
    },
  };
  const persistenceSwapLanes: YieldRoutePolicyPlan<Lanes>["persistence"]["swapLanes"] = [];

  for (const [offset, lane] of input.swapLanes.entries()) {
    const route: LoyalActionRoute3 = {
      actionAccount,
      instructionConstraintIndexes: [0, offset + 1, depositIndex] as const,
    };
    persistenceSwapLanes.push({
      lane,
      actionAccount: actionAccount.toBase58(),
      instructionConstraintIndexes: route.instructionConstraintIndexes,
    });
    if (lane === SwapLane.Jupiter) {
      routes.jupiter = route;
    } else {
      routes.loyal = route;
    }
  }

  return {
    instructions: [instruction],
    actionAccount,
    routes: routes as YieldRoutePolicyPlan<Lanes>["routes"],
    spec: {
      risk: input.risk,
      stablecoins: [...getStablecoinsForCluster(input.cluster)],
      stableMints,
      kaminoMarkets,
      kaminoLiquidityMints,
      swapLanes: [...input.swapLanes],
      maxFeeBps,
    },
    metadata: {
      vaultIndex: input.squads.accountIndex,
      vault: input.squads.vault,
      lockKey: `${input.squads.settings.toBase58()}:${input.squads.accountIndex}`,
    },
    persistence: {
      riskProfile: input.risk,
      universePreset: YIELD_ROUTE_UNIVERSE_PRESET,
      routeModes: [...YIELD_ROUTE_MODES],
      stableMints: stableMints.map((mint) => mint.toBase58()),
      kaminoMarkets: kaminoMarkets.map((market) => market.toBase58()),
      kaminoLiquidityMints: kaminoLiquidityMints.map((mint) => mint.toBase58()),
      swapLanes: persistenceSwapLanes,
      threshold: YIELD_ROUTE_POLICY_THRESHOLD,
    },
  };
}

export function createVaultYieldRoutingPolicyPlan(
  input: CreateVaultYieldRoutingPolicyPlanInput,
): VaultYieldRoutingPolicyPlan {
  if (!Object.values(LoyalCluster).includes(input.cluster)) {
    throw new Error(`unsupported Loyal cluster: ${String(input.cluster)}`);
  }
  const clusterConfig = clusterConfigFor(input.cluster);
  validateYieldRoutingInput(input);
  const smartAccount = requireSmartAccountConfig(input.smartAccount);
  const vault = deriveSquadsVault(
    clusterConfig.squadsSmartAccountProgramId,
    smartAccount.settings,
    input.vaultIndex,
  );

  return createYieldRoutePolicyPlan({
    cluster: input.cluster,
    risk: input.risk,
    swapLanes: DEFAULT_YIELD_ROUTING_SWAP_LANES,
    maxFeeBps: input.maxFeeBps,
    squads: {
      ...smartAccount,
      accountIndex: input.vaultIndex,
      vault,
    },
  });
}

export function createLoyalActionsSdk(config: CreateLoyalActionsSdkConfig): LoyalActionsSdk {
  if (!Object.values(LoyalCluster).includes(config.cluster)) {
    throw new Error(`unsupported Loyal cluster: ${String(config.cluster)}`);
  }

  function createYieldRoutePolicyPlanForSdk<const Lanes extends readonly SwapLane[]>(
    input: InitYieldRoutePolicyInput<Lanes>,
  ): YieldRoutePolicyPlan<Lanes> {
    return createYieldRoutePolicyPlan({
      ...input,
      cluster: config.cluster,
    });
  }

  function createVaultYieldRoutingPolicyPlanForSdk(
    input: InitYieldRoutingPolicyInput,
  ): VaultYieldRoutingPolicyPlan {
    return createVaultYieldRoutingPolicyPlan({
      ...input,
      cluster: config.cluster,
      smartAccount: requireSmartAccountConfig(config.smartAccount),
    });
  }

  function initYieldRoutePolicy<const Lanes extends readonly SwapLane[]>(
    input: InitYieldRoutePolicyInput<Lanes>,
  ): InitYieldRoutePolicyResult<Lanes> {
    return createYieldRoutePolicyPlanForSdk(input);
  }

  return {
    createYieldRoutePolicyPlan: createYieldRoutePolicyPlanForSdk,
    createVaultYieldRoutingPolicyPlan: createVaultYieldRoutingPolicyPlanForSdk,
    initYieldRoutePolicy,
    initYieldRoutingPolicy(
      input: InitYieldRoutingPolicyInput,
    ): InitYieldRoutingPolicyResult {
      return createVaultYieldRoutingPolicyPlanForSdk(input);
    },
  };
}

function validateInput(input: InitYieldRoutePolicyInput): void {
  if (!Object.values(RiskBasket).includes(input.risk)) {
    throw new Error(`unsupported risk basket: ${String(input.risk)}`);
  }
  if (!Array.isArray(input.swapLanes) || input.swapLanes.length === 0) {
    throw new Error("at least one swap lane is required");
  }
  const seen = new Set<SwapLane>();
  for (const lane of input.swapLanes) {
    if (!Object.values(SwapLane).includes(lane)) {
      throw new Error(`unsupported swap lane: ${String(lane)}`);
    }
    if (seen.has(lane)) {
      throw new Error(`duplicate swap lane: ${lane}`);
    }
    seen.add(lane);
  }
  const maxFeeBps = input.maxFeeBps ?? DEFAULT_MAX_FEE_BPS;
  if (!VALID_MAX_FEE_BPS.has(maxFeeBps)) {
    throw new Error(`unsupported maxFeeBps: ${String(maxFeeBps)}`);
  }
  if (!Number.isInteger(input.squads.accountIndex) || input.squads.accountIndex < 0 || input.squads.accountIndex > 255) {
    throw new Error("squads.accountIndex must be a u8");
  }
  for (const [name, value] of Object.entries(input.squads)) {
    if (name === "accountIndex") {
      continue;
    }
    if (!(value instanceof PublicKey)) {
      throw new Error(`squads.${name} must be a PublicKey`);
    }
  }
}

function validateYieldRoutingInput(input: InitYieldRoutingPolicyInput): void {
  if (!Object.values(RiskBasket).includes(input.risk)) {
    throw new Error(`unsupported risk basket: ${String(input.risk)}`);
  }
  const maxFeeBps = input.maxFeeBps ?? DEFAULT_MAX_FEE_BPS;
  if (!VALID_MAX_FEE_BPS.has(maxFeeBps)) {
    throw new Error(`unsupported maxFeeBps: ${String(maxFeeBps)}`);
  }
  validateVaultIndex(input.vaultIndex, "vaultIndex");
}

function validateVaultIndex(vaultIndex: number, name: string): void {
  if (!Number.isInteger(vaultIndex) || vaultIndex < 0 || vaultIndex > 255) {
    throw new Error(`${name} must be a u8`);
  }
}

function requireSmartAccountConfig(
  smartAccount: LoyalSmartAccountConfig | undefined,
): LoyalSmartAccountConfig {
  if (!smartAccount) {
    throw new Error(
      "smartAccount config is required to init a vault-indexed yield routing policy",
    );
  }
  for (const [name, value] of Object.entries(smartAccount)) {
    if (!(value instanceof PublicKey)) {
      throw new Error(`smartAccount.${name} must be a PublicKey`);
    }
  }
  return smartAccount;
}

function deriveSquadsVault(
  programId: PublicKey,
  settings: PublicKey,
  vaultIndex: number,
): PublicKey {
  validateVaultIndex(vaultIndex, "vaultIndex");
  return PublicKey.findProgramAddressSync(
    [
      SQUADS_SEED_PREFIX,
      settings.toBytes(),
      SQUADS_SEED_PREFIX,
      Uint8Array.from([vaultIndex]),
    ],
    programId,
  )[0];
}
