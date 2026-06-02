import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

export type Address = PublicKey;
export type IInstruction = TransactionInstruction;

export enum LoyalCluster {
  Devnet = "devnet",
  MainnetBeta = "mainnet-beta",
}

export enum RiskBasket {
  Safe = "safe",
  Medium = "medium",
  Aggressive = "aggressive",
}

export enum SwapLane {
  Jupiter = "jupiter",
  Loyal = "loyal",
}

export enum MaxFeeBps {
  Bps50 = 50,
  Bps75 = 75,
  Bps100 = 100,
  Bps125 = 125,
  Bps150 = 150,
}

export enum Stablecoin {
  USDC = "USDC",
  USDT = "USDT",
  PYUSD = "PYUSD",
  USDS = "USDS",
  USDG = "USDG",
  USDE = "USDE",
  SUSDE = "SUSDE",
}

export type LoyalSmartAccountConfig = {
  settings: Address;
  authority: Address;
  delegatedSigner: Address;
};

export type CreateLoyalActionsSdkConfig = {
  cluster: LoyalCluster;
  smartAccount?: LoyalSmartAccountConfig;
};

export type LoyalActionRoute2 = {
  actionAccount: Address;
  instructionConstraintIndexes: readonly [number, number];
};

export type LoyalActionRoute3 = {
  actionAccount: Address;
  instructionConstraintIndexes: readonly [number, number, number];
};

export type InitYieldRoutePolicyInput<
  Lanes extends readonly SwapLane[] = readonly SwapLane[],
> = {
  risk: RiskBasket;
  swapLanes: Lanes;
  maxFeeBps?: MaxFeeBps;
  squads: {
    settings: Address;
    authority: Address;
    delegatedSigner: Address;
    accountIndex: number;
    vault: Address;
  };
};

export type CreateYieldRoutePolicyPlanInput<
  Lanes extends readonly SwapLane[] = readonly SwapLane[],
> = InitYieldRoutePolicyInput<Lanes> & {
  cluster: LoyalCluster;
};

export type InitYieldRoutingPolicyInput = {
  risk: RiskBasket;
  vaultIndex: number;
  maxFeeBps?: MaxFeeBps;
};

export type CreateVaultYieldRoutingPolicyPlanInput = InitYieldRoutingPolicyInput & {
  cluster: LoyalCluster;
  smartAccount: LoyalSmartAccountConfig;
};

type JupiterRouteFor<Lanes extends readonly SwapLane[]> =
  Extract<Lanes[number], SwapLane.Jupiter> extends never
    ? { jupiter?: undefined }
    : { jupiter: LoyalActionRoute3 };

type LoyalRouteFor<Lanes extends readonly SwapLane[]> =
  Extract<Lanes[number], SwapLane.Loyal> extends never
    ? { loyal?: undefined }
    : { loyal: LoyalActionRoute3 };

export type InitYieldRoutePolicyResult<
  Lanes extends readonly SwapLane[] = readonly SwapLane[],
> = {
  instructions: IInstruction[];
  actionAccount: Address;
  routes: {
    sameMint: LoyalActionRoute2;
  } & JupiterRouteFor<Lanes> &
    LoyalRouteFor<Lanes>;
  spec: {
    risk: RiskBasket;
    stablecoins: Stablecoin[];
    stableMints: Address[];
    kaminoMarkets: Address[];
    kaminoLiquidityMints: Address[];
    swapLanes: SwapLane[];
    maxFeeBps: MaxFeeBps;
  };
  metadata: {
    vaultIndex: number;
    vault: Address;
    lockKey: string;
  };
  persistence: {
    riskProfile: RiskBasket;
    universePreset: string;
    routeModes: string[];
    stableMints: string[];
    kaminoMarkets: string[];
    kaminoLiquidityMints: string[];
    swapLanes: Array<{
      lane: SwapLane;
      actionAccount: string;
      instructionConstraintIndexes: readonly [number, number, number];
    }>;
    threshold: number;
  };
};

export type YieldRoutePolicyPlan<
  Lanes extends readonly SwapLane[] = readonly SwapLane[],
> = InitYieldRoutePolicyResult<Lanes>;

export type VaultYieldRoutingPolicyPlan = YieldRoutePolicyPlan<
  readonly [SwapLane.Jupiter, SwapLane.Loyal]
>;

export type InitYieldRoutingPolicyResult = InitYieldRoutePolicyResult<
  readonly [SwapLane.Jupiter, SwapLane.Loyal]
>;

export type LoyalActionsSdk = {
  createYieldRoutePolicyPlan<const Lanes extends readonly SwapLane[]>(
    input: Omit<CreateYieldRoutePolicyPlanInput<Lanes>, "cluster">,
  ): YieldRoutePolicyPlan<Lanes>;
  createVaultYieldRoutingPolicyPlan(
    input: Omit<CreateVaultYieldRoutingPolicyPlanInput, "cluster" | "smartAccount">,
  ): VaultYieldRoutingPolicyPlan;
  initYieldRoutePolicy<const Lanes extends readonly SwapLane[]>(
    input: InitYieldRoutePolicyInput<Lanes>,
  ): InitYieldRoutePolicyResult<Lanes>;
  initYieldRoutingPolicy(
    input: InitYieldRoutingPolicyInput,
  ): InitYieldRoutingPolicyResult;
};
