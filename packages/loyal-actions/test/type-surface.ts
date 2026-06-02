import { PublicKey } from "@solana/web3.js";
import {
  LoyalCluster,
  RiskBasket,
  SwapLane,
  createLoyalActionsSdk,
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
  risk: RiskBasket.Safe,
  vaultIndex: 0,
});

const routingJupiterIndexes = routingPolicy.routes.jupiter.instructionConstraintIndexes;
const routingLoyalIndexes = routingPolicy.routes.loyal.instructionConstraintIndexes;
const routingVault = routingPolicy.metadata.vault;
void routingJupiterIndexes;
void routingLoyalIndexes;
void routingVault;

routingSdk.initYieldRoutingPolicy({
  risk: RiskBasket.Safe,
  vaultIndex: 0,
  // @ts-expect-error Vault-indexed policy creation always enables the default lanes.
  swapLanes: [SwapLane.Jupiter],
});

routingSdk.initYieldRoutingPolicy({
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

createVaultYieldRoutingPolicyPlan({
  cluster: LoyalCluster.MainnetBeta,
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
