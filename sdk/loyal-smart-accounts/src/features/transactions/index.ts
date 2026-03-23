import {
  LegacyTransaction,
  Transaction,
  TransactionBuffer,
} from "@loyal-labs/loyal-smart-accounts-core";
import { createAccountFetcher, createFeatureModule } from "../../feature-factory.js";
import { getRuntimeOperationsForFeature } from "../../operation-registry.js";

export const transactions = createFeatureModule({
  feature: "transactions",
  accounts: {
    LegacyTransaction,
    Transaction,
    TransactionBuffer,
  },
  operations: getRuntimeOperationsForFeature("transactions"),
  queries: {
    fetchLegacyTransaction: createAccountFetcher(LegacyTransaction),
    fetchTransaction: createAccountFetcher(Transaction),
    fetchTransactionBuffer: createAccountFetcher(TransactionBuffer),
  },
});

export type TransactionsFeature = typeof transactions;
export const createTransactionsClient: TransactionsFeature["client"] =
  transactions.client;
