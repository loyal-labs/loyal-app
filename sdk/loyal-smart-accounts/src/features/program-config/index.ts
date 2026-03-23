import { ProgramConfig } from "@loyal-labs/loyal-smart-accounts-core";
import { createAccountFetcher, createFeatureModule } from "../../feature-factory.js";
import { getRuntimeOperationsForFeature } from "../../operation-registry.js";

export const programConfig = createFeatureModule({
  feature: "programConfig",
  accounts: {
    ProgramConfig,
  },
  operations: getRuntimeOperationsForFeature("programConfig"),
  queries: {
    fetchProgramConfig: createAccountFetcher(ProgramConfig),
  },
});

export type ProgramConfigFeature = typeof programConfig;
export const createProgramConfigClient: ProgramConfigFeature["client"] =
  programConfig.client;
