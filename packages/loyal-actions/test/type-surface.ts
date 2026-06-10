import { PublicKey } from "@solana/web3.js";
import {
  LoyalCluster,
  RiskBasket,
  SwapLane,
  createLoyalActionsSdk,
  createVaultSubscriptionSweepPolicyPlan,
  createVaultYieldRoutingPolicyPlan,
} from "../src/index.js";

const key = new PublicKey("11111111111111111111111111111112");
const sdk = createLoyalActionsSdk({ cluster: LoyalCluster.MainnetBeta });
const routingSdk = createLoyalActionsSdk({
  cluster: LoyalCluster.MainnetBeta,
  smartAccount: {
    settings: key,
    authority: key,
    delegatedSigner: key,
  },
});

const policy = sdk.initYieldRoutePolicy({
  policySeed: 2,
  risk: RiskBasket.Safe,
  swapLanes: [SwapLane.Jupiter] as const,
  squads: {
    settings: key,
    authority: key,
    delegatedSigner: key,
    accountIndex: 0,
    vault: key,
  },
});

const jupiterIndexes = policy.routes.jupiter.instructionConstraintIndexes;
void jupiterIndexes;

// @ts-expect-error Loyal route metadata is absent when the Loyal lane is not enabled.
const loyalIndexes = policy.routes.loyal.instructionConstraintIndexes;
void loyalIndexes;

sdk.initYieldRoutePolicy({
  policySeed: 2,
  risk: RiskBasket.Safe,
  swapLanes: [SwapLane.Jupiter] as const,
  squads: {
    settings: key,
    authority: key,
    delegatedSigner: key,
    accountIndex: 0,
    vault: key,
  },
  // @ts-expect-error Stablecoin exposure is fixed by the SDK in v1.
  stablecoins: [],
});

sdk.initYieldRoutePolicy({
  policySeed: 2,
  risk: RiskBasket.Safe,
  swapLanes: [SwapLane.Jupiter] as const,
  squads: {
    settings: key,
    authority: key,
    delegatedSigner: key,
    accountIndex: 0,
    vault: key,
  },
  // @ts-expect-error Kamino markets are derived from RiskBasket.
  kaminoMarkets: [],
});

const routingPolicy = routingSdk.initYieldRoutingPolicy({
  policySeed: 2,
  risk: RiskBasket.Safe,
  vaultIndex: 0,
});

const routingJupiterIndexes = routingPolicy.routes.jupiter.instructionConstraintIndexes;
const routingVault = routingPolicy.metadata.vault;
void routingJupiterIndexes;
void routingVault;

routingSdk.initYieldRoutingPolicy({
  policySeed: 2,
  risk: RiskBasket.Safe,
  vaultIndex: 0,
  // @ts-expect-error Vault-indexed policy creation always enables the default lanes.
  swapLanes: [SwapLane.Jupiter],
});

routingSdk.initYieldRoutingPolicy({
  policySeed: 2,
  risk: RiskBasket.Safe,
  vaultIndex: 0,
  // @ts-expect-error Squads context is configured once on SDK creation.
  squads: {
    settings: key,
    authority: key,
    delegatedSigner: key,
    accountIndex: 0,
    vault: key,
  },
});

const vaultPlan = createVaultYieldRoutingPolicyPlan({
  cluster: LoyalCluster.MainnetBeta,
  policySeed: 2,
  risk: RiskBasket.Safe,
  smartAccount: {
    settings: key,
    authority: key,
    delegatedSigner: key,
  },
  vaultIndex: 0,
});
void vaultPlan.persistence.swapLanes;

createVaultYieldRoutingPolicyPlan({
  cluster: LoyalCluster.MainnetBeta,
  policySeed: 2,
  risk: RiskBasket.Safe,
  smartAccount: {
    settings: key,
    authority: key,
    delegatedSigner: key,
  },
  vaultIndex: 0,
  // @ts-expect-error Vault-indexed policy plans always enable the default lanes.
  swapLanes: [SwapLane.Jupiter],
});

const subscriptionPolicy = routingSdk.initSubscriptionSweepPolicy({
  policySeed: 2,
  vaultIndex: 1,
  delegator: key,
  maxAmountPerPeriodRaw: 100n,
});
void subscriptionPolicy.metadata.subscriptionAuthority;

routingSdk.initSubscriptionSweepPolicy({
  vaultIndex: 1,
  delegator: key,
  maxAmountPerPeriodRaw: 100n,
  // @ts-expect-error Subscription sweep policies require a caller-owned seed.
  policySeed: undefined,
});

routingSdk.initSubscriptionSweepPolicy({
  policySeed: 2,
  vaultIndex: 1,
  delegator: key,
  maxAmountPerPeriodRaw: 100n,
  // @ts-expect-error Subscription builders do not accept yield risk inputs.
  risk: RiskBasket.Safe,
});

routingSdk.initSubscriptionSweepPolicy({
  policySeed: 2,
  vaultIndex: 1,
  delegator: key,
  maxAmountPerPeriodRaw: 100n,
  // @ts-expect-error Subscription builders do not accept yield swap lanes.
  swapLanes: [SwapLane.Jupiter],
});

createVaultSubscriptionSweepPolicyPlan({
  cluster: LoyalCluster.MainnetBeta,
  smartAccount: {
    settings: key,
    authority: key,
    delegatedSigner: key,
  },
  vaultIndex: 1,
  delegator: key,
  maxAmountPerPeriodRaw: 100n,
  // @ts-expect-error Vault subscription plans require a caller-owned seed.
  policySeed: undefined,
});

createVaultSubscriptionSweepPolicyPlan({
  cluster: LoyalCluster.MainnetBeta,
  smartAccount: {
    settings: key,
    authority: key,
    delegatedSigner: key,
  },
  policySeed: 2,
  vaultIndex: 1,
  delegator: key,
  maxAmountPerPeriodRaw: 100n,
  // @ts-expect-error Vault subscription plans derive Squads vault context internally.
  squads: {
    settings: key,
    authority: key,
    delegatedSigner: key,
    accountIndex: 1,
    vault: key,
  },
});

createVaultYieldRoutingPolicyPlan({
  cluster: LoyalCluster.MainnetBeta,
  policySeed: 2,
  risk: RiskBasket.Safe,
  smartAccount: {
    settings: key,
    authority: key,
    delegatedSigner: key,
  },
  vaultIndex: 0,
  // @ts-expect-error Vault-indexed policy plans derive Squads vault context internally.
  squads: {
    settings: key,
    authority: key,
    delegatedSigner: key,
    accountIndex: 0,
    vault: key,
  },
});
