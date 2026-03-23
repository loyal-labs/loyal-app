import { Policy } from "@loyal-labs/loyal-smart-accounts-core";
import { createAccountFetcher, createFeatureModule } from "../../feature-factory.js";
import { getRuntimeOperationsForFeature } from "../../operation-registry.js";

export const policies = createFeatureModule({
  feature: "policies",
  accounts: {
    Policy,
  },
  operations: getRuntimeOperationsForFeature("policies"),
  queries: {
    fetchPolicy: createAccountFetcher(Policy),
  },
});

export type PoliciesFeature = typeof policies;
export const createPoliciesClient: PoliciesFeature["client"] = policies.client;
