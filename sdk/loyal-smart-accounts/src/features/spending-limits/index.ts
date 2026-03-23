import { SpendingLimit } from "@loyal-labs/loyal-smart-accounts-core";
import { createAccountFetcher, createFeatureModule } from "../../feature-factory.js";
import { getRuntimeOperationsForFeature } from "../../operation-registry.js";

export const spendingLimits = createFeatureModule({
  feature: "spendingLimits",
  accounts: {
    SpendingLimit,
  },
  operations: getRuntimeOperationsForFeature("spendingLimits"),
  queries: {
    fetchSpendingLimit: createAccountFetcher(SpendingLimit),
  },
});

export type SpendingLimitsFeature = typeof spendingLimits;
export const createSpendingLimitsClient: SpendingLimitsFeature["client"] =
  spendingLimits.client;
