export type YieldRoutingPolicyState =
  | "active"
  | "paused"
  | "failed"
  | "archived";

export type YieldRoutingPolicyKind = "kamino_rebalance";

export type YieldRoutingPolicyRecord = {
  id: string;
  accountIndex: number;
  vaultAddress: string;
  kind: YieldRoutingPolicyKind;
  state: YieldRoutingPolicyState;
  routeMint: string;
  rebalancePolicyPda: string;
  rebalancePolicySeed: string;
  delegatedSigner: string;
  allowedReserves: string[];
  allowedMarkets: string[];
  allowedLiquidityMints: string[];
  creationSignature: string | null;
  lastCrankedAt: string | null;
  nextCrankAfter: string | null;
  lastCrankSignature: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveYieldRoutingPolicyRequest = {
  accountIndex: number;
  vaultAddress: string;
  routeMint: string;
  rebalancePolicyPda: string;
  rebalancePolicySeed: string;
  delegatedSigner: string;
  allowedReserves: string[];
  allowedMarkets: string[];
  allowedLiquidityMints: string[];
  creationSignature?: string | null;
};

export type YieldRoutingPoliciesResponse = {
  policies: YieldRoutingPolicyRecord[];
};

export type SaveYieldRoutingPolicyResponse = {
  policy: YieldRoutingPolicyRecord;
};
