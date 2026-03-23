import {
  Settings,
  SettingsTransaction,
} from "@loyal-labs/loyal-smart-accounts-core";
import { createAccountFetcher, createFeatureModule } from "../../feature-factory.js";
import { getRuntimeOperationsForFeature } from "../../operation-registry.js";

export const smartAccounts = createFeatureModule({
  feature: "smartAccounts",
  accounts: {
    Settings,
    SettingsTransaction,
  },
  operations: getRuntimeOperationsForFeature("smartAccounts"),
  queries: {
    fetchSettings: createAccountFetcher(Settings),
    fetchSettingsTransaction: createAccountFetcher(SettingsTransaction),
  },
});

export type SmartAccountsFeature = typeof smartAccounts;
export const createSmartAccountsClient: SmartAccountsFeature["client"] =
  smartAccounts.client;
