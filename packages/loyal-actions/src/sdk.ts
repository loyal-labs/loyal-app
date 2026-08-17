import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_MAX_FEE_BPS,
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
  getStablecoinMintForCluster,
  getStablecoinMintsForCluster,
  getStablecoinsForCluster,
  getStablecoinTokenProgramForCluster,
} from "./constants.ts";
import { clusterConfigFor } from "./cluster.ts";
import {
  kaminoDepositConstraint,
  kaminoInitObligationConstraint,
  kaminoWithdrawConstraint,
  jupiterConstraint,
  jupiterCrossMintConstraint,
  loyalHubConstraint,
  subscriptionSweepConstraint,
  uniquePubkeys,
} from "./internal/protocols.ts";
import {
  createProgramInteractionPolicyInstruction,
  deriveActionAccount,
} from "./internal/squads.ts";
import {
  deriveSubscriptionAuthority,
  deriveSubscriptionEventAuthority,
  normalizeU64,
} from "./subscriptions.ts";
import {
  LoyalCluster,
  JupiterCrossMintSourceShard,
  MaxFeeBps,
  RiskBasket,
  Stablecoin,
  SwapLane,
} from "./types.ts";
import type {
  CreateSubscriptionSweepPolicyPlanInput,
  CreateJupiterCrossMintPolicyPlanInput,
  CreateJupiterCrossMintPolicySetInput,
  CreateVaultYieldRoutingPolicyPlanInput,
  CreateVaultSubscriptionSweepPolicyPlanInput,
  CreateYieldRoutePolicyPlanInput,
  CreateYieldRouteSetupPolicyPlanInput,
  CreateLoyalActionsSdkConfig,
  InitSubscriptionSweepPolicyInput,
  JupiterCrossMintPolicyPlan,
  JupiterCrossMintPolicySet,
  InitYieldRoutePolicyInput,
  InitYieldRoutePolicyResult,
  InitYieldRouteSetupPolicyInput,
  InitYieldRoutingPolicyInput,
  InitYieldRoutingPolicyResult,
  LoyalActionsSdk,
  LoyalActionRoute3,
  LoyalSmartAccountConfig,
  SubscriptionSweepPolicyPlan,
  VaultYieldRoutingPolicyPlan,
  YieldRouteSetupPolicyPlan,
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

const DEFAULT_YIELD_ROUTING_SWAP_LANES = [SwapLane.Jupiter] as const;

const YIELD_ROUTE_UNIVERSE_PRESET = "canonical_stable_kamino";
const YIELD_ROUTE_POLICY_THRESHOLD = 1;
const YIELD_ROUTE_SETUP_MODES = ["kamino_init_obligation"] as const;

function yieldRouteModesForSwapLanes(swapLanes: readonly SwapLane[]): string[] {
  return [
    "same_mint_kamino",
    ...swapLanes.map((lane) =>
      lane === SwapLane.Jupiter ? "jupiter" : "loyal"
    ),
  ];
}

export function createYieldRoutePolicyPlan<
  const Lanes extends readonly SwapLane[]
>(input: CreateYieldRoutePolicyPlanInput<Lanes>): YieldRoutePolicyPlan<Lanes> {
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
  const policySeed = requirePolicySeed(input.policySeed);
  const actionAccount = deriveActionAccount(
    clusterConfig,
    input.squads.settings,
    policySeed
  );
  const constraints = [
    kaminoWithdrawConstraint(
      clusterConfig,
      input.squads.vault,
      kaminoMarkets,
      kaminoLiquidityMints,
      kaminoEarnTarget.lendProgramId,
      kaminoEarnTarget.withdrawDiscriminator
    ),
    ...input.swapLanes.map((lane) =>
      lane === SwapLane.Jupiter
        ? jupiterConstraint(
            clusterConfig,
            input.squads.vault,
            stableMints,
            maxFeeBps
          )
        : loyalHubConstraint(
            clusterConfig,
            input.squads.vault,
            stableMints,
            maxFeeBps
          )
    ),
    kaminoDepositConstraint(
      clusterConfig,
      input.squads.vault,
      kaminoMarkets,
      kaminoLiquidityMints,
      kaminoEarnTarget.lendProgramId,
      kaminoEarnTarget.depositDiscriminator
    ),
  ];

  const instruction = createProgramInteractionPolicyInstruction(
    clusterConfig,
    input.squads,
    constraints,
    policySeed
  );
  const depositIndex = 1 + input.swapLanes.length;
  const routes: Record<string, unknown> = {
    sameMint: {
      actionAccount,
      instructionConstraintIndexes: [0, depositIndex] as const,
    },
  };
  const persistenceSwapLanes: YieldRoutePolicyPlan<Lanes>["persistence"]["swapLanes"] =
    [];

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
      policySeed,
      vaultIndex: input.squads.accountIndex,
      vault: input.squads.vault,
      lockKey: `${input.squads.settings.toBase58()}:${
        input.squads.accountIndex
      }`,
    },
    persistence: {
      riskProfile: input.risk,
      universePreset: YIELD_ROUTE_UNIVERSE_PRESET,
      routeModes: yieldRouteModesForSwapLanes(input.swapLanes),
      stableMints: stableMints.map((mint) => mint.toBase58()),
      kaminoMarkets: kaminoMarkets.map((market) => market.toBase58()),
      kaminoLiquidityMints: kaminoLiquidityMints.map((mint) => mint.toBase58()),
      swapLanes: persistenceSwapLanes,
      threshold: YIELD_ROUTE_POLICY_THRESHOLD,
    },
  };
}

export function createJupiterCrossMintPolicyPlan(
  input: CreateJupiterCrossMintPolicyPlanInput
): JupiterCrossMintPolicyPlan {
  validateJupiterCrossMintPolicyInput(input);
  const clusterConfig = clusterConfigFor(input.cluster);
  const policySeed = requirePolicySeed(input.policySeed);
  const dailySourceMintSpendingCap = normalizeU64(
    input.dailySourceMintSpendingCap,
    "dailySourceMintSpendingCap"
  );
  const stablecoins = getStablecoinsForCluster(input.cluster);
  if (stablecoins.length !== 6) {
    throw new Error(
      "cross-mint policies require the complete six-mint Earn registry"
    );
  }
  const destinations = stablecoins.map((stablecoin) => ({
    mint: getStablecoinMintForCluster(input.cluster, stablecoin),
    tokenProgram: getStablecoinTokenProgramForCluster(
      input.cluster,
      stablecoin
    ),
  }));
  const sourceMints = destinations
    .filter(({ tokenProgram }) =>
      input.sourceShard === JupiterCrossMintSourceShard.Classic
        ? tokenProgram.equals(clusterConfig.tokenProgramId)
        : !tokenProgram.equals(clusterConfig.tokenProgramId)
    )
    .map(({ mint }) => mint);
  if (sourceMints.length !== 3) {
    throw new Error("cross-mint source shard must contain exactly three mints");
  }

  const actionAccount = deriveActionAccount(
    clusterConfig,
    input.squads.settings,
    policySeed
  );
  const constraints = [
    jupiterCrossMintConstraint(
      clusterConfig,
      input.squads.vault,
      destinations,
      "route_v2",
      input.maxSlippageBps
    ),
    jupiterCrossMintConstraint(
      clusterConfig,
      input.squads.vault,
      destinations,
      "shared_accounts_route_v2",
      input.maxSlippageBps
    ),
  ];
  const instruction = createProgramInteractionPolicyInstruction(
    clusterConfig,
    input.squads,
    constraints,
    policySeed,
    sourceMints.map((mint) => ({
      mint,
      maxPerPeriod: dailySourceMintSpendingCap,
    }))
  );

  return {
    instructions: [instruction],
    actionAccount,
    routes: {
      routeV2: {
        actionAccount,
        instructionConstraintIndexes: [0],
      },
      sharedAccountsRouteV2: {
        actionAccount,
        instructionConstraintIndexes: [1],
      },
    },
    spec: {
      sourceShard: input.sourceShard,
      sourceMints,
      destinationMints: destinations.map(({ mint }) => mint),
      maxSlippageBps: input.maxSlippageBps,
      dailySourceMintSpendingCap,
    },
    metadata: {
      policySeed,
      vaultIndex: input.squads.accountIndex,
      vault: input.squads.vault,
      lockKey: `${input.squads.settings.toBase58()}:${
        input.squads.accountIndex
      }`,
    },
    persistence: {
      sourceShard: input.sourceShard,
      maxSlippageBps: input.maxSlippageBps,
      dailySourceMintSpendingCap: dailySourceMintSpendingCap.toString(),
    },
  };
}

export function createJupiterCrossMintPolicySet(
  input: CreateJupiterCrossMintPolicySetInput
): JupiterCrossMintPolicySet {
  const classicSeed = requirePolicySeed(input.policySeeds.classic);
  const token2022Seed = requirePolicySeed(input.policySeeds.token2022);
  if (classicSeed === token2022Seed) {
    throw new Error("cross-mint policy seeds must be distinct");
  }
  const common = {
    cluster: input.cluster,
    dailySourceMintSpendingCap: input.dailySourceMintSpendingCap,
    maxSlippageBps: input.maxSlippageBps,
    squads: input.squads,
  };
  return {
    classic: createJupiterCrossMintPolicyPlan({
      ...common,
      policySeed: classicSeed,
      sourceShard: JupiterCrossMintSourceShard.Classic,
    }),
    token2022: createJupiterCrossMintPolicyPlan({
      ...common,
      policySeed: token2022Seed,
      sourceShard: JupiterCrossMintSourceShard.Token2022,
    }),
  };
}

export function createYieldRouteSetupPolicyPlan(
  input: CreateYieldRouteSetupPolicyPlanInput
): YieldRouteSetupPolicyPlan {
  if (!Object.values(LoyalCluster).includes(input.cluster)) {
    throw new Error(`unsupported Loyal cluster: ${String(input.cluster)}`);
  }
  const clusterConfig = clusterConfigFor(input.cluster);
  validateSetupInput(input);

  const stableMints = [...getStablecoinMintsForCluster(input.cluster)];
  if (uniquePubkeys(stableMints).length !== stableMints.length) {
    throw new Error("stablecoin mint registry contains duplicates");
  }
  const kaminoMarkets = [
    ...getRiskBasketMarketsForCluster(input.cluster, input.risk),
  ];
  const kaminoEarnTarget = getKaminoUsdcEarnTargetForCluster(input.cluster);
  const kaminoLiquidityMints = [...stableMints];
  const policySeed = requirePolicySeed(input.policySeed);
  const actionAccount = deriveActionAccount(
    clusterConfig,
    input.squads.settings,
    policySeed
  );
  const constraints = [
    kaminoInitObligationConstraint(
      input.squads.vault,
      kaminoMarkets,
      kaminoEarnTarget.lendProgramId,
      kaminoEarnTarget.initObligationDiscriminator
    ),
  ];

  const instruction = createProgramInteractionPolicyInstruction(
    clusterConfig,
    input.squads,
    constraints,
    policySeed
  );

  return {
    instructions: [instruction],
    actionAccount,
    routes: {
      initObligation: {
        actionAccount,
        instructionConstraintIndexes: [0] as const,
      },
    },
    spec: {
      risk: input.risk,
      stablecoins: [...getStablecoinsForCluster(input.cluster)],
      stableMints,
      kaminoMarkets,
      kaminoLiquidityMints,
      swapLanes: [],
      maxFeeBps: DEFAULT_MAX_FEE_BPS,
    },
    metadata: {
      policySeed,
      vaultIndex: input.squads.accountIndex,
      vault: input.squads.vault,
      lockKey: `${input.squads.settings.toBase58()}:${
        input.squads.accountIndex
      }`,
    },
    persistence: {
      riskProfile: input.risk,
      universePreset: YIELD_ROUTE_UNIVERSE_PRESET,
      routeModes: [...YIELD_ROUTE_SETUP_MODES],
      stableMints: stableMints.map((mint) => mint.toBase58()),
      kaminoMarkets: kaminoMarkets.map((market) => market.toBase58()),
      kaminoLiquidityMints: kaminoLiquidityMints.map((mint) => mint.toBase58()),
      swapLanes: [],
      threshold: YIELD_ROUTE_POLICY_THRESHOLD,
    },
  };
}

export function createVaultYieldRoutingPolicyPlan(
  input: CreateVaultYieldRoutingPolicyPlanInput
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
    input.vaultIndex
  );

  return createYieldRoutePolicyPlan({
    cluster: input.cluster,
    policySeed: input.policySeed,
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

export function createSubscriptionSweepPolicyPlan(
  input: CreateSubscriptionSweepPolicyPlanInput
): SubscriptionSweepPolicyPlan {
  if (!Object.values(LoyalCluster).includes(input.cluster)) {
    throw new Error(`unsupported Loyal cluster: ${String(input.cluster)}`);
  }
  const clusterConfig = clusterConfigFor(input.cluster);
  validateSubscriptionSweepInput(input);
  const policySeed = requirePolicySeed(input.policySeed);
  const mint = getStablecoinMintForCluster(input.cluster, Stablecoin.USDC);
  const delegatorUsdcAta =
    input.delegatorUsdcAta ??
    deriveAssociatedTokenAccount(clusterConfig, input.delegator, mint);
  const vaultUsdcAta =
    input.vaultUsdcAta ??
    deriveAssociatedTokenAccount(clusterConfig, input.squads.vault, mint);
  const subscriptionAuthority = deriveSubscriptionAuthority(
    input.delegator,
    mint
  );
  const eventAuthority = deriveSubscriptionEventAuthority();
  const actionAccount = deriveActionAccount(
    clusterConfig,
    input.squads.settings,
    policySeed
  );
  const instruction = createProgramInteractionPolicyInstruction(
    clusterConfig,
    input.squads,
    [
      subscriptionSweepConstraint(
        clusterConfig,
        input.delegator,
        input.squads.vault,
        mint,
        delegatorUsdcAta,
        vaultUsdcAta,
        input.maxAmountPerPeriodRaw,
        input.minimumDelegatorBalanceRaw
      ),
    ],
    policySeed
  );

  return {
    instructions: [instruction],
    actionAccount,
    metadata: {
      policySeed,
      vaultIndex: input.squads.accountIndex,
      vault: input.squads.vault,
      delegator: input.delegator,
      mint,
      subscriptionAuthority,
      eventAuthority,
      delegatorUsdcAta,
      vaultUsdcAta,
      lockKey: `${input.squads.settings.toBase58()}:${
        input.squads.accountIndex
      }`,
    },
  };
}

export function createVaultSubscriptionSweepPolicyPlan(
  input: CreateVaultSubscriptionSweepPolicyPlanInput
): SubscriptionSweepPolicyPlan {
  if (!Object.values(LoyalCluster).includes(input.cluster)) {
    throw new Error(`unsupported Loyal cluster: ${String(input.cluster)}`);
  }
  const clusterConfig = clusterConfigFor(input.cluster);
  validateVaultSubscriptionSweepInput(input);
  const smartAccount = requireSmartAccountConfig(input.smartAccount);
  const vault = deriveSquadsVault(
    clusterConfig.squadsSmartAccountProgramId,
    smartAccount.settings,
    input.vaultIndex
  );

  return createSubscriptionSweepPolicyPlan({
    cluster: input.cluster,
    policySeed: input.policySeed,
    squads: {
      ...smartAccount,
      accountIndex: input.vaultIndex,
      vault,
    },
    delegator: input.delegator,
    maxAmountPerPeriodRaw: input.maxAmountPerPeriodRaw,
    minimumDelegatorBalanceRaw: input.minimumDelegatorBalanceRaw,
    delegatorUsdcAta: input.delegatorUsdcAta,
    vaultUsdcAta: input.vaultUsdcAta,
  });
}

export function createLoyalActionsSdk(
  config: CreateLoyalActionsSdkConfig
): LoyalActionsSdk {
  if (!Object.values(LoyalCluster).includes(config.cluster)) {
    throw new Error(`unsupported Loyal cluster: ${String(config.cluster)}`);
  }

  function createYieldRoutePolicyPlanForSdk<
    const Lanes extends readonly SwapLane[]
  >(input: InitYieldRoutePolicyInput<Lanes>): YieldRoutePolicyPlan<Lanes> {
    return createYieldRoutePolicyPlan({
      ...input,
      cluster: config.cluster,
    });
  }

  function createYieldRouteSetupPolicyPlanForSdk(
    input: InitYieldRouteSetupPolicyInput
  ): YieldRouteSetupPolicyPlan {
    return createYieldRouteSetupPolicyPlan({
      ...input,
      cluster: config.cluster,
    });
  }

  function createVaultYieldRoutingPolicyPlanForSdk(
    input: InitYieldRoutingPolicyInput
  ): VaultYieldRoutingPolicyPlan {
    return createVaultYieldRoutingPolicyPlan({
      ...input,
      cluster: config.cluster,
      smartAccount: requireSmartAccountConfig(config.smartAccount),
    });
  }

  function createSubscriptionSweepPolicyPlanForSdk(
    input: Omit<CreateSubscriptionSweepPolicyPlanInput, "cluster">
  ): SubscriptionSweepPolicyPlan {
    return createSubscriptionSweepPolicyPlan({
      ...input,
      cluster: config.cluster,
    });
  }

  function createVaultSubscriptionSweepPolicyPlanForSdk(
    input: InitSubscriptionSweepPolicyInput
  ): SubscriptionSweepPolicyPlan {
    return createVaultSubscriptionSweepPolicyPlan({
      ...input,
      cluster: config.cluster,
      smartAccount: requireSmartAccountConfig(config.smartAccount),
    });
  }

  function initYieldRoutePolicy<const Lanes extends readonly SwapLane[]>(
    input: InitYieldRoutePolicyInput<Lanes>
  ): InitYieldRoutePolicyResult<Lanes> {
    return createYieldRoutePolicyPlanForSdk(input);
  }

  return {
    createYieldRoutePolicyPlan: createYieldRoutePolicyPlanForSdk,
    createYieldRouteSetupPolicyPlan: createYieldRouteSetupPolicyPlanForSdk,
    createVaultYieldRoutingPolicyPlan: createVaultYieldRoutingPolicyPlanForSdk,
    createSubscriptionSweepPolicyPlan: createSubscriptionSweepPolicyPlanForSdk,
    createVaultSubscriptionSweepPolicyPlan:
      createVaultSubscriptionSweepPolicyPlanForSdk,
    initYieldRoutePolicy,
    initYieldRouteSetupPolicy: createYieldRouteSetupPolicyPlanForSdk,
    initYieldRoutingPolicy(
      input: InitYieldRoutingPolicyInput
    ): InitYieldRoutingPolicyResult {
      return createVaultYieldRoutingPolicyPlanForSdk(input);
    },
    initSubscriptionSweepPolicy(
      input: InitSubscriptionSweepPolicyInput
    ): SubscriptionSweepPolicyPlan {
      return createVaultSubscriptionSweepPolicyPlanForSdk(input);
    },
  };
}

function validateInput(input: InitYieldRoutePolicyInput): void {
  if (!Object.values(RiskBasket).includes(input.risk)) {
    throw new Error(`unsupported risk basket: ${String(input.risk)}`);
  }
  if (!Array.isArray(input.swapLanes)) {
    throw new Error("swap lanes must be an array");
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
  requirePolicySeed(input.policySeed);
  if (
    !Number.isInteger(input.squads.accountIndex) ||
    input.squads.accountIndex < 0 ||
    input.squads.accountIndex > 255
  ) {
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

function validateJupiterCrossMintPolicyInput(
  input: CreateJupiterCrossMintPolicyPlanInput
): void {
  if (!Object.values(LoyalCluster).includes(input.cluster)) {
    throw new Error(`unsupported Loyal cluster: ${String(input.cluster)}`);
  }
  if (!Object.values(JupiterCrossMintSourceShard).includes(input.sourceShard)) {
    throw new Error(
      `unsupported cross-mint source shard: ${String(input.sourceShard)}`
    );
  }
  if (
    !Number.isInteger(input.maxSlippageBps) ||
    input.maxSlippageBps <= 0 ||
    input.maxSlippageBps > 10_000
  ) {
    throw new Error("maxSlippageBps must be an integer between 1 and 10000");
  }
  const dailyCap = normalizeU64(
    input.dailySourceMintSpendingCap,
    "dailySourceMintSpendingCap"
  );
  if (dailyCap === BigInt(0)) {
    throw new Error("dailySourceMintSpendingCap must be positive");
  }
  requirePolicySeed(input.policySeed);
  validateVaultIndex(input.squads.accountIndex, "squads.accountIndex");
  for (const [name, value] of Object.entries(input.squads)) {
    if (name !== "accountIndex") {
      requirePublicKey(value, `squads.${name}`);
    }
  }
}

function validateSetupInput(input: InitYieldRouteSetupPolicyInput): void {
  if (!Object.values(RiskBasket).includes(input.risk)) {
    throw new Error(`unsupported risk basket: ${String(input.risk)}`);
  }
  requirePolicySeed(input.policySeed);
  validateVaultIndex(input.squads.accountIndex, "squads.accountIndex");
  for (const [name, value] of Object.entries(input.squads)) {
    if (name === "accountIndex") {
      continue;
    }
    requirePublicKey(value, `squads.${name}`);
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
  requirePolicySeed(input.policySeed);
  validateVaultIndex(input.vaultIndex, "vaultIndex");
}

function validateSubscriptionSweepInput(
  input: CreateSubscriptionSweepPolicyPlanInput
): void {
  requirePolicySeed(input.policySeed);
  validateVaultIndex(input.squads.accountIndex, "squads.accountIndex");
  requirePublicKey(input.delegator, "delegator");
  normalizeU64(input.maxAmountPerPeriodRaw, "maxAmountPerPeriodRaw");
  if (input.minimumDelegatorBalanceRaw !== undefined) {
    normalizeU64(
      input.minimumDelegatorBalanceRaw,
      "minimumDelegatorBalanceRaw"
    );
  }
  for (const [name, value] of Object.entries(input.squads)) {
    if (name === "accountIndex") {
      continue;
    }
    requirePublicKey(value, `squads.${name}`);
  }
  if (input.delegatorUsdcAta !== undefined) {
    requirePublicKey(input.delegatorUsdcAta, "delegatorUsdcAta");
  }
  if (input.vaultUsdcAta !== undefined) {
    requirePublicKey(input.vaultUsdcAta, "vaultUsdcAta");
  }
}

function validateVaultSubscriptionSweepInput(
  input: InitSubscriptionSweepPolicyInput
): void {
  requirePolicySeed(input.policySeed);
  validateVaultIndex(input.vaultIndex, "vaultIndex");
  requirePublicKey(input.delegator, "delegator");
  normalizeU64(input.maxAmountPerPeriodRaw, "maxAmountPerPeriodRaw");
  if (input.minimumDelegatorBalanceRaw !== undefined) {
    normalizeU64(
      input.minimumDelegatorBalanceRaw,
      "minimumDelegatorBalanceRaw"
    );
  }
  if (input.delegatorUsdcAta !== undefined) {
    requirePublicKey(input.delegatorUsdcAta, "delegatorUsdcAta");
  }
  if (input.vaultUsdcAta !== undefined) {
    requirePublicKey(input.vaultUsdcAta, "vaultUsdcAta");
  }
}

function validateVaultIndex(vaultIndex: number, name: string): void {
  if (!Number.isInteger(vaultIndex) || vaultIndex < 0 || vaultIndex > 255) {
    throw new Error(`${name} must be a u8`);
  }
}

function requireSmartAccountConfig(
  smartAccount: LoyalSmartAccountConfig | undefined
): LoyalSmartAccountConfig {
  if (!smartAccount) {
    throw new Error(
      "smartAccount config is required to init a vault-indexed yield routing policy"
    );
  }
  for (const [name, value] of Object.entries(smartAccount)) {
    if (!(value instanceof PublicKey)) {
      throw new Error(`smartAccount.${name} must be a PublicKey`);
    }
  }
  return smartAccount;
}

function requirePolicySeed(policySeed: unknown): bigint {
  if (policySeed === undefined || policySeed === null) {
    throw new Error("policySeed is required");
  }
  if (typeof policySeed !== "number" && typeof policySeed !== "bigint") {
    throw new Error("policySeed must be an integer");
  }
  return normalizeU64(policySeed, "policySeed");
}

function requirePublicKey(
  value: unknown,
  name: string
): asserts value is PublicKey {
  if (!(value instanceof PublicKey)) {
    throw new Error(`${name} must be a PublicKey`);
  }
}

function deriveSquadsVault(
  programId: PublicKey,
  settings: PublicKey,
  vaultIndex: number
): PublicKey {
  validateVaultIndex(vaultIndex, "vaultIndex");
  return PublicKey.findProgramAddressSync(
    [
      SQUADS_SEED_PREFIX,
      settings.toBytes(),
      SQUADS_SEED_PREFIX,
      Uint8Array.from([vaultIndex]),
    ],
    programId
  )[0];
}

function deriveAssociatedTokenAccount(
  config: ReturnType<typeof clusterConfigFor>,
  owner: PublicKey,
  mint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), config.tokenProgramId.toBytes(), mint.toBytes()],
    config.associatedTokenProgramId
  )[0];
}
