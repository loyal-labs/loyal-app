import { Proposal } from "@loyal-labs/loyal-smart-accounts-core";
import { createAccountFetcher, createFeatureModule } from "../../feature-factory.js";
import { getRuntimeOperationsForFeature } from "../../operation-registry.js";

export const proposals = createFeatureModule({
  feature: "proposals",
  accounts: {
    Proposal,
  },
  operations: getRuntimeOperationsForFeature("proposals"),
  queries: {
    fetchProposal: createAccountFetcher(Proposal),
  },
});

export type ProposalsFeature = typeof proposals;
export const createProposalsClient: ProposalsFeature["client"] = proposals.client;
