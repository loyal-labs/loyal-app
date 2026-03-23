import {
  Batch,
  BatchTransaction,
  Policy,
  SettingsTransaction,
  Transaction,
} from "@loyal-labs/loyal-smart-accounts-core";
import { createAccountFetcher, createFeatureModule } from "../../feature-factory.js";
import { getRuntimeOperationsForFeature } from "../../operation-registry.js";

export const execution = createFeatureModule({
  feature: "execution",
  accounts: {
    Batch,
    BatchTransaction,
    Policy,
    SettingsTransaction,
    Transaction,
  },
  operations: getRuntimeOperationsForFeature("execution"),
  queries: {
    fetchBatch: createAccountFetcher(Batch),
    fetchBatchTransaction: createAccountFetcher(BatchTransaction),
    fetchPolicy: createAccountFetcher(Policy),
    fetchSettingsTransaction: createAccountFetcher(SettingsTransaction),
    fetchTransaction: createAccountFetcher(Transaction),
  },
});

export type ExecutionFeature = typeof execution;
export const createExecutionClient: ExecutionFeature["client"] = execution.client;
