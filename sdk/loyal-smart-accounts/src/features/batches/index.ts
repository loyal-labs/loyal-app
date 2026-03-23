import { Batch, BatchTransaction } from "@loyal-labs/loyal-smart-accounts-core";
import { createAccountFetcher, createFeatureModule } from "../../feature-factory.js";
import { getRuntimeOperationsForFeature } from "../../operation-registry.js";

export const batches = createFeatureModule({
  feature: "batches",
  accounts: {
    Batch,
    BatchTransaction,
  },
  operations: getRuntimeOperationsForFeature("batches"),
  queries: {
    fetchBatch: createAccountFetcher(Batch),
    fetchBatchTransaction: createAccountFetcher(BatchTransaction),
  },
});

export type BatchesFeature = typeof batches;
export const createBatchesClient: BatchesFeature["client"] = batches.client;
