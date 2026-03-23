import type { Signer } from "@solana/web3.js";
import {
  createTransport,
  sendPreparedOperation,
  type LoyalSmartAccountsConfirmBehavior,
  type LoyalSmartAccountsClientConfig,
  type LoyalSmartAccountsSendOptions,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts-core";
import {
  createProgramConfigClient,
  programConfig,
} from "./features/program-config/index.js";
import {
  createSmartAccountsClient,
  smartAccounts,
} from "./features/smart-accounts/index.js";
import {
  createProposalsClient,
  proposals,
} from "./features/proposals/index.js";
import {
  createTransactionsClient,
  transactions,
} from "./features/transactions/index.js";
import { batches, createBatchesClient } from "./features/batches/index.js";
import { policies, createPoliciesClient } from "./features/policies/index.js";
import {
  createSpendingLimitsClient,
  spendingLimits,
} from "./features/spending-limits/index.js";
import {
  createExecutionClient,
  execution,
} from "./features/execution/index.js";

export type {
  LoyalSmartAccountsConfirmBehavior,
  LoyalSmartAccountsClientConfig,
  LoyalSmartAccountsSendOptions,
  PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts-core";

export type LoyalSmartAccountsClient = {
  connection: LoyalSmartAccountsClientConfig["connection"];
  programId: Exclude<LoyalSmartAccountsClientConfig["programId"], undefined>;
  send: (
    prepared: PreparedLoyalSmartAccountsOperation<string>,
    args: {
      signers: Signer[];
      sendOptions?: LoyalSmartAccountsSendOptions;
      confirm?: LoyalSmartAccountsConfirmBehavior;
    }
  ) => Promise<string>;
  programConfig: ReturnType<typeof createProgramConfigClient>;
  smartAccounts: ReturnType<typeof createSmartAccountsClient>;
  proposals: ReturnType<typeof createProposalsClient>;
  transactions: ReturnType<typeof createTransactionsClient>;
  batches: ReturnType<typeof createBatchesClient>;
  policies: ReturnType<typeof createPoliciesClient>;
  spendingLimits: ReturnType<typeof createSpendingLimitsClient>;
  execution: ReturnType<typeof createExecutionClient>;
  features: {
    programConfig: typeof programConfig;
    smartAccounts: typeof smartAccounts;
    proposals: typeof proposals;
    transactions: typeof transactions;
    batches: typeof batches;
    policies: typeof policies;
    spendingLimits: typeof spendingLimits;
    execution: typeof execution;
  };
};

export function createLoyalSmartAccountsClient(
  config: LoyalSmartAccountsClientConfig
): LoyalSmartAccountsClient {
  const transport = createTransport(config);

  return {
    connection: transport.connection,
    programId: transport.programId,
    send(
      prepared: PreparedLoyalSmartAccountsOperation<string>,
      args: {
        signers: Signer[];
        sendOptions?: LoyalSmartAccountsSendOptions;
        confirm?: LoyalSmartAccountsConfirmBehavior;
      }
    ) {
      return sendPreparedOperation({
        transport,
        prepared,
        signers: [...args.signers],
        sendOptions: args.sendOptions,
        confirm: args.confirm,
      });
    },
    programConfig: createProgramConfigClient(transport),
    smartAccounts: createSmartAccountsClient(transport),
    proposals: createProposalsClient(transport),
    transactions: createTransactionsClient(transport),
    batches: createBatchesClient(transport),
    policies: createPoliciesClient(transport),
    spendingLimits: createSpendingLimitsClient(transport),
    execution: createExecutionClient(transport),
    features: {
      programConfig,
      smartAccounts,
      proposals,
      transactions,
      batches,
      policies,
      spendingLimits,
      execution,
    },
  };
}
