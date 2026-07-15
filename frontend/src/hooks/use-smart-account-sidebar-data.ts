"use client";

import {
  LoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import {
  combineSmartAccountNativeSolRequirements,
  createSmartAccountVaultsClient,
  sendPreparedBatchWithWallet,
  sendPreparedWithWallet,
  SOL_SPENDING_LIMIT_MINT,
  type SmartAccountNativeSolRequirement,
  type SmartAccountOverview,
  type SmartAccountOverviewBase,
  type SmartAccountPreparedEarnUsdcAutodepositClose,
  type SmartAccountPreparedEarnUsdcAutodepositSetup,
  type SmartAccountPreparedEarnUsdcCleanup,
  type SmartAccountPreparedEarnUsdcDeposit,
  type SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
  type SmartAccountPreparedEarnUsdcWithdraw,
  type SmartAccountPolicyOverview,
  type SmartAccountProposalSnapshot,
  type SmartAccountSignerPermission,
  type SmartAccountSignerSnapshot,
  type SmartAccountSpendingLimitSnapshot,
  type SmartAccountVaultSnapshot,
} from "@loyal-labs/smart-account-vaults";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";
import {
  type ActivityPage,
  NATIVE_SOL_MINT,
  type PortfolioPosition,
  type PortfolioSnapshot,
  type WalletActivity,
} from "@loyal-labs/solana-wallet";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type {
  AddressLookupTableAccount,
  Connection,
  SendOptions,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
} from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActivityRow,
  TokenRow,
  TransactionDetail,
} from "@/components/wallet-sidebar/types";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  resolveSmartAccountRefreshError,
  resolveSmartAccountMutationRefreshPlan,
  SmartAccountPolicyFollowUp,
  SmartAccountRefreshOrder,
  SmartAccountRefreshSingleflight,
  SmartAccountScopeGeneration,
  type SmartAccountRefreshGroup,
  type SmartAccountRefreshOrderGroup,
  type SmartAccountRefreshOrderToken,
  type SmartAccountRefreshPlan,
  type SmartAccountScopedErrors,
} from "@/features/smart-accounts/refresh-plan";
import {
  getClientCacheStorage,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import { fetchTokenMarkets } from "@/lib/market/token-markets.client";
import { getTokenIconUrl } from "@/lib/token-icon";
import {
  getStablecoinMintSetForSolanaEnv,
  isStablecoinMint,
} from "@/lib/wallet/stablecoin-classification";
import {
  buildEarnDepositConfirmRequestBody,
  buildEarnDepositPolicyStageConfirmRequestBody,
  buildEarnPolicyConfirmRequestBody,
  buildEarnWithdrawalConfirmRequestBody,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  isReusedEarnDepositPolicy,
  resolveEarnDepositConfirmPolicySignature,
} from "@/lib/yield-optimization/earn-deposit-flow.shared";
import {
  buildEarnAutodepositCloseConfirmRequestBody,
  buildEarnAutodepositSetupConfirmRequestBody,
  type EarnAutodepositFloorUpdateConfirmRequestBody,
  type EarnAutodepositToggleConfirmRequestBody,
  type EarnAutodepositCloseConfirmResponse,
  type EarnAutodepositSetupConfirmResponse,
  type EarnAutodepositToggleConfirmResponse,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import type { LoadedEarnAutodepositScheduledSweep } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import {
  hydratePreparedEarnUsdcDeposit,
  type EarnDepositPrepareResponse,
} from "@/lib/yield-optimization/earn-deposit-prepare-contracts.shared";
import {
  hydratePreparedEarnUsdcCleanup,
  serializePreparedEarnUsdcCleanup,
  type EarnWithdrawCleanupPrepareResponse,
} from "@/lib/yield-optimization/earn-withdraw-cleanup-contracts.shared";
import {
  hydratePreparedEarnUsdcYieldRoutingPolicy,
  type EarnPolicyPrepareResponse,
} from "@/lib/yield-optimization/earn-policy-prepare-contracts.shared";

import { useSolanaWalletDataClient } from "./use-solana-wallet-data-client";
import { createTokenMarketMintsSignature } from "./use-wallet-desktop-data";

type SmartAccountTimedRouteResponse<T> = {
  data: T;
  meta: {
    fetchedAt: number;
    timingsMs: Record<string, number>;
  };
};

type SmartAccountVaultActivityRouteResponse = {
  accountIndex: number;
  activity: ActivityPage;
};

type SmartAccountRouteErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

type EarnStateResponse = {
  autodeposit: {
    active: boolean;
    amountPerPeriodRaw: string;
    balanceSweepPolicyId: string;
    delegatedSigner: string | null;
    depositedThisPeriodRaw?: string | null;
    lastSeenSignature: string;
    lastSeenSlot: string;
    periodLengthSeconds: string | null;
    policyAccount: string;
    policySeed: string;
    recurringDelegation: string | null;
    scheduledSweeps: {
      classification: string;
      confidence: string;
      eligibleAfter: string;
      executeNowAvailableAt?: string | null;
      id: string;
      originalAmountRaw: string;
      reason: string;
      remainingAmountRaw: string;
      status: string;
    }[];
    startTimestamp: string | null;
    status: "active" | "paused" | "pending";
    subscriptionAuthority: string | null;
    subscriptionDelegatee: string | null;
    vaultUsdcAta: string;
    walletBalanceFloorRaw: string | null;
    walletUsdcAta: string;
  } | null;
  canonicalVaultPubkey: string;
  loadErrors: {
    autodeposit?: true;
    onboarding?: true;
    policy?: true;
    position?: true;
  };
  onboarding: {
    depositConfirmedSlot?: string | null;
    depositSignature?: string | null;
    lastErrorCode?: string | null;
    nextStep:
      | "route_policy"
      | "setup_policy"
      | "deposit"
      | "deposit_accounting_retry"
      | "complete";
    policy?: {
      account: string;
      id: string;
      lastSeenSignature: string | null;
      lastSeenSlot: string | null;
      seed: string;
    };
    setupPolicy?: {
      account: string;
      id: string;
      lastSeenSignature: string | null;
      lastSeenSlot: string | null;
      seed: string;
    } | null;
    status?: string;
    updatedAt?: string;
  };
  policy: {
    account: string;
    delegatedSigners: string[];
    id: string;
    kaminoLiquidityMints: string[];
    kaminoMarkets: string[];
    lastSeenSignature: string;
    lastSeenSlot: string;
    riskProfile: string | null;
    routeModes: string[];
    seed: string;
    setupPolicy: {
      account: string;
      delegatedSigners: string[];
      id: string;
      lastSeenSignature: string;
      lastSeenSlot: string;
      seed: string;
    } | null;
    stableMints: string[];
    universePreset: string | null;
    vaultIndex: number;
    vaultPubkey: string;
  } | null;
  policySignerPublicKey: string;
  position: {
    currentTotalAmountRaw: string;
    principalAmountRaw: string;
    status: string;
  } | null;
  settingsPda: string;
  vault: {
    accountIndex: 1;
    pubkey: string;
  };
};

type SmartAccountOverviewCacheGroup<T> = {
  savedAt: number;
  data: T;
};

export type CurrentBestApyReserveByStablecoinSnapshot = {
  borrowApy: number;
  liquidityMint: string;
  market: string | null;
  marketName: string | null;
  observedAt: string;
  reserve: string;
  slot: number;
  stablecoin: string;
  supplyApy: number;
  symbol: string | null;
  totalBorrowUsdEstimate: number;
  totalSupplyUsdEstimate: number;
  utilization: number;
};

export type CurrentBestApyReserveByStablecoinCache = {
  riskProfile: string;
  reserves: CurrentBestApyReserveByStablecoinSnapshot[];
};

type SmartAccountOverviewCachePayload = {
  version: 1;
  settingsPda: string;
  solanaEnv: string;
  savedAt: number;
  groups: {
    base?: SmartAccountOverviewCacheGroup<SmartAccountOverviewBase>;
    vaults?: SmartAccountOverviewCacheGroup<SmartAccountVaultSnapshot[]>;
    policies?: SmartAccountOverviewCacheGroup<SmartAccountPolicyOverview>;
    proposals?: SmartAccountOverviewCacheGroup<SmartAccountProposalSnapshot[]>;
    bestApyReserves?: SmartAccountOverviewCacheGroup<CurrentBestApyReserveByStablecoinCache>;
  };
};

type SmartAccountOverviewCacheGroupName =
  keyof SmartAccountOverviewCachePayload["groups"];

type SmartAccountOverviewCacheGroupData = {
  base: SmartAccountOverviewBase;
  vaults: SmartAccountVaultSnapshot[];
  policies: SmartAccountPolicyOverview;
  proposals: SmartAccountProposalSnapshot[];
  bestApyReserves: CurrentBestApyReserveByStablecoinCache;
};

function isSmartAccountOverviewCacheGroupFresh(
  group: SmartAccountOverviewCacheGroup<unknown> | undefined,
  ttlMs: number,
  now = Date.now()
) {
  return Boolean(group && now - group.savedAt < ttlMs);
}

export type SmartAccountApprovalItem = {
  id: string;
  title: string;
  destinationLabel: string;
  amount: string;
  symbol: string;
  sourceAccountIndex: number | null;
  sourceLabel: string;
  status: SmartAccountProposalSnapshot["status"];
  canExecute: boolean;
  proposal: SmartAccountProposalSnapshot;
};

export type SmartAccountVaultEntry = {
  accountIndex: number;
  label: string;
  address: string;
  totalUsd: number;
  balanceWhole: string;
  balanceFraction: string;
  signers: SmartAccountSignerEntry[];
};

export type SmartAccountSignerEntry = {
  id: string;
  label: string;
  address: string;
  shortAddress: string;
  icon: string;
  totalUsd: number;
  balanceWhole: string;
  balanceFraction: string;
  accessLevel: "suggest" | "sign" | "execute";
  accessLabel: string;
  scope: SmartAccountSignerSnapshot["scope"];
  scopeLabel: string;
  permissions: SmartAccountSignerSnapshot["permissions"];
  canInitiate: boolean;
  canVote: boolean;
  canExecute: boolean;
  policyAddress: string | null;
  spendingLimit: SmartAccountSpendingLimitSnapshot | null;
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
};

export type SmartAccountVaultView = {
  entry: SmartAccountVaultEntry;
  positions: PortfolioPosition[];
  tokenRows: TokenRow[];
  cashTokenRows: TokenRow[];
  investmentTokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
};

type SmartAccountVaultActivityView = Pick<
  SmartAccountVaultView,
  "activityRows" | "transactionDetails"
>;

export type SmartAccountSignerPortfolioView = {
  tokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  isLoading: boolean;
  hasLoadedActivity: boolean;
  error: string | null;
};

const EMPTY_SIGNER_PORTFOLIO_VIEW: SmartAccountSignerPortfolioView = {
  tokenRows: [],
  activityRows: [],
  transactionDetails: {},
  isLoading: false,
  hasLoadedActivity: false,
  error: null,
};
const EMPTY_STABLECOIN_MINTS = new Set<string>();

export type VaultTransferRequest = {
  accountIndex: number;
  mint: string;
  symbol: string;
  /** Human-readable token amount, e.g. 1.5 SOL or 100 USDC. */
  amount: number;
  /** Base58 wallet address of recipient. */
  recipientAddress: string;
};

export type VaultTransferResult = {
  success: boolean;
  signature?: string;
  error?: string;
  /**
   * "executed" — funds actually moved on chain (threshold-1 or spending-limit path).
   * "proposed" — proposal was queued; funds move once threshold is reached.
   */
  status?: "executed" | "proposed";
};

export type VaultSwapRequest = {
  accountIndex: number;
  transaction: VersionedTransaction;
};

export type VaultSwapResult = VaultTransferResult;

export type EarnDepositRequest = {
  amountRaw: bigint;
  policyConfirmedSlot?: string;
  policySignature?: string;
  recordConfirmationAsync?: boolean;
  setupPolicyConfirmedSlot?: string;
  setupPolicySignature?: string;
  preparedDeposit?: SmartAccountPreparedEarnUsdcDeposit;
};

export type EarnPolicySetupResult = {
  success: boolean;
  signature?: string;
  confirmedSlot?: string;
  status?: "executed";
  policy?: NonNullable<EarnStateResponse["policy"]>;
  error?: string;
};

export type EarnDepositResult = {
  success: boolean;
  signature?: string;
  confirmedSlot?: string;
  status?: "executed" | "confirmation_record_failed";
  error?: string;
};

export type EarnDepositBatchRequest = EarnDepositRequest & {
  startStage: "policy" | "policy-finalize";
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
};

export type EarnDepositBatchResult = EarnDepositResult & {
  batchUnavailable?: boolean;
  policyConfirmedSlot?: string;
  policySignature?: string;
  resumeStage?: "policy-finalize" | "deposit";
  setupPolicyConfirmedSlot?: string;
  setupPolicySignature?: string;
};

export type EarnDepositPolicyStageRequest = {
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
  stage: "policy" | "policy-finalize";
};

export type EarnDepositPolicyStageResult = {
  success: boolean;
  signature?: string;
  confirmedSlot?: string;
  status?: "executed";
  error?: string;
};

export type EarnWithdrawRequest = {
  amountRaw: bigint;
  autodepositCloseAlreadyCompleted?: boolean;
  mode: "partial" | "full";
  onConfirmationRecorded?: () => Promise<void> | void;
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw;
  recordConfirmationAsync?: boolean;
  stepIndex?: number;
};

export type EarnWithdrawResult = {
  success: boolean;
  signature?: string;
  confirmedSlot?: string;
  status?: "executed" | "confirmation_record_failed";
  mode?: "partial" | "full";
  amountRaw?: string;
  error?: string;
};

export type PreparedEarnUsdcCleanup = SmartAccountPreparedEarnUsdcCleanup & {
  estimatedRefundLamports: number | null;
};

export type EarnCleanupRequest = {
  preparedCleanup?: PreparedEarnUsdcCleanup;
};

export type EarnCleanupResult = {
  success: boolean;
  signature?: string;
  confirmedSlot?: string;
  status?: "executed" | "confirmation_record_failed";
  idleTransferAmountRaw?: string;
  error?: string;
};

export type EarnAutodepositSetupRequest = {
  amountRaw: bigint;
  expiryTimestamp?: bigint;
  nonce: bigint;
  periodLengthSeconds?: bigint;
  policySeed?: bigint;
  startTimestamp?: bigint;
  walletBalanceFloorRaw: bigint;
  preparedSetup?: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
};

export type EarnAutodepositSetupResult = {
  success: boolean;
  signature?: string;
  targetId?: string;
  authorityInitializationSignature?: string;
  policySignature?: string;
  recurringDelegationSignature?: string;
  confirmedSlot?: string;
  status?: "confirmation_record_failed" | "executed";
  preparedSetup?: SmartAccountPreparedEarnUsdcAutodepositSetup;
  nextPreparedSetup?: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
  bootstrapSweep?: EarnAutodepositSetupConfirmResponse["bootstrapSweep"];
  scheduledSweeps?: LoadedEarnAutodepositScheduledSweep[];
  error?: string;
};

type EarnAutodepositSetupBatchPrepare = {
  nextPreparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
};

type EarnAutodepositPrepareContextKeyInput = {
  cluster: LoyalCluster;
  feePayer: PublicKey;
  policySigner: PublicKey;
  settingsPda: PublicKey;
  signer: PublicKey;
  walletAddress: PublicKey;
};

type EarnAutodepositSetupPrepareKeyRequest = Omit<
  EarnAutodepositSetupRequest,
  "preparedSetup"
> & {
  refreshImmediateStartTimestamp?: boolean;
};

function formatPrepareKeyBigInt(value: bigint | null | undefined): string {
  return value === null || value === undefined ? "" : value.toString();
}

function createEarnAutodepositPrepareKey(args: {
  context: EarnAutodepositPrepareContextKeyInput;
  kind: "batch" | "setup";
  preparedSetup?: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
  request: EarnAutodepositSetupPrepareKeyRequest;
}): string {
  const preparedSetup = args.preparedSetup;

  return JSON.stringify({
    amountRaw: args.request.amountRaw.toString(),
    cluster: args.context.cluster,
    expiryTimestamp: formatPrepareKeyBigInt(args.request.expiryTimestamp),
    feePayer: args.context.feePayer.toBase58(),
    kind: args.kind,
    nonce: args.request.nonce.toString(),
    periodLengthSeconds: formatPrepareKeyBigInt(
      args.request.periodLengthSeconds
    ),
    policySeed: formatPrepareKeyBigInt(args.request.policySeed),
    policySigner: args.context.policySigner.toBase58(),
    preparedPolicyAccount: preparedSetup?.persistence.policyAccount ?? null,
    preparedPolicySeed: preparedSetup?.persistence.policySeed ?? null,
    preparedStage: preparedSetup?.stage ?? null,
    preparedSubscriptionNonce:
      preparedSetup?.subscription.nonce.toString() ?? null,
    refreshImmediateStartTimestamp: Boolean(
      args.request.refreshImmediateStartTimestamp
    ),
    settingsPda: args.context.settingsPda.toBase58(),
    signer: args.context.signer.toBase58(),
    startTimestamp: formatPrepareKeyBigInt(args.request.startTimestamp),
    walletAddress: args.context.walletAddress.toBase58(),
    walletBalanceFloorRaw: args.request.walletBalanceFloorRaw.toString(),
  });
}

export type EarnAutodepositCloseRequest = {
  policy: string;
  recurringDelegation: string;
  preparedClose?: SmartAccountPreparedEarnUsdcAutodepositClose | null;
};

export type EarnAutodepositCloseResult = {
  success: boolean;
  signature?: string;
  targetId?: string;
  confirmedSlot?: string;
  status?: "confirmation_record_failed" | "executed";
  error?: string;
};

export type EarnAutodepositFloorUpdateRequest = {
  policyAccount: string;
  recurringDelegation: string;
  walletBalanceFloorRaw: bigint;
};

export type EarnAutodepositFloorUpdateResult = {
  success: boolean;
  rebaselineSweep?: EarnAutodepositSetupConfirmResponse["rebaselineSweep"];
  scheduledSweeps?: LoadedEarnAutodepositScheduledSweep[];
  target?: EarnAutodepositSetupConfirmResponse["target"];
  error?: string;
};

export type EarnAutodepositToggleRequest = {
  active: boolean;
  policyAccount: string;
  recurringDelegation: string;
};

export type EarnAutodepositToggleResult = {
  success: boolean;
  scheduledSweeps?: LoadedEarnAutodepositScheduledSweep[];
  target?: EarnAutodepositSetupConfirmResponse["target"];
  error?: string;
};

type PreparedEarnOperation =
  | "autodeposit close"
  | "autodeposit setup"
  | "earn cleanup"
  | "deposit"
  | "policy finalize"
  | "policy setup"
  | "setup policy setup"
  | "withdrawal";

type EarnClusterPreflightResult =
  | { success: true; signature: string }
  | { success: false; error: string };

function readErrorField(error: unknown, field: string): unknown {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

function stringifyErrorDetail(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getDetailedWalletErrorMessage(error: unknown, fallback: string) {
  const baseMessage = error instanceof Error ? error.message : fallback;
  const nested =
    stringifyErrorDetail(readErrorField(error, "error")) ??
    stringifyErrorDetail(readErrorField(error, "cause")) ??
    stringifyErrorDetail(readErrorField(error, "logs"));

  if (!nested || nested === baseMessage) {
    return baseMessage;
  }

  return `${baseMessage}: ${nested}`;
}

export function validatePreparedEarnPersistenceCluster({
  expectedCluster,
  operation,
  preparedCluster,
}: {
  expectedCluster: LoyalCluster;
  operation: PreparedEarnOperation;
  preparedCluster: string;
}): string | null {
  if (preparedCluster === expectedCluster) {
    return null;
  }

  return `Internal Earn configuration error: prepared ${operation} cluster ${preparedCluster} does not match configured cluster ${expectedCluster}.`;
}

export async function sendPreparedEarnWithClusterPreflight({
  expectedCluster,
  operation,
  preparedCluster,
  send,
}: {
  expectedCluster: LoyalCluster;
  operation: PreparedEarnOperation;
  preparedCluster: string;
  send: () => Promise<string>;
}): Promise<EarnClusterPreflightResult> {
  const error = validatePreparedEarnPersistenceCluster({
    expectedCluster,
    operation,
    preparedCluster,
  });
  if (error) {
    return { success: false, error };
  }

  return { success: true, signature: await send() };
}

function getEarnAutodepositSetupSignatureFields(
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup,
  signature: string
):
  | { authorityInitializationSignature: string }
  | { policySignature: string }
  | { recurringDelegationSignature: string } {
  if (preparedSetup.stage === "initialize_subscription_authority") {
    return { authorityInitializationSignature: signature };
  }
  if (preparedSetup.stage === "create_policy") {
    return { policySignature: signature };
  }
  return { recurringDelegationSignature: signature };
}

function isMatchingEarnAutodepositSetupBatch(args: {
  amountRaw: bigint;
  nextPreparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
}): args is {
  amountRaw: bigint;
  nextPreparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup & {
    stage: "create_recurring_delegation";
  };
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup & {
    stage: "create_policy";
  };
} {
  const { nextPreparedSetup, preparedSetup } = args;
  if (
    preparedSetup.stage !== "create_policy" ||
    nextPreparedSetup?.stage !== "create_recurring_delegation"
  ) {
    return false;
  }

  return (
    preparedSetup.persistence.amountPerPeriodRaw ===
      args.amountRaw.toString() &&
    nextPreparedSetup.persistence.amountPerPeriodRaw ===
      args.amountRaw.toString() &&
    nextPreparedSetup.persistence.cluster ===
      preparedSetup.persistence.cluster &&
    nextPreparedSetup.persistence.policyAccount ===
      preparedSetup.persistence.policyAccount &&
    nextPreparedSetup.persistence.policySeed ===
      preparedSetup.persistence.policySeed &&
    nextPreparedSetup.persistence.recurringDelegation ===
      preparedSetup.persistence.recurringDelegation &&
    nextPreparedSetup.persistence.expiryTimestamp ===
      preparedSetup.persistence.expiryTimestamp &&
    nextPreparedSetup.persistence.periodLengthSeconds ===
      preparedSetup.persistence.periodLengthSeconds &&
    nextPreparedSetup.persistence.settings ===
      preparedSetup.persistence.settings &&
    BigInt(nextPreparedSetup.persistence.startTimestamp) >=
      BigInt(preparedSetup.persistence.startTimestamp) &&
    nextPreparedSetup.persistence.vaultPubkey ===
      preparedSetup.persistence.vaultPubkey &&
    nextPreparedSetup.persistence.walletAddress ===
      preparedSetup.persistence.walletAddress &&
    nextPreparedSetup.persistence.walletUsdcAta ===
      preparedSetup.persistence.walletUsdcAta &&
    nextPreparedSetup.policy.account?.toBase58() ===
      preparedSetup.policy.account?.toBase58() &&
    nextPreparedSetup.policy.seed === preparedSetup.policy.seed &&
    nextPreparedSetup.subscription.nonce === preparedSetup.subscription.nonce &&
    nextPreparedSetup.subscription.recurringDelegation.toBase58() ===
      preparedSetup.subscription.recurringDelegation.toBase58() &&
    nextPreparedSetup.subscription.expiryTimestamp ===
      preparedSetup.subscription.expiryTimestamp &&
    nextPreparedSetup.subscription.periodLengthSeconds ===
      preparedSetup.subscription.periodLengthSeconds &&
    nextPreparedSetup.subscription.startTimestamp >=
      preparedSetup.subscription.startTimestamp &&
    nextPreparedSetup.vault.pubkey.toBase58() ===
      preparedSetup.vault.pubkey.toBase58()
  );
}

function getRequestedEarnAutodepositStartTimestamp(args: {
  expiryTimestamp?: bigint;
  startTimestamp?: bigint;
}): bigint | undefined {
  if (args.startTimestamp === undefined) {
    return undefined;
  }

  if (
    args.startTimestamp === BigInt(0) &&
    args.expiryTimestamp !== undefined &&
    args.expiryTimestamp > BigInt(0)
  ) {
    return args.startTimestamp;
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  return args.startTimestamp > nowSeconds ? args.startTimestamp : undefined;
}

export type VaultTransferCapability =
  | { kind: "blocked"; reason: string }
  | {
      kind: "settings";
      threshold: number;
      /** Number of wallet signs the user will need to perform. */
      expectedSigns: number;
    }
  | {
      kind: "spending-limit";
      spendingLimitAddress: string;
      /** SOL only for now — SDK lacks an SPL spending-limit helper. */
      mint: string;
    };

export type SmartAccountRefreshGroupsRequest = {
  groups: readonly SmartAccountRefreshGroup[];
  accountIndexes?: readonly number[];
  forceRefreshGroups?: readonly SmartAccountRefreshGroup[];
  signerAddresses?: readonly string[];
  refreshAuthenticatedWallet?: boolean;
};

export type SmartAccountRefreshCommitContext = {
  isCurrent: () => boolean;
};

type SmartAccountDetailLoadOptions = {
  forceRefresh?: boolean;
  isCurrent?: () => boolean;
};

export type SmartAccountSidebarData = {
  overview: SmartAccountOverview | null;
  earnAutodeposit: EarnStateResponse["autodeposit"];
  earnOnboarding: EarnStateResponse["onboarding"] | null;
  earnPolicy: EarnStateResponse["policy"];
  earnPolicySignerPublicKey: string | null;
  earnVaultPubkey: string | null;
  earnStateLoadErrors: EarnStateResponse["loadErrors"];
  hasEarnStateResolved: boolean;
  isLoading: boolean;
  isEarnStateLoading: boolean;
  isBaseLoading: boolean;
  isVaultsLoading: boolean;
  isPoliciesLoading: boolean;
  isProposalsLoading: boolean;
  isBestApyReservesLoading: boolean;
  bestApyReservesByStablecoin: CurrentBestApyReserveByStablecoinCache | null;
  scopedErrors: {
    base: string | null;
    vaults: string | null;
    policies: string | null;
    proposals: string | null;
    bestApyReserves: string | null;
  };
  error: string | null;
  totalUsd: number;
  vaultEntries: SmartAccountVaultEntry[];
  selectedVaultIndex: number;
  setSelectedVaultIndex: (index: number) => void;
  selectedVault: SmartAccountVaultView | null;
  approvals: SmartAccountApprovalItem[];
  loadVaultActivity: (
    accountIndex: number,
    options?: { forceRefresh?: boolean }
  ) => Promise<void>;
  refresh: (options?: {
    invalidateAddresses?: string[];
    readCache?: boolean;
  }) => Promise<void>;
  /** Refresh only the authoritative groups affected by a mutation or event. */
  refreshGroups: (request: SmartAccountRefreshGroupsRequest) => Promise<void>;
  /** Refresh a confirmed mutation and schedule its one policy consistency read. */
  refreshMutationPlan: (plan: SmartAccountRefreshPlan) => Promise<void>;
  refreshEarnState: () => Promise<void>;
  /**
   * Invalidate caches and re-fetch portfolio + activity after an on-chain tx.
   * Pass the affected vault/signer addresses to make sure their balances
   * refresh on the next read; otherwise only the connected wallet refreshes.
   */
  refreshAfterTx: (args: {
    accountIndex?: number;
    groups?: readonly SmartAccountRefreshGroup[];
    refreshAuthenticatedWallet?: boolean;
    signerAddresses?: string[];
  }) => Promise<void>;
  approveProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  rejectProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  executeProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  addInitiateSigner: (args: {
    signerAddress: string;
    /**
     * Permissions to grant the new signer in the spending-limit policy.
     * Defaults to `["initiate"]` (the legacy "Suggest" tier). Pass
     * richer sets for "Sign" or "Execute" tiers.
     */
    permissions?: SmartAccountSignerPermission[];
  }) => Promise<void>;
  /**
   * Replace a root signer's permissions atomically (single settings change
   * that emits RemoveSigner + AddSigner). The smart-account program rejects
   * changes that would leave no signer with `execute`, so we let the program
   * enforce that guardrail rather than re-implementing it client-side.
   */
  updateSignerPermissions: (args: {
    signerAddress: string;
    permissions: SmartAccountSignerPermission[];
    /**
     * When provided, the change goes through a PolicyUpdate against this
     * spending-limit policy (covers Agent rows). When omitted, the change
     * goes through RemoveSigner+AddSigner on the settings PDA top-level
     * signer list (covers User + root Signer rows).
     */
    policyAddress?: string | null;
    accountIndex?: number;
  }) => Promise<void>;
  deleteSigner: (args: {
    accountIndex: number;
    policyAddress?: string | null;
    signerAddress: string;
  }) => Promise<void>;
  setSignerSpendingLimitUsd: (args: {
    accountIndex: number;
    amountUsd: number;
    existingSpendingLimitAddress?: string | null;
    signerAddress: string;
  }) => Promise<void>;
  topUpSignerWithSpendingLimitUsd: (args: {
    accountIndex: number;
    amountUsd: number;
    signerAddress: string;
    spendingLimitAddress: string;
  }) => Promise<void>;
  deleteSignerSpendingLimit: (args: {
    accountIndex: number;
    spendingLimitAddress: string;
    signerAddress: string;
  }) => Promise<void>;
  /**
   * Inspect what transfer paths the connected wallet can use for the
   * given vault + mint + amount + destination. Returns the path that
   * executeVaultTransfer would take. Used by the UI to render the
   * correct button state and notice ahead of submit.
   */
  evaluateVaultTransferCapability: (args: {
    accountIndex: number;
    mint: string;
    amountRaw: bigint;
    recipientAddress?: string;
  }) => VaultTransferCapability;
  /**
   * Send funds from a vault. Picks between:
   *   - spending-limit (1 sign, SOL only)
   *   - threshold-1 settings transfer (3 signs: propose, approve, execute)
   *   - threshold-N settings transfer (1 sign: propose only — funds queue)
   */
  executeVaultTransfer: (
    request: VaultTransferRequest
  ) => Promise<VaultTransferResult>;
  executeVaultSwap: (request: VaultSwapRequest) => Promise<VaultSwapResult>;
  executeEarnDeposit: (
    request: EarnDepositRequest
  ) => Promise<EarnDepositResult>;
  executeEarnDepositBatch: (
    request: EarnDepositBatchRequest
  ) => Promise<EarnDepositBatchResult>;
  executeEarnDepositPolicyStage: (
    request: EarnDepositPolicyStageRequest
  ) => Promise<EarnDepositPolicyStageResult>;
  executeEarnPolicySetup: () => Promise<EarnPolicySetupResult>;
  executeEarnWithdraw: (
    request: EarnWithdrawRequest
  ) => Promise<EarnWithdrawResult>;
  executeEarnCleanup: (
    request: EarnCleanupRequest
  ) => Promise<EarnCleanupResult>;
  prepareEarnAutodepositSetup: (
    request: Omit<EarnAutodepositSetupRequest, "preparedSetup">
  ) => Promise<SmartAccountPreparedEarnUsdcAutodepositSetup>;
  prepareEarnAutodepositClose: (
    request: Omit<EarnAutodepositCloseRequest, "preparedClose">
  ) => Promise<SmartAccountPreparedEarnUsdcAutodepositClose>;
  executeEarnAutodepositSetup: (
    request: EarnAutodepositSetupRequest
  ) => Promise<EarnAutodepositSetupResult>;
  executeEarnAutodepositClose: (
    request: EarnAutodepositCloseRequest
  ) => Promise<EarnAutodepositCloseResult>;
  executeEarnAutodepositFloorUpdate: (
    request: EarnAutodepositFloorUpdateRequest
  ) => Promise<EarnAutodepositFloorUpdateResult>;
  executeEarnAutodepositToggle: (
    request: EarnAutodepositToggleRequest
  ) => Promise<EarnAutodepositToggleResult>;
  isActionPending: boolean;
  requiresEarnPolicySetupForDeposit: boolean;
  pendingProposalId: string | null;
  pendingSpendingLimitActionKey: string | null;
  /**
   * Per-signer (non-User) portfolio + activity. Populated lazily; call
   * `loadSignerPortfolio(address)` on selection. Vault-only signers have
   * their own wallet balance + history independent of the vault.
   */
  signerPortfolioByAddress: Record<string, SmartAccountSignerPortfolioView>;
  loadSignerPortfolio: (
    signerAddress: string,
    options?: { forceRefresh?: boolean }
  ) => Promise<void>;
  loadSignerActivity: (
    signerAddress: string,
    options?: { forceRefresh?: boolean }
  ) => Promise<void>;
};

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const LOYL_ICON_URL =
  "https://avatars.githubusercontent.com/u/210601628?s=200&v=4";

function resolveTokenIcon(position: PortfolioPosition): string {
  if (position.asset.imageUrl) {
    return position.asset.imageUrl;
  }

  if (position.asset.mint === LOYL_MINT) {
    return LOYL_ICON_URL;
  }

  return getTokenIconUrl(position.asset.symbol);
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "$0.00";
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function splitUsd(value: number | null | undefined) {
  const formatted = formatUsd(value);
  const [whole, fraction] = formatted.split(".");

  return {
    whole: whole ?? "$0",
    fraction: fraction ? `.${fraction}` : ".00",
  };
}

function finiteUsd(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function createEmptyPortfolio(owner: string): PortfolioSnapshot {
  return {
    owner,
    nativeBalanceLamports: 0,
    positions: [],
    totals: {
      effectiveSolPriceUsd: null,
      pricedCount: 0,
      totalSol: null,
      totalUsd: 0,
      unpricedCount: 0,
    },
    fetchedAt: Date.now(),
  };
}

function createEmptyVaultSnapshot(
  vault: SmartAccountOverviewBase["vaults"][number]
): SmartAccountVaultSnapshot {
  return {
    accountIndex: vault.accountIndex,
    address: vault.address,
    lamports: 0,
    portfolio: createEmptyPortfolio(vault.address),
    activity: { activities: [] },
    signers: [],
    spendingLimits: [],
  };
}

function dedupeSignerSnapshots(
  signers: SmartAccountSignerSnapshot[]
): SmartAccountSignerSnapshot[] {
  const uniqueSigners = new Map<string, SmartAccountSignerSnapshot>();

  for (const signer of signers) {
    if (!uniqueSigners.has(signer.address)) {
      uniqueSigners.set(signer.address, signer);
    }
  }

  return Array.from(uniqueSigners.values());
}

function createOverviewFromBase(
  base: SmartAccountOverviewBase
): SmartAccountOverview {
  return {
    programId: base.programId,
    settingsPda: base.settingsPda,
    threshold: base.threshold,
    timeLock: base.timeLock,
    staleTransactionIndex: base.staleTransactionIndex,
    transactionIndex: base.transactionIndex,
    canonicalVaultAddress: base.canonicalVaultAddress,
    signers: base.signers,
    policies: [],
    spendingLimits: [],
    vaults: base.vaults.map((vault) => createEmptyVaultSnapshot(vault)),
    proposals: [],
    fetchedAt: base.fetchedAt,
  };
}

function mergeEarnVaultIntoOverview(
  overview: SmartAccountOverview,
  earnState: EarnStateResponse
): SmartAccountOverview {
  if (
    overview.vaults.some(
      (vault) => vault.accountIndex === earnState.vault.accountIndex
    )
  ) {
    return overview;
  }

  return {
    ...overview,
    vaults: [
      ...overview.vaults,
      createEmptyVaultSnapshot({
        accountIndex: earnState.vault.accountIndex,
        address: earnState.vault.pubkey,
      }),
    ].sort((left, right) => left.accountIndex - right.accountIndex),
  };
}

function decorateVaultsWithPolicies(args: {
  vaults: SmartAccountVaultSnapshot[];
  signers: SmartAccountSignerSnapshot[];
  policies: SmartAccountPolicyOverview["policies"];
  spendingLimits: SmartAccountPolicyOverview["spendingLimits"];
}): SmartAccountVaultSnapshot[] {
  const spendingLimitAccountIndexes = new Map(
    args.spendingLimits.map((spendingLimit) => [
      spendingLimit.address,
      spendingLimit.accountIndex,
    ])
  );

  return args.vaults.map((vault) => ({
    ...vault,
    signers: dedupeSignerSnapshots([
      ...args.signers,
      ...args.policies
        .filter(
          (policy) =>
            spendingLimitAccountIndexes.get(policy.address) ===
            vault.accountIndex
        )
        .flatMap((policy) => policy.signers),
    ]),
    spendingLimits: args.spendingLimits.filter(
      (spendingLimit) => spendingLimit.accountIndex === vault.accountIndex
    ),
  }));
}

function mergeVaultSnapshots(
  overview: SmartAccountOverview,
  vaults: SmartAccountVaultSnapshot[]
): SmartAccountOverview {
  const byAccountIndex = new Map(
    vaults.map((vault) => [vault.accountIndex, vault])
  );
  const existingIndexes = new Set(
    overview.vaults.map((vault) => vault.accountIndex)
  );
  const mergedVaults = [
    ...overview.vaults.map(
      (vault) => byAccountIndex.get(vault.accountIndex) ?? vault
    ),
    ...vaults.filter((vault) => !existingIndexes.has(vault.accountIndex)),
  ].sort((left, right) => left.accountIndex - right.accountIndex);

  return {
    ...overview,
    vaults: decorateVaultsWithPolicies({
      vaults: mergedVaults,
      signers: overview.signers,
      policies: overview.policies,
      spendingLimits: overview.spendingLimits,
    }),
    fetchedAt: Date.now(),
  };
}

function mergePolicyOverview(
  overview: SmartAccountOverview,
  policyOverview: SmartAccountPolicyOverview
): SmartAccountOverview {
  return {
    ...overview,
    signers: policyOverview.signers,
    policies: policyOverview.policies,
    spendingLimits: policyOverview.spendingLimits,
    vaults: decorateVaultsWithPolicies({
      vaults: overview.vaults,
      signers: policyOverview.signers,
      policies: policyOverview.policies,
      spendingLimits: policyOverview.spendingLimits,
    }),
    fetchedAt: Date.now(),
  };
}

function mergeBaseOverview(
  overview: SmartAccountOverview,
  base: SmartAccountOverviewBase
): SmartAccountOverview {
  const baseOverview = createOverviewFromBase(base);
  const currentVaultsByIndex = new Map(
    overview.vaults.map((vault) => [vault.accountIndex, vault])
  );
  const baseIndexes = new Set(base.vaults.map((vault) => vault.accountIndex));
  const vaults = [
    ...base.vaults.map(
      (vault) =>
        currentVaultsByIndex.get(vault.accountIndex) ??
        createEmptyVaultSnapshot(vault)
    ),
    ...overview.vaults.filter((vault) => !baseIndexes.has(vault.accountIndex)),
  ].sort((left, right) => left.accountIndex - right.accountIndex);

  return {
    ...overview,
    ...baseOverview,
    policies: overview.policies,
    proposals: overview.proposals,
    signers: base.signers,
    spendingLimits: overview.spendingLimits,
    vaults: decorateVaultsWithPolicies({
      vaults,
      signers: base.signers,
      policies: overview.policies,
      spendingLimits: overview.spendingLimits,
    }),
    fetchedAt: Date.now(),
  };
}

const SMART_ACCOUNT_OVERVIEW_CACHE_VERSION = 1;
const SMART_ACCOUNT_OVERVIEW_CACHE_PREFIX = "loyal.smartAccountOverview.v1";
const DEFAULT_BEST_APY_RESERVES_RISK_PROFILE = "safe";
const SMART_ACCOUNT_OVERVIEW_GROUP_TTL_MS = 30 * 1000;
// Best-APY reserve rankings move over hours; 30 minutes of staleness is
// invisible while it skips a Kamino-backed request on most reopens.
const SMART_ACCOUNT_BEST_APY_RESERVES_TTL_MS = 30 * 60 * 1000;

function getSmartAccountOverviewCacheKey(args: {
  settingsPda: string;
  solanaEnv: string;
}) {
  return `${SMART_ACCOUNT_OVERVIEW_CACHE_PREFIX}:${args.solanaEnv}:${args.settingsPda}`;
}

function getSmartAccountOverviewCacheStorage(): Pick<
  Storage,
  "getItem" | "setItem"
> | null {
  return getClientCacheStorage();
}

export function readSmartAccountOverviewCache(args: {
  settingsPda: string;
  solanaEnv: string;
  storage?: Pick<Storage, "getItem"> | null;
}): SmartAccountOverviewCachePayload | null {
  const storage =
    args.storage === undefined
      ? getSmartAccountOverviewCacheStorage()
      : args.storage;
  if (!storage) {
    return null;
  }

  return readClientCache<SmartAccountOverviewCachePayload>({
    key: getSmartAccountOverviewCacheKey(args),
    version: SMART_ACCOUNT_OVERVIEW_CACHE_VERSION,
    settingsPda: args.settingsPda,
    solanaEnv: args.solanaEnv,
    storage,
    validate: (data): data is SmartAccountOverviewCachePayload =>
      typeof data === "object" &&
      data !== null &&
      (data as { version?: unknown }).version ===
        SMART_ACCOUNT_OVERVIEW_CACHE_VERSION &&
      (data as { settingsPda?: unknown }).settingsPda === args.settingsPda &&
      (data as { solanaEnv?: unknown }).solanaEnv === args.solanaEnv &&
      typeof (data as { groups?: unknown }).groups === "object" &&
      (data as { groups?: unknown }).groups !== null,
  });
}

export function createOverviewFromCache(
  cache: SmartAccountOverviewCachePayload,
  options: { includeVaultSnapshots?: boolean } = {}
): SmartAccountOverview | null {
  const base = cache.groups.base?.data;
  if (!base) {
    return null;
  }

  return mergeCachedGroupsOntoOverview(createOverviewFromBase(base), cache, {
    includeVaultSnapshots: options.includeVaultSnapshots ?? true,
  });
}

function mergeCachedGroupsOntoOverview(
  baseOverview: SmartAccountOverview,
  cache: SmartAccountOverviewCachePayload | null,
  options: { includeVaultSnapshots?: boolean } = {}
): SmartAccountOverview {
  if (!cache) {
    return baseOverview;
  }

  let overview = baseOverview;
  const includeVaultSnapshots = options.includeVaultSnapshots ?? true;

  if (includeVaultSnapshots && cache.groups.vaults) {
    const expectedIndexes = new Set(
      baseOverview.vaults.map((vault) => vault.accountIndex)
    );
    overview = mergeVaultSnapshots(
      overview,
      cache.groups.vaults.data.filter((vault) =>
        expectedIndexes.has(vault.accountIndex)
      )
    );
  }

  if (cache.groups.policies) {
    overview = mergePolicyOverview(overview, cache.groups.policies.data);
  }

  if (cache.groups.proposals) {
    overview = {
      ...overview,
      proposals: cache.groups.proposals.data,
      fetchedAt: cache.groups.proposals.savedAt,
    };
  }

  return {
    ...overview,
    fetchedAt: cache.savedAt,
  };
}

export function writeSmartAccountOverviewCacheGroup<
  TGroupName extends SmartAccountOverviewCacheGroupName
>(args: {
  settingsPda: string;
  solanaEnv: string;
  group: TGroupName;
  data: SmartAccountOverviewCacheGroupData[TGroupName];
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}) {
  const storage =
    args.storage === undefined
      ? getSmartAccountOverviewCacheStorage()
      : args.storage;
  if (!storage) {
    return;
  }

  const savedAt = Date.now();
  const existing = readSmartAccountOverviewCache({
    settingsPda: args.settingsPda,
    solanaEnv: args.solanaEnv,
    storage,
  });
  const next: SmartAccountOverviewCachePayload = {
    version: SMART_ACCOUNT_OVERVIEW_CACHE_VERSION,
    settingsPda: args.settingsPda,
    solanaEnv: args.solanaEnv,
    savedAt,
    groups: {
      ...(existing?.groups ?? {}),
      [args.group]: {
        savedAt,
        data: args.data,
      },
    },
  };

  writeClientCache<SmartAccountOverviewCachePayload>({
    key: getSmartAccountOverviewCacheKey(args),
    version: SMART_ACCOUNT_OVERVIEW_CACHE_VERSION,
    settingsPda: args.settingsPda,
    solanaEnv: args.solanaEnv,
    storage,
    data: next,
  });
}

export function shouldSkipSmartAccountProposalLoad(
  base: Pick<
    SmartAccountOverviewBase,
    "staleTransactionIndex" | "transactionIndex"
  >
): boolean {
  return BigInt(base.staleTransactionIndex) >= BigInt(base.transactionIndex);
}

async function fetchSmartAccountGroup<T>(url: URL): Promise<T> {
  const response = await fetch(url.toString(), {
    credentials: "include",
  });

  if (!response.ok) {
    const errorPayload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    const message =
      errorPayload?.error?.message ?? "Failed to load smart-account overview.";

    throw new Error(message);
  }

  const payload = (await response.json()) as SmartAccountTimedRouteResponse<T>;
  return payload.data;
}

async function fetchEarnState(options?: {
  strict?: boolean;
}): Promise<EarnStateResponse | null> {
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/earn-state",
    {
      credentials: "include",
    }
  );

  if (response.status === 401 && !options?.strict) {
    return null;
  }

  if (!response.ok) {
    if (options?.strict) {
      throw new Error(`Failed to load Earn state (HTTP ${response.status}).`);
    }
    return null;
  }

  return (await response.json()) as EarnStateResponse;
}

async function postConfirmedEarnDeposit(args: {
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
  signature: string;
  confirmedSlot: string;
  smartAccountAddress: string;
  policyConfirmedSlot?: string;
  policySignature?: string;
  setupPolicyConfirmedSlot?: string;
  setupPolicySignature?: string;
}) {
  const body = buildEarnDepositConfirmRequestBody(args);
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/deposits/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to record confirmed earn deposit."
    );
  }
}

async function postConfirmedEarnAutodepositSetup(args: {
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
  signature: string;
  confirmedSlot: string;
  walletBalanceFloorRaw: bigint;
}): Promise<EarnAutodepositSetupConfirmResponse> {
  const body = buildEarnAutodepositSetupConfirmRequestBody(args);
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to record confirmed Autodeposit setup."
    );
  }

  return (await response.json()) as EarnAutodepositSetupConfirmResponse;
}

async function postConfirmedEarnAutodepositClose(args: {
  preparedClose: SmartAccountPreparedEarnUsdcAutodepositClose;
  signature: string;
  confirmedSlot: string;
}): Promise<EarnAutodepositCloseConfirmResponse> {
  const body = buildEarnAutodepositCloseConfirmRequestBody(args);
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/autodeposit/close/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to record confirmed Autodeposit close."
    );
  }

  return (await response.json()) as EarnAutodepositCloseConfirmResponse;
}

async function postEarnAutodepositFloorUpdate(args: {
  policyAccount: string;
  recurringDelegation: string;
  walletBalanceFloorRaw: bigint;
}): Promise<EarnAutodepositSetupConfirmResponse> {
  const body: EarnAutodepositFloorUpdateConfirmRequestBody = {
    policyAccount: args.policyAccount,
    recurringDelegation: args.recurringDelegation,
    vaultIndex: 1,
    walletBalanceFloorRaw: args.walletBalanceFloorRaw.toString(),
  };
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/autodeposit/floor/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ??
        "Failed to update Autodeposit wallet balance floor."
    );
  }

  return (await response.json()) as EarnAutodepositSetupConfirmResponse;
}

async function postEarnAutodepositToggle(args: {
  active: boolean;
  policyAccount: string;
  recurringDelegation: string;
}): Promise<EarnAutodepositToggleConfirmResponse> {
  const body: EarnAutodepositToggleConfirmRequestBody = {
    active: args.active,
    policyAccount: args.policyAccount,
    recurringDelegation: args.recurringDelegation,
    vaultIndex: 1,
  };
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/autodeposit/toggle/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to update Autodeposit active state."
    );
  }

  return (await response.json()) as EarnAutodepositToggleConfirmResponse;
}

export async function prepareEarnDepositOnServer(args: {
  amountRaw: bigint;
  fetchImpl?: typeof fetch;
}): Promise<SmartAccountPreparedEarnUsdcDeposit> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(
    "/api/smart-accounts/yield-optimization/deposits/prepare",
    {
      body: JSON.stringify({ amountRaw: args.amountRaw.toString() }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to prepare earn deposit."
    );
  }

  const payload = (await response.json()) as EarnDepositPrepareResponse;
  return hydratePreparedEarnUsdcDeposit(payload.preparedDeposit);
}

export async function prepareEarnCleanupOnServer(
  args: {
    fetchImpl?: typeof fetch;
  } = {}
): Promise<PreparedEarnUsdcCleanup> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(
    "/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare",
    {
      body: JSON.stringify({}),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to prepare Earn cleanup."
    );
  }

  const payload = (await response.json()) as EarnWithdrawCleanupPrepareResponse;
  return hydratePreparedEarnUsdcCleanup(payload.preparedCleanup);
}

async function prepareEarnPolicyOnServer(): Promise<SmartAccountPreparedEarnUsdcYieldRoutingPolicy> {
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/policies/prepare",
    {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to prepare earn policy."
    );
  }

  const payload = (await response.json()) as EarnPolicyPrepareResponse;
  return hydratePreparedEarnUsdcYieldRoutingPolicy(payload.preparedPolicy);
}

async function postConfirmedEarnPolicySetup(args: {
  preparedPolicy: SmartAccountPreparedEarnUsdcYieldRoutingPolicy;
  signature: string;
  confirmedSlot: string;
  setupPolicySignature: string;
  setupPolicyConfirmedSlot: string;
}) {
  const routeBody = buildEarnPolicyConfirmRequestBody({
    confirmedSlot: args.confirmedSlot,
    preparedPolicy: args.preparedPolicy,
    signature: args.signature,
    stage: "route_policy",
  });
  const routeResponse = await fetch(
    "/api/smart-accounts/yield-optimization/policies/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(routeBody),
    }
  );

  if (!routeResponse.ok) {
    const payload = (await routeResponse
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to record confirmed earn policy."
    );
  }

  const setupBody = buildEarnPolicyConfirmRequestBody({
    confirmedSlot: args.setupPolicyConfirmedSlot,
    preparedPolicy: args.preparedPolicy,
    setupPolicyConfirmedSlot: args.setupPolicyConfirmedSlot,
    setupPolicySignature: args.setupPolicySignature,
    signature: args.setupPolicySignature,
    stage: "setup_policy",
  });
  const setupResponse = await fetch(
    "/api/smart-accounts/yield-optimization/policies/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    }
  );

  if (!setupResponse.ok) {
    const payload = (await setupResponse
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to record confirmed earn setup policy."
    );
  }
}

async function postConfirmedEarnDepositPolicyStage(args: {
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
  signature: string;
  confirmedSlot: string;
  stage: "policy" | "policy-finalize";
}) {
  const body = buildEarnDepositPolicyStageConfirmRequestBody(args);
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/policies/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to record confirmed Earn policy stage."
    );
  }
}

async function postConfirmedEarnWithdraw(args: {
  autodepositCloseConfirmedSlot?: string;
  autodepositCloseSignature?: string;
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw;
  preparedStep?: SmartAccountPreparedEarnUsdcWithdraw["withdrawSteps"][number];
  signature: string;
  confirmedSlot: string;
  smartAccountAddress: string;
}) {
  const body = buildEarnWithdrawalConfirmRequestBody(args);
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/withdrawals/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to record confirmed earn withdrawal."
    );
  }
}

async function postConfirmedEarnCleanup(args: {
  autodepositCloseConfirmedSlot?: string;
  autodepositCloseSignature?: string;
  preparedCleanup: PreparedEarnUsdcCleanup;
  signature: string;
  confirmedSlot: string;
}) {
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/withdrawals/cleanup/confirm",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        autodepositCloseConfirmedSlot: args.autodepositCloseConfirmedSlot,
        autodepositCloseSignature: args.autodepositCloseSignature,
        cleanupSignature: args.signature,
        confirmedSlot: args.confirmedSlot,
        preparedCleanup: serializePreparedEarnUsdcCleanup({
          estimatedRefundLamports: args.preparedCleanup.estimatedRefundLamports,
          preparedCleanup: args.preparedCleanup,
        }),
      }),
    }
  );

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as SmartAccountRouteErrorResponse | null;
    throw new Error(
      payload?.error?.message ?? "Failed to record confirmed Earn cleanup."
    );
  }
}

export function shouldInitializeEarnYieldRoutingPolicyForDeposit({
  hasActiveEarnPosition,
  hasEarnPolicy = false,
}: {
  hasActiveEarnPosition: boolean;
  hasEarnPolicy?: boolean;
}): boolean {
  return !hasActiveEarnPosition && !hasEarnPolicy;
}

function isActiveEarnStatePosition(
  earnState: EarnStateResponse | null | undefined
): boolean {
  if (earnState?.position?.status !== "active") {
    return false;
  }

  try {
    return BigInt(earnState.position.currentTotalAmountRaw) > BigInt(0);
  } catch {
    return false;
  }
}

function resolveEarnLoyalCluster(solanaEnv: string): LoyalCluster {
  return resolveLoyalClusterForSolanaEnv(resolveSolanaEnv(solanaEnv));
}

export function getSmartAccountTotalUsd({
  vaultEntries,
}: {
  authenticatedWalletAddress?: string | null | undefined;
  vaultEntries: SmartAccountVaultEntry[];
}): number {
  let totalUsd = 0;

  for (const vault of vaultEntries) {
    totalUsd += finiteUsd(vault.totalUsd);
  }

  return totalUsd;
}

function formatTokenBalance(balance: number): string {
  return balance.toLocaleString("en-US", {
    minimumFractionDigits: balance >= 1 ? 0 : 2,
    maximumFractionDigits: balance >= 1 ? 4 : 6,
  });
}

function formatSolAmount(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function formatSolLamportsString(lamports: string): string {
  return formatSolAmount(Number(BigInt(lamports)));
}

function getNativeSolRequirementError(
  requirement: SmartAccountNativeSolRequirement | null | undefined
): string | null {
  if (!requirement || requirement.canProceed) {
    return null;
  }

  const deficitLamports = BigInt(requirement.deficitLamports);
  if (deficitLamports <= BigInt(0)) {
    return null;
  }

  return `Add at least ${formatSolLamportsString(
    requirement.deficitLamports
  )} SOL to the connected wallet before signing. This Earn setup requires ${formatSolLamportsString(
    requirement.requiredLamports
  )} SOL for account rent and network fees.`;
}

function lamportsToUsd(lamports: number, solPriceUsd: number): number {
  return (lamports / LAMPORTS_PER_SOL) * solPriceUsd;
}

function tokenAmountToUsd(
  amount: string,
  priceUsd: number | null | undefined
): number | null {
  const parsedAmount = Number.parseFloat(amount);

  if (
    typeof priceUsd !== "number" ||
    !Number.isFinite(priceUsd) ||
    !Number.isFinite(parsedAmount)
  ) {
    return null;
  }

  return parsedAmount * priceUsd;
}

function resolvePositionByMint(
  positions: PortfolioPosition[],
  mint: string
): PortfolioPosition | undefined {
  return positions.find((position) => position.asset.mint === mint);
}

function resolveSolPriceUsd(args: {
  effectiveSolPriceUsd?: number | null;
  positions: PortfolioPosition[];
}): number {
  return (
    args.effectiveSolPriceUsd ??
    resolvePositionByMint(args.positions, NATIVE_SOL_MINT)?.priceUsd ??
    85
  );
}

function resolveTokenSymbol(
  position: PortfolioPosition | undefined,
  mint: string
): string {
  if (position?.asset.symbol) {
    return position.asset.symbol;
  }

  if (mint === NATIVE_SOL_MINT) {
    return "SOL";
  }

  return mint === LOYL_MINT ? "LOYAL" : "TOKEN";
}

function formatTimestamp(timestamp: number | null) {
  const date = timestamp ? new Date(timestamp) : new Date();

  return {
    date: date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    }),
    time: date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  };
}

function shortAddress(address: string | null): string {
  if (!address) {
    return "Unknown";
  }

  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const AGENT_ICON_COUNT = 26;

function hashAddress(address: string): number {
  let hash = 0;

  for (let index = 0; index < address.length; index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getSignerIcon(args: {
  address: string;
  isAuthenticatedUser: boolean;
}): string {
  if (args.isAuthenticatedUser) {
    return "/agents/Agent-01.svg";
  }

  const iconIndex = (hashAddress(args.address) % AGENT_ICON_COUNT) + 1;
  return `/agents/Agent-${String(iconIndex).padStart(2, "0")}.svg`;
}

function getSignerAccessLevel(
  signer: SmartAccountSignerSnapshot
): SmartAccountSignerEntry["accessLevel"] {
  if (signer.canExecute) {
    return "execute";
  }

  if (signer.canVote) {
    return "sign";
  }

  return "suggest";
}

function getSignerAccessLabel(
  signer: SmartAccountSignerSnapshot
): SmartAccountSignerEntry["accessLabel"] {
  if (signer.canExecute) {
    return "Can execute";
  }

  if (signer.canVote) {
    return "Can vote";
  }

  return "Can propose";
}

function resolveSignerSpendingLimit(args: {
  signerAddress: string;
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
}): SmartAccountSpendingLimitSnapshot | null {
  const matchingLimits = args.spendingLimits.filter((spendingLimit) =>
    spendingLimit.signers.includes(args.signerAddress)
  );

  return (
    matchingLimits.find(
      (spendingLimit) =>
        !spendingLimit.isExpired &&
        spendingLimit.mint === SOL_SPENDING_LIMIT_MINT
    ) ??
    matchingLimits.find((spendingLimit) => !spendingLimit.isExpired) ??
    matchingLimits[0] ??
    null
  );
}

function mapSignersToEntries(args: {
  signers: SmartAccountSignerSnapshot[];
  authenticatedWalletAddress: string | null | undefined;
  /**
   * Full portfolio total (USD) for fallback display of the authenticated user.
   */
  authenticatedUserTotalUsd?: number | null;
  /**
   * Public stablecoin subtotal (USD) for the authenticated user. When present,
   * the Main Account row shows available cash instead of the whole portfolio.
   */
  authenticatedUserCashUsd?: number | null;
  solPriceUsd: number;
  spendingLimits?: SmartAccountSpendingLimitSnapshot[];
}): SmartAccountSignerEntry[] {
  let agentCount = 0;
  let signerCount = 0;

  return args.signers.map((signer) => {
    const isAuthenticatedUser =
      !!args.authenticatedWalletAddress &&
      signer.address === args.authenticatedWalletAddress;
    const label = isAuthenticatedUser
      ? "Main Account"
      : signer.scope === "policy"
      ? `Agent ${++agentCount}`
      : `Signer ${++signerCount}`;
    const balanceUsd =
      isAuthenticatedUser &&
      typeof args.authenticatedUserCashUsd === "number" &&
      Number.isFinite(args.authenticatedUserCashUsd)
        ? args.authenticatedUserCashUsd
        : isAuthenticatedUser &&
          typeof args.authenticatedUserTotalUsd === "number" &&
          Number.isFinite(args.authenticatedUserTotalUsd)
        ? args.authenticatedUserTotalUsd
        : lamportsToUsd(signer.lamports ?? 0, args.solPriceUsd);
    const balance = splitUsd(balanceUsd);

    return {
      id: `${signer.scope}:${signer.consensusAddress}:${signer.address}:${
        signer.policyAddress ?? "root"
      }`,
      label,
      address: signer.address,
      shortAddress: shortAddress(signer.address),
      icon: getSignerIcon({
        address: signer.address,
        isAuthenticatedUser,
      }),
      totalUsd: balanceUsd,
      balanceWhole: balance.whole,
      balanceFraction: balance.fraction,
      accessLevel: getSignerAccessLevel(signer),
      accessLabel: getSignerAccessLabel(signer),
      scope: signer.scope,
      scopeLabel:
        signer.scope === "policy" ? "Constrained policy" : "Root signer",
      permissions: signer.permissions,
      canInitiate: signer.canInitiate,
      canVote: signer.canVote,
      canExecute: signer.canExecute,
      policyAddress: signer.policyAddress,
      spendingLimit: resolveSignerSpendingLimit({
        signerAddress: signer.address,
        spendingLimits: args.spendingLimits ?? [],
      }),
      spendingLimits: (args.spendingLimits ?? []).filter((spendingLimit) =>
        spendingLimit.signers.includes(signer.address)
      ),
    };
  });
}

function mapVaultActivity(
  activity: WalletActivity,
  positions: PortfolioPosition[],
  solPriceUsd: number
): {
  row: ActivityRow;
  detail: TransactionDetail;
} {
  const timestamp = formatTimestamp(activity.timestamp);
  const isIncoming = activity.direction === "in";
  const type: ActivityRow["type"] =
    activity.type === "secure"
      ? "shielded"
      : activity.type === "unshield"
      ? "unshielded"
      : isIncoming
      ? "received"
      : "sent";
  let baseAmount: string;
  let icon: string;
  let usdValue = "$0.00";

  switch (activity.type) {
    case "token_transfer":
    case "secure":
    case "unshield": {
      const position = resolvePositionByMint(positions, activity.token.mint);
      const symbol = resolveTokenSymbol(position, activity.token.mint);
      baseAmount = `${activity.token.amount} ${symbol}`;
      icon = position
        ? resolveTokenIcon(position)
        : "/hero-new/Wallet-Cover.png";
      usdValue = formatUsd(
        tokenAmountToUsd(activity.token.amount, position?.priceUsd)
      );
      break;
    }
    case "swap": {
      const position = resolvePositionByMint(
        positions,
        activity.fromToken.mint
      );
      const isFromSol = activity.fromToken.mint === NATIVE_SOL_MINT;
      const symbol = position?.asset.symbol ?? (isFromSol ? "SOL" : "TOKEN");
      const priceUsd = position?.priceUsd ?? (isFromSol ? solPriceUsd : null);
      baseAmount = `${activity.fromToken.amount} ${symbol}`;
      icon = position ? resolveTokenIcon(position) : getTokenIconUrl(symbol);
      usdValue = formatUsd(
        tokenAmountToUsd(activity.fromToken.amount, priceUsd)
      );
      break;
    }
    case "sol_transfer":
      baseAmount = `${formatSolAmount(activity.amountLamports)} SOL`;
      icon = getTokenIconUrl("SOL");
      usdValue = formatUsd(lamportsToUsd(activity.amountLamports, solPriceUsd));
      break;
    case "program_action":
      if (activity.token) {
        const position = resolvePositionByMint(positions, activity.token.mint);
        const symbol = resolveTokenSymbol(position, activity.token.mint);
        baseAmount = `${activity.token.amount} ${symbol}`;
        icon = position
          ? resolveTokenIcon(position)
          : "/hero-new/Wallet-Cover.png";
        usdValue = formatUsd(
          tokenAmountToUsd(activity.token.amount, position?.priceUsd)
        );
        break;
      }

      baseAmount = `${formatSolAmount(activity.amountLamports)} SOL`;
      icon = getTokenIconUrl("SOL");
      usdValue = formatUsd(lamportsToUsd(activity.amountLamports, solPriceUsd));
      break;
  }

  const amount =
    activity.type === "secure" || activity.type === "unshield"
      ? baseAmount
      : `${isIncoming ? "+" : "-"}${baseAmount}`;
  const counterparty =
    activity.type === "program_action"
      ? activity.action
      : activity.counterparty ?? shortAddress(null);

  return {
    row: {
      id: activity.signature,
      type,
      counterparty,
      amount,
      timestamp: timestamp.time,
      date: timestamp.date,
      icon,
      rawTimestamp: activity.timestamp ?? undefined,
    },
    detail: {
      activity: {
        id: activity.signature,
        type,
        counterparty,
        amount,
        timestamp: timestamp.time,
        date: timestamp.date,
        icon,
        rawTimestamp: activity.timestamp ?? undefined,
      },
      usdValue,
      status: activity.status === "failed" ? "Failed" : "Completed",
      networkFee: `${formatSolAmount(activity.feeLamports)} SOL`,
      networkFeeUsd: formatUsd(
        lamportsToUsd(activity.feeLamports, solPriceUsd)
      ),
    },
  };
}

function mapVaultToTokenRows(
  positions: PortfolioPosition[],
  priceChange24hByMint?: ReadonlyMap<string, number>,
  stablecoinMints?: ReadonlySet<string>
): TokenRow[] {
  return positions
    .filter((position) => position.totalBalance > 0)
    .map((position) => {
      const row: TokenRow = {
        id: position.asset.mint,
        symbol: position.asset.symbol,
        price: formatUsd(position.priceUsd),
        amount: formatTokenBalance(position.totalBalance),
        value: formatUsd(position.totalValueUsd),
        icon: resolveTokenIcon(position),
        totalAmountDisplay: formatTokenBalance(position.totalBalance),
        totalValueDisplay: formatUsd(position.totalValueUsd),
        publicAmountDisplay: formatTokenBalance(position.publicBalance),
        publicValueDisplay: formatUsd(position.publicValueUsd),
        securedAmountDisplay: formatTokenBalance(position.securedBalance),
        securedValueDisplay: formatUsd(position.securedValueUsd),
      };
      const pct = priceChange24hByMint?.get(position.asset.mint);
      if (
        typeof pct === "number" &&
        !isStablecoinMint(
          position.asset.mint,
          stablecoinMints ?? EMPTY_STABLECOIN_MINTS
        )
      ) {
        row.priceChange24h = pct;
      }
      return row;
    });
}

function mapVaultActivityPageToView(
  activityPage: ActivityPage,
  positions: PortfolioPosition[],
  solPriceUsd: number
): SmartAccountVaultActivityView {
  const transactionDetails: Record<string, TransactionDetail> = {};
  const activityRows = activityPage.activities.map((activity) => {
    const mapped = mapVaultActivity(activity, positions, solPriceUsd);
    transactionDetails[mapped.row.id] = mapped.detail;
    return mapped.row;
  });

  return {
    activityRows,
    transactionDetails,
  };
}

function mapVaultToActivityView(
  vault: SmartAccountVaultSnapshot
): SmartAccountVaultActivityView {
  const solPriceUsd =
    vault.portfolio.totals.effectiveSolPriceUsd ??
    resolvePositionByMint(vault.portfolio.positions, NATIVE_SOL_MINT)
      ?.priceUsd ??
    85;

  return mapVaultActivityPageToView(
    vault.activity,
    vault.portfolio.positions,
    solPriceUsd
  );
}

function mapProposalToApprovalItem(
  proposal: SmartAccountProposalSnapshot
): SmartAccountApprovalItem {
  const amount = proposal.summary.amountUi ?? "Pending";
  const isSettingsChange = proposal.summary.kind === "settings_change";
  const isExecutablePolicyProposal =
    proposal.payloadType === "policy_transaction" &&
    (proposal.summary.kind !== "unknown" ||
      proposal.decodedInstructions.length > 0);
  const symbol =
    proposal.summary.symbol ??
    (proposal.summary.kind === "sol_transfer"
      ? "SOL"
      : isSettingsChange
      ? ""
      : "TOKEN");
  const sourceAccountIndex = proposal.accountIndex;

  return {
    id: proposal.proposalAddress,
    title: proposal.summary.title,
    destinationLabel: isSettingsChange
      ? "settings"
      : shortAddress(proposal.summary.destination),
    amount,
    symbol,
    sourceAccountIndex,
    sourceLabel:
      sourceAccountIndex === null
        ? "Unknown stash"
        : `Stash ${sourceAccountIndex}`,
    status: proposal.status,
    canExecute:
      proposal.payloadType === "transaction" ||
      proposal.payloadType === "settings_transaction" ||
      isExecutablePolicyProposal,
    proposal,
  };
}

function compareProposalSnapshotsByRecency(
  left: SmartAccountProposalSnapshot,
  right: SmartAccountProposalSnapshot
) {
  const timestampDelta =
    (right.statusTimestamp ?? 0) - (left.statusTimestamp ?? 0);

  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  const leftIndex = BigInt(left.transactionIndex);
  const rightIndex = BigInt(right.transactionIndex);

  if (leftIndex !== rightIndex) {
    return rightIndex > leftIndex ? 1 : -1;
  }

  return left.proposalAddress.localeCompare(right.proposalAddress);
}

function createWalletAdapterBridge(wallet: ReturnType<typeof useWallet>) {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    return null;
  }

  return {
    publicKey: wallet.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      transaction: T
    ): Promise<T> => {
      if (!wallet.signTransaction) {
        throw new Error("Connected wallet does not support signTransaction.");
      }

      return wallet.signTransaction(transaction);
    },
    ...(wallet.signAllTransactions
      ? {
          signAllTransactions: <T extends Transaction | VersionedTransaction>(
            transactions: T[]
          ): Promise<T[]> => wallet.signAllTransactions!(transactions),
        }
      : {}),
    sendTransaction: (
      transaction: Transaction | VersionedTransaction,
      nextConnection: ReturnType<typeof useConnection>["connection"],
      options?: SendOptions
    ) => wallet.sendTransaction!(transaction, nextConnection, options),
  };
}

const CONFIRMED_SIGNATURE_SLOT_ATTEMPTS = 10;
const CONFIRMED_SIGNATURE_SLOT_RETRY_MS = 350;

function waitForConfirmedSignatureSlotRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<string> {
  let lastStatus: string | null = null;

  for (
    let attempt = 0;
    attempt < CONFIRMED_SIGNATURE_SLOT_ATTEMPTS;
    attempt += 1
  ) {
    const { value } = await args.connection.getSignatureStatuses(
      [args.signature],
      { searchTransactionHistory: true }
    );
    const status = value[0] ?? null;
    const slot = status?.slot;

    if (typeof slot === "number") {
      return String(slot);
    }

    lastStatus =
      status?.confirmationStatus ??
      (status ? "status_without_slot" : "missing_status");

    const transaction = await args.connection.getTransaction(args.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (typeof transaction?.slot === "number") {
      return String(transaction.slot);
    }

    if (attempt < CONFIRMED_SIGNATURE_SLOT_ATTEMPTS - 1) {
      await waitForConfirmedSignatureSlotRetry(
        CONFIRMED_SIGNATURE_SLOT_RETRY_MS
      );
    }
  }

  throw new Error(
    `Confirmed transaction slot is unavailable${
      lastStatus ? ` (${lastStatus})` : ""
    }.`
  );
}

async function decompileVersionedTransaction(args: {
  connection: Connection;
  transaction: VersionedTransaction;
}): Promise<{
  addressLookupTableAccounts: AddressLookupTableAccount[];
  instructions: TransactionInstruction[];
}> {
  const addressLookupTableAccounts = await Promise.all(
    args.transaction.message.addressTableLookups.map(async (lookup) => {
      const response = await args.connection.getAddressLookupTable(
        lookup.accountKey
      );
      if (!response.value) {
        throw new Error(
          `Address lookup table ${lookup.accountKey.toBase58()} was not found.`
        );
      }
      return response.value;
    })
  );
  const message = TransactionMessage.decompile(args.transaction.message, {
    addressLookupTableAccounts,
  });

  return {
    addressLookupTableAccounts,
    instructions: message.instructions,
  };
}

function resolveVaultSolPriceUsd(
  vault: SmartAccountOverview["vaults"][number] | undefined
): number | null {
  const price =
    vault?.portfolio.totals.effectiveSolPriceUsd ??
    resolvePositionByMint(vault?.portfolio.positions ?? [], NATIVE_SOL_MINT)
      ?.priceUsd ??
    null;

  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? price
    : null;
}

function usdToLamports(amountUsd: number, solPriceUsd: number): bigint {
  const lamports = Math.round((amountUsd / solPriceUsd) * LAMPORTS_PER_SOL);

  return BigInt(Math.max(1, lamports));
}

function usdToTokenRawAmount(args: {
  amountUsd: number;
  decimals: number;
  priceUsd: number;
}): bigint {
  const scale = 10 ** args.decimals;
  const rawAmount = Math.round((args.amountUsd / args.priceUsd) * scale);

  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("Enter an amount greater than $0.");
  }

  if (!Number.isSafeInteger(rawAmount)) {
    throw new Error("Amount is too large for this token.");
  }

  return BigInt(rawAmount);
}

function tokenRawAmountToNumber(
  amountRaw: string,
  decimals: number
): number | null {
  const rawAmount = Number(amountRaw);
  const scale = 10 ** decimals;

  if (!Number.isFinite(rawAmount) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  return rawAmount / scale;
}

function deriveSpendingLimitPriceUsd(
  spendingLimit: SmartAccountSpendingLimitSnapshot
): number | null {
  if (
    typeof spendingLimit.amountUsd !== "number" ||
    !Number.isFinite(spendingLimit.amountUsd)
  ) {
    return null;
  }

  const amount = tokenRawAmountToNumber(
    spendingLimit.amountRaw,
    spendingLimit.decimals
  );

  if (!amount || amount <= 0) {
    return null;
  }

  const price = spendingLimit.amountUsd / amount;

  return Number.isFinite(price) && price > 0 ? price : null;
}

function resolveSpendingLimitUsdConversion(args: {
  spendingLimit: SmartAccountSpendingLimitSnapshot | null;
  vault: SmartAccountOverview["vaults"][number] | undefined;
}): { decimals: number; priceUsd: number | null; symbol: string } {
  if (
    !args.spendingLimit ||
    args.spendingLimit.mint === SOL_SPENDING_LIMIT_MINT
  ) {
    return {
      decimals: 9,
      priceUsd: resolveVaultSolPriceUsd(args.vault),
      symbol: "SOL",
    };
  }

  const position = resolvePositionByMint(
    args.vault?.portfolio.positions ?? [],
    args.spendingLimit.mint
  );
  const priceUsd =
    position?.priceUsd ?? deriveSpendingLimitPriceUsd(args.spendingLimit);

  return {
    decimals: args.spendingLimit.decimals,
    priceUsd:
      typeof priceUsd === "number" && Number.isFinite(priceUsd) && priceUsd > 0
        ? priceUsd
        : null,
    symbol: args.spendingLimit.symbol || position?.asset.symbol || "TOKEN",
  };
}

async function getSolanaErrorLogs(
  error: unknown,
  connection: Connection
): Promise<string[]> {
  const candidate = error as {
    cause?: unknown;
    getLogs?: (nextConnection: Connection) => Promise<string[]>;
    logs?: string[];
  };

  if (Array.isArray(candidate.logs)) {
    return candidate.logs;
  }

  if (typeof candidate.getLogs === "function") {
    try {
      return await candidate.getLogs(connection);
    } catch {
      return [];
    }
  }

  const cause = candidate.cause as
    | {
        getLogs?: (nextConnection: Connection) => Promise<string[]>;
        logs?: string[];
      }
    | undefined;

  if (Array.isArray(cause?.logs)) {
    return cause.logs;
  }

  if (typeof cause?.getLogs === "function") {
    try {
      return await cause.getLogs(connection);
    } catch {
      return [];
    }
  }

  return [];
}

async function normalizeSpendingLimitError(
  error: unknown,
  connection: Connection
): Promise<Error> {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to submit spending-limit transaction.";
  const logs = await getSolanaErrorLogs(error, connection);
  const combinedLogs = logs.length ? logs.join("\n") : message;
  const lamportsMatch = combinedLogs.match(
    /insufficient lamports (\d+), need (\d+)/
  );

  if (lamportsMatch) {
    const currentLamports = Number(lamportsMatch[1]);
    const neededLamports = Number(lamportsMatch[2]);

    if (
      combinedLogs.includes("Instruction: UseSpendingLimit") ||
      combinedLogs.includes("Instruction: ExecuteTransactionSyncV2")
    ) {
      return new Error(
        `Stash does not have enough SOL for this top-up. Available balance in this transfer step is ${formatSolAmount(
          currentLamports
        )} SOL, but it needs ${formatSolAmount(neededLamports)} SOL.`
      );
    }

    return new Error(
      `Not enough SOL in the connected wallet to pay transaction rent. Current balance available to this step is ${formatSolAmount(
        currentLamports
      )} SOL, but it needs at least ${formatSolAmount(
        neededLamports
      )} SOL plus fees. Top up the wallet and try again.`
    );
  }

  if (
    combinedLogs.includes("SpendingLimitExceeded") ||
    combinedLogs.includes("SpendingLimitInsufficientRemainingAmount") ||
    combinedLogs.includes("SpendingLimitViolatesMaxPerUseConstraint")
  ) {
    return new Error("Top-up amount exceeds the remaining spending limit.");
  }

  if (combinedLogs.includes("sum of account balances before and after")) {
    return new Error(
      "Updating the spending-limit policy failed while the program reallocated accounts. Refresh the wallet and try again."
    );
  }

  if (logs.length) {
    return new Error(`${message}\n${logs.join("\n")}`);
  }

  return error instanceof Error ? error : new Error(message);
}

export function useSmartAccountSidebarData(
  options: {
    authenticatedUserTotalUsd?: number | null;
    authenticatedUserCashUsd?: number | null;
    loadVaultSnapshots?: boolean;
    onAfterTx?: (
      context: SmartAccountRefreshCommitContext
    ) => Promise<void> | void;
  } = {}
): SmartAccountSidebarData {
  const {
    authenticatedUserCashUsd,
    authenticatedUserTotalUsd,
    loadVaultSnapshots = false,
    onAfterTx,
  } = options;
  const publicEnv = usePublicEnv();
  const solanaEnv = publicEnv.solanaEnv;
  const stablecoinMints = useMemo(
    () => getStablecoinMintSetForSolanaEnv(solanaEnv),
    [solanaEnv]
  );
  const onAfterTxRef = useRef(onAfterTx);
  useEffect(() => {
    onAfterTxRef.current = onAfterTx;
  }, [onAfterTx]);
  const { user } = useAuthSession();
  const { connection } = useConnection();
  const wallet = useWallet();
  const walletDataClient = useSolanaWalletDataClient();
  const smartAccountScope = [
    solanaEnv,
    user?.settingsPda ?? "no-settings",
    user?.walletAddress ?? "no-wallet",
  ].join(":");
  const smartAccountScopeGenerationRef =
    useRef<SmartAccountScopeGeneration | null>(null);
  if (!smartAccountScopeGenerationRef.current) {
    smartAccountScopeGenerationRef.current = new SmartAccountScopeGeneration(
      smartAccountScope
    );
  }
  const smartAccountScopeGeneration = smartAccountScopeGenerationRef.current;
  const smartAccountScopeSnapshot =
    smartAccountScopeGeneration.update(smartAccountScope);
  const refreshRunIdRef = useRef(0);
  const earnStateRefreshRunIdRef = useRef(0);
  const groupRefreshSingleflightRef = useRef<SmartAccountRefreshSingleflight>(
    new SmartAccountRefreshSingleflight()
  );
  const refreshOrderRef = useRef<SmartAccountRefreshOrder>(
    new SmartAccountRefreshOrder()
  );
  const policyFollowUpRef = useRef<SmartAccountPolicyFollowUp>(
    new SmartAccountPolicyFollowUp()
  );
  const pendingVaultInvalidationAddressesRef = useRef<Set<string>>(new Set());
  const [overview, setOverview] = useState<SmartAccountOverview | null>(null);
  const [isBaseLoading, setIsBaseLoading] = useState(false);
  const [isVaultsLoading, setIsVaultsLoading] = useState(false);
  const [isPoliciesLoading, setIsPoliciesLoading] = useState(false);
  const [isProposalsLoading, setIsProposalsLoading] = useState(false);
  const [isBestApyReservesLoading, setIsBestApyReservesLoading] =
    useState(false);
  const [bestApyReservesByStablecoin, setBestApyReservesByStablecoin] =
    useState<CurrentBestApyReserveByStablecoinCache | null>(null);
  const [earnState, setEarnState] = useState<EarnStateResponse | null>(null);
  const [hasEarnStateResolved, setHasEarnStateResolved] = useState(false);
  const [isEarnStateLoading, setIsEarnStateLoading] = useState(false);
  const [scopedErrors, setScopedErrors] = useState<SmartAccountScopedErrors>({
    base: null,
    vaults: null,
    policies: null,
    proposals: null,
    bestApyReserves: null,
  });
  const error = resolveSmartAccountRefreshError(scopedErrors);
  const [selectedVaultIndex, setSelectedVaultIndex] = useState(0);
  const [isActionPending, setIsActionPending] = useState(false);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(
    null
  );
  const [pendingSpendingLimitActionKey, setPendingSpendingLimitActionKey] =
    useState<string | null>(null);
  const [vaultActivityByAccountIndex, setVaultActivityByAccountIndex] =
    useState<Record<number, SmartAccountVaultActivityView>>({});
  const vaultActivityLoadPromisesRef = useRef<Map<string, Promise<void>>>(
    new Map()
  );
  const [signerPortfolioByAddress, setSignerPortfolioByAddress] = useState<
    Record<string, SmartAccountSignerPortfolioView>
  >({});
  const signerPortfolioLoadPromisesRef = useRef<Map<string, Promise<void>>>(
    new Map()
  );
  const signerActivityLoadPromisesRef = useRef<Map<string, Promise<void>>>(
    new Map()
  );
  const earnAutodepositSetupPreparePromisesRef = useRef<
    Map<string, Promise<SmartAccountPreparedEarnUsdcAutodepositSetup>>
  >(new Map());
  const earnAutodepositSetupBatchPreparePromisesRef = useRef<
    Map<string, Promise<EarnAutodepositSetupBatchPrepare>>
  >(new Map());
  const earnPolicy = earnState?.policy ?? null;
  const requiresEarnPolicySetupForDeposit =
    shouldInitializeEarnYieldRoutingPolicyForDeposit({
      hasActiveEarnPosition:
        Boolean(earnPolicy) && isActiveEarnStatePosition(earnState),
      hasEarnPolicy: Boolean(earnPolicy),
    });

  const refresh = useCallback(
    async (refreshOptions?: {
      invalidateAddresses?: string[];
      readCache?: boolean;
    }) => {
      const requestedSettingsPda = user?.settingsPda ?? null;
      const requestedScope = smartAccountScopeSnapshot;
      if (!smartAccountScopeGeneration.isCurrent(requestedScope)) {
        return;
      }
      const refreshRunId = refreshRunIdRef.current + 1;
      refreshRunIdRef.current = refreshRunId;
      const canCommit = () =>
        smartAccountScopeGeneration.isCurrent(requestedScope) &&
        refreshRunIdRef.current === refreshRunId;
      const orderTokens = new Map<
        SmartAccountRefreshOrderGroup,
        SmartAccountRefreshOrderToken
      >();
      for (const group of [
        "base",
        "policies",
        "proposals",
        "vaults",
        "earn",
        "bestApyReserves",
      ] as const) {
        orderTokens.set(group, refreshOrderRef.current.begin(group));
      }
      const canCommitGroup = (group: SmartAccountRefreshOrderGroup) => {
        const token = orderTokens.get(group);
        return Boolean(
          token && canCommit() && refreshOrderRef.current.isCurrent(token)
        );
      };
      const commitIfCurrent = (commit: () => void) => {
        if (!canCommit()) {
          return false;
        }
        commit();
        return true;
      };
      const commitGroupIfCurrent = (
        group: SmartAccountRefreshOrderGroup,
        commit: () => void
      ) => {
        if (!canCommitGroup(group)) {
          return false;
        }
        commit();
        return true;
      };

      if (!requestedSettingsPda) {
        setOverview(null);
        setIsBaseLoading(false);
        setIsVaultsLoading(false);
        setIsPoliciesLoading(false);
        setIsProposalsLoading(false);
        setIsBestApyReservesLoading(false);
        setScopedErrors({
          base: null,
          vaults: null,
          policies: null,
          proposals: null,
          bestApyReserves: null,
        });
        setBestApyReservesByStablecoin(null);
        setEarnState(null);
        setHasEarnStateResolved(true);
        setIsEarnStateLoading(false);
        return;
      }

      const settingsPda = requestedSettingsPda;
      let baseOverview: SmartAccountOverview | null = null;
      const shouldReadCache = refreshOptions?.readCache ?? true;
      const invalidateAddresses = refreshOptions?.invalidateAddresses?.filter(
        (value) => value.length > 0
      );
      const hasInvalidations = Boolean(
        invalidateAddresses && invalidateAddresses.length > 0
      );
      const canUseFreshCache = shouldReadCache && !hasInvalidations;
      const cachedPayload = shouldReadCache
        ? readSmartAccountOverviewCache({
            settingsPda,
            solanaEnv,
          })
        : null;
      const cachedOverview = cachedPayload
        ? createOverviewFromCache(cachedPayload, {
            includeVaultSnapshots: loadVaultSnapshots,
          })
        : null;
      const cachedBestApyReserves =
        cachedPayload?.groups.bestApyReserves?.data ??
        readSmartAccountOverviewCache({
          settingsPda,
          solanaEnv,
        })?.groups.bestApyReserves?.data ??
        null;
      const cachedBaseIsFresh =
        canUseFreshCache &&
        isSmartAccountOverviewCacheGroupFresh(
          cachedPayload?.groups.base,
          SMART_ACCOUNT_OVERVIEW_GROUP_TTL_MS
        );

      if (cachedOverview) {
        baseOverview = cachedOverview;
        const didCommit = commitIfCurrent(() => {
          setOverview(cachedOverview);
          setBestApyReservesByStablecoin(cachedBestApyReserves);
          setVaultActivityByAccountIndex({});
          vaultActivityLoadPromisesRef.current.clear();
        });
        if (!didCommit) {
          return;
        }
      }

      const didStartLoading = commitIfCurrent(() => {
        setIsBaseLoading(true);
        setIsVaultsLoading(false);
        setIsPoliciesLoading(false);
        setIsProposalsLoading(false);
        setIsBestApyReservesLoading(false);
        setIsEarnStateLoading(true);
        setScopedErrors({
          base: null,
          vaults: null,
          policies: null,
          proposals: null,
          bestApyReserves: null,
        });
      });
      if (!didStartLoading) {
        return;
      }

      const earnStatePromise = fetchEarnState().catch(() => null);

      try {
        if (cachedBaseIsFresh && cachedPayload?.groups.base) {
          baseOverview =
            cachedOverview ??
            mergeCachedGroupsOntoOverview(
              createOverviewFromBase(cachedPayload.groups.base.data),
              cachedPayload,
              { includeVaultSnapshots: loadVaultSnapshots }
            );
        } else {
          const baseUrl = new URL(
            "/api/smart-accounts/overview/base",
            window.location.origin
          );
          const base = await fetchSmartAccountGroup<SmartAccountOverviewBase>(
            baseUrl
          );
          if (!canCommitGroup("base")) {
            return;
          }
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "base",
            data: base,
          });
          baseOverview = mergeCachedGroupsOntoOverview(
            createOverviewFromBase(base),
            cachedPayload,
            { includeVaultSnapshots: loadVaultSnapshots }
          );
          setOverview((current) =>
            current?.settingsPda === settingsPda
              ? mergeBaseOverview(current, base)
              : baseOverview
          );
          setVaultActivityByAccountIndex({});
          vaultActivityLoadPromisesRef.current.clear();
        }
      } catch (nextError) {
        if (!canCommitGroup("base")) {
          return;
        }
        const message =
          nextError instanceof Error
            ? nextError.message
            : "Failed to load smart-account overview.";
        setScopedErrors((current) => ({
          ...current,
          base: message,
        }));
        if (!cachedOverview) {
          setOverview(null);
        }
        if (canCommitGroup("earn")) {
          setHasEarnStateResolved(true);
          setIsEarnStateLoading(false);
        }
        return;
      } finally {
        if (canCommitGroup("base")) {
          setIsBaseLoading(false);
        }
      }

      if (!canCommit()) {
        return;
      }

      if (!baseOverview) {
        if (canCommitGroup("earn")) {
          setHasEarnStateResolved(true);
          setIsEarnStateLoading(false);
        }
        return;
      }

      const loadEarnState = async () => {
        try {
          const nextEarnState = await earnStatePromise;
          if (!canCommitGroup("earn")) {
            return;
          }
          setEarnState(nextEarnState);
          if (!nextEarnState) {
            return;
          }

          setOverview((current) =>
            current
              ? mergeEarnVaultIntoOverview(current, nextEarnState)
              : current
          );
        } finally {
          if (canCommitGroup("earn")) {
            setHasEarnStateResolved(true);
            setIsEarnStateLoading(false);
          }
        }
      };

      const loadVaults = async () => {
        if (!loadVaultSnapshots) {
          return;
        }

        if (
          canUseFreshCache &&
          isSmartAccountOverviewCacheGroupFresh(
            cachedPayload?.groups.vaults,
            SMART_ACCOUNT_OVERVIEW_GROUP_TTL_MS
          )
        ) {
          return;
        }

        if (!commitGroupIfCurrent("vaults", () => setIsVaultsLoading(true))) {
          return;
        }

        try {
          const vaultsUrl = new URL(
            "/api/smart-accounts/overview/vaults",
            window.location.origin
          );
          vaultsUrl.searchParams.set(
            "accountUtilization",
            String(baseOverview.vaults.length - 1)
          );
          if (invalidateAddresses && invalidateAddresses.length > 0) {
            vaultsUrl.searchParams.set(
              "invalidate",
              invalidateAddresses.join(",")
            );
          }

          const vaults = await fetchSmartAccountGroup<
            SmartAccountVaultSnapshot[]
          >(vaultsUrl);
          if (!canCommitGroup("vaults")) {
            return;
          }
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "vaults",
            data: vaults,
          });
          setOverview((current) =>
            current ? mergeVaultSnapshots(current, vaults) : current
          );
          setVaultActivityByAccountIndex({});
          vaultActivityLoadPromisesRef.current.clear();
        } catch (nextError) {
          if (!canCommitGroup("vaults")) {
            return;
          }
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Failed to load vault balances.";
          setScopedErrors((current) => ({
            ...current,
            vaults: message,
          }));
        } finally {
          if (canCommitGroup("vaults")) {
            setIsVaultsLoading(false);
          }
        }
      };

      const loadPolicies = async () => {
        if (
          canUseFreshCache &&
          isSmartAccountOverviewCacheGroupFresh(
            cachedPayload?.groups.policies,
            SMART_ACCOUNT_OVERVIEW_GROUP_TTL_MS
          )
        ) {
          return;
        }

        if (
          !commitGroupIfCurrent("policies", () => setIsPoliciesLoading(true))
        ) {
          return;
        }

        try {
          const policiesUrl = new URL(
            "/api/smart-accounts/overview/policies",
            window.location.origin
          );
          const policies =
            await fetchSmartAccountGroup<SmartAccountPolicyOverview>(
              policiesUrl
            );
          if (!canCommitGroup("policies")) {
            return;
          }
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "policies",
            data: policies,
          });
          setOverview((current) =>
            current ? mergePolicyOverview(current, policies) : current
          );
        } catch (nextError) {
          if (!canCommitGroup("policies")) {
            return;
          }
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Failed to load smart-account policies.";
          setScopedErrors((current) => ({
            ...current,
            policies: message,
          }));
        } finally {
          if (canCommitGroup("policies")) {
            setIsPoliciesLoading(false);
          }
        }
      };

      const loadProposals = async () => {
        if (
          canUseFreshCache &&
          isSmartAccountOverviewCacheGroupFresh(
            cachedPayload?.groups.proposals,
            SMART_ACCOUNT_OVERVIEW_GROUP_TTL_MS
          )
        ) {
          return;
        }

        if (shouldSkipSmartAccountProposalLoad(baseOverview)) {
          const proposals: SmartAccountProposalSnapshot[] = [];
          if (!canCommitGroup("proposals")) {
            return;
          }
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "proposals",
            data: proposals,
          });
          setOverview((current) =>
            current
              ? {
                  ...current,
                  proposals,
                  fetchedAt: Date.now(),
                }
              : current
          );
          return;
        }

        if (
          !commitGroupIfCurrent("proposals", () => setIsProposalsLoading(true))
        ) {
          return;
        }

        try {
          const proposalsUrl = new URL(
            "/api/smart-accounts/overview/proposals",
            window.location.origin
          );
          const proposals = await fetchSmartAccountGroup<
            SmartAccountProposalSnapshot[]
          >(proposalsUrl);
          if (!canCommitGroup("proposals")) {
            return;
          }
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "proposals",
            data: proposals,
          });
          setOverview((current) =>
            current
              ? {
                  ...current,
                  proposals,
                  fetchedAt: Date.now(),
                }
              : current
          );
        } catch (nextError) {
          if (!canCommitGroup("proposals")) {
            return;
          }
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Failed to load smart-account proposals.";
          setScopedErrors((current) => ({
            ...current,
            proposals: message,
          }));
        } finally {
          if (canCommitGroup("proposals")) {
            setIsProposalsLoading(false);
          }
        }
      };

      const loadBestApyReserves = async () => {
        if (
          cachedBestApyReserves?.riskProfile ===
            DEFAULT_BEST_APY_RESERVES_RISK_PROFILE &&
          canUseFreshCache &&
          isSmartAccountOverviewCacheGroupFresh(
            cachedPayload?.groups.bestApyReserves,
            SMART_ACCOUNT_BEST_APY_RESERVES_TTL_MS
          )
        ) {
          commitGroupIfCurrent("bestApyReserves", () =>
            setBestApyReservesByStablecoin(cachedBestApyReserves)
          );
          return;
        }

        if (
          !commitGroupIfCurrent("bestApyReserves", () =>
            setIsBestApyReservesLoading(true)
          )
        ) {
          return;
        }

        try {
          const bestApyReservesUrl = new URL(
            "/api/smart-accounts/overview/best-apy-reserves",
            window.location.origin
          );
          bestApyReservesUrl.searchParams.set(
            "riskProfile",
            DEFAULT_BEST_APY_RESERVES_RISK_PROFILE
          );
          const reserves = await fetchSmartAccountGroup<
            CurrentBestApyReserveByStablecoinSnapshot[]
          >(bestApyReservesUrl);
          if (!canCommitGroup("bestApyReserves")) {
            return;
          }
          const cacheValue: CurrentBestApyReserveByStablecoinCache = {
            riskProfile: DEFAULT_BEST_APY_RESERVES_RISK_PROFILE,
            reserves,
          };

          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "bestApyReserves",
            data: cacheValue,
          });
          setBestApyReservesByStablecoin(cacheValue);
        } catch (nextError) {
          if (!canCommitGroup("bestApyReserves")) {
            return;
          }
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Failed to load current best APY reserves.";
          setScopedErrors((current) => ({
            ...current,
            bestApyReserves: message,
          }));
        } finally {
          if (canCommitGroup("bestApyReserves")) {
            setIsBestApyReservesLoading(false);
          }
        }
      };

      await Promise.allSettled([
        loadVaults(),
        loadPolicies(),
        loadEarnState(),
        loadProposals(),
        loadBestApyReserves(),
      ]);
    },
    [
      loadVaultSnapshots,
      smartAccountScopeGeneration,
      smartAccountScopeSnapshot,
      solanaEnv,
      user?.settingsPda,
    ]
  );

  const refreshEarnState = useCallback(async () => {
    const requestedScope = smartAccountScopeSnapshot;
    const orderToken = refreshOrderRef.current.begin("earn");
    if (!smartAccountScopeGeneration.isCurrent(requestedScope)) {
      return;
    }
    const runId = earnStateRefreshRunIdRef.current + 1;
    earnStateRefreshRunIdRef.current = runId;
    const canCommit = () =>
      smartAccountScopeGeneration.isCurrent(requestedScope) &&
      earnStateRefreshRunIdRef.current === runId &&
      refreshOrderRef.current.isCurrent(orderToken);
    const requestedSettingsPda = user?.settingsPda ?? null;
    if (!requestedSettingsPda) {
      if (canCommit()) {
        setEarnState(null);
        setHasEarnStateResolved(true);
        setIsEarnStateLoading(false);
      }
      return;
    }

    setIsEarnStateLoading(true);
    try {
      const nextEarnState = await fetchEarnState({ strict: true });
      if (!canCommit()) {
        return;
      }
      setEarnState(nextEarnState);
      if (nextEarnState) {
        setOverview((current) =>
          current ? mergeEarnVaultIntoOverview(current, nextEarnState) : current
        );
      }
    } finally {
      if (canCommit()) {
        setHasEarnStateResolved(true);
        setIsEarnStateLoading(false);
      }
    }
  }, [
    smartAccountScopeGeneration,
    smartAccountScopeSnapshot,
    user?.settingsPda,
  ]);

  useEffect(() => {
    setHasEarnStateResolved(!user?.settingsPda);
    setEarnState(null);
  }, [smartAccountScope, user?.settingsPda]);

  useEffect(() => {
    const policyFollowUp = policyFollowUpRef.current;
    setSelectedVaultIndex(0);
    setVaultActivityByAccountIndex({});
    setSignerPortfolioByAddress({});
    setIsBaseLoading(false);
    setIsVaultsLoading(false);
    setIsPoliciesLoading(false);
    setIsProposalsLoading(false);
    setIsEarnStateLoading(false);
    vaultActivityLoadPromisesRef.current.clear();
    signerPortfolioLoadPromisesRef.current.clear();
    signerActivityLoadPromisesRef.current.clear();
    groupRefreshSingleflightRef.current.clear();
    refreshOrderRef.current.clear();
    policyFollowUp.reset();
    pendingVaultInvalidationAddressesRef.current.clear();
    earnAutodepositSetupPreparePromisesRef.current.clear();
    earnAutodepositSetupBatchPreparePromisesRef.current.clear();
    return () => policyFollowUp.reset();
  }, [smartAccountScope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadVaultActivity = useCallback(
    async (
      accountIndex: number,
      loadOptions?: SmartAccountDetailLoadOptions
    ) => {
      if (!user?.settingsPda) {
        return;
      }

      const requestedScope = smartAccountScopeSnapshot;
      const isCurrent = loadOptions?.isCurrent ?? (() => true);
      if (
        !smartAccountScopeGeneration.isCurrent(requestedScope) ||
        !isCurrent()
      ) {
        return;
      }
      const promiseKey = `${requestedScope.scope}:${requestedScope.generation}:${accountIndex}`;
      const forceRefresh = loadOptions?.forceRefresh ?? false;
      const existingPromise =
        vaultActivityLoadPromisesRef.current.get(promiseKey);
      if (existingPromise && !forceRefresh) {
        return existingPromise;
      }

      const promise = (async () => {
        const url = new URL(
          "/api/smart-accounts/vault-activity",
          window.location.origin
        );
        url.searchParams.set("accountIndex", String(accountIndex));
        if (forceRefresh) {
          url.searchParams.set("forceRefresh", "1");
        }
        const response = await fetch(url.toString(), {
          credentials: "include",
        });

        if (!response.ok) {
          const errorPayload = (await response
            .json()
            .catch(() => null)) as SmartAccountRouteErrorResponse | null;
          const message =
            errorPayload?.error?.message ?? "Failed to load vault activity.";

          throw new Error(message);
        }

        const payload =
          (await response.json()) as SmartAccountVaultActivityRouteResponse;
        if (
          !smartAccountScopeGeneration.isCurrent(requestedScope) ||
          !isCurrent()
        ) {
          return;
        }
        const vault = overview?.vaults.find(
          (entry) => entry.accountIndex === payload.accountIndex
        );

        if (!vault) {
          return;
        }

        const solPriceUsd =
          vault.portfolio.totals.effectiveSolPriceUsd ??
          resolvePositionByMint(vault.portfolio.positions, NATIVE_SOL_MINT)
            ?.priceUsd ??
          85;
        const activityView = mapVaultActivityPageToView(
          payload.activity,
          vault.portfolio.positions,
          solPriceUsd
        );
        setVaultActivityByAccountIndex((current) => ({
          ...current,
          [payload.accountIndex]: activityView,
        }));
      })();

      vaultActivityLoadPromisesRef.current.set(promiseKey, promise);

      try {
        await promise;
      } finally {
        if (vaultActivityLoadPromisesRef.current.get(promiseKey) === promise) {
          vaultActivityLoadPromisesRef.current.delete(promiseKey);
        }
      }
    },
    [
      overview?.vaults,
      smartAccountScopeGeneration,
      smartAccountScopeSnapshot,
      user?.settingsPda,
    ]
  );

  const loadSignerPortfolio = useCallback(
    async (
      signerAddress: string,
      loadOptions?: SmartAccountDetailLoadOptions
    ) => {
      if (!signerAddress) {
        return;
      }

      const requestedScope = smartAccountScopeSnapshot;
      const isCurrent = loadOptions?.isCurrent ?? (() => true);
      if (
        !smartAccountScopeGeneration.isCurrent(requestedScope) ||
        !isCurrent()
      ) {
        return;
      }
      const promiseKey = `${requestedScope.scope}:${requestedScope.generation}:${signerAddress}`;
      const forceRefresh = loadOptions?.forceRefresh ?? false;
      const existing = signerPortfolioLoadPromisesRef.current.get(promiseKey);
      if (existing && !forceRefresh) {
        return existing;
      }

      const promise = (async () => {
        if (
          !smartAccountScopeGeneration.isCurrent(requestedScope) ||
          !isCurrent()
        )
          return;
        setSignerPortfolioByAddress((current) => ({
          ...current,
          [signerAddress]: {
            ...(current[signerAddress] ?? EMPTY_SIGNER_PORTFOLIO_VIEW),
            isLoading: true,
            error: null,
          },
        }));

        try {
          const publicKey = new PublicKey(signerAddress);
          const portfolio = await walletDataClient.getPortfolio(publicKey, {
            forceRefresh,
          });
          const tokenRows = mapVaultToTokenRows(
            portfolio.positions,
            undefined,
            stablecoinMints
          );

          if (
            !smartAccountScopeGeneration.isCurrent(requestedScope) ||
            !isCurrent()
          )
            return;
          setSignerPortfolioByAddress((current) => ({
            ...current,
            [signerAddress]: {
              ...(current[signerAddress] ?? EMPTY_SIGNER_PORTFOLIO_VIEW),
              tokenRows,
              isLoading: false,
              error: null,
            },
          }));
        } catch (err) {
          if (
            !smartAccountScopeGeneration.isCurrent(requestedScope) ||
            !isCurrent()
          )
            return;
          setSignerPortfolioByAddress((current) => ({
            ...current,
            [signerAddress]: {
              ...(current[signerAddress] ?? EMPTY_SIGNER_PORTFOLIO_VIEW),
              isLoading: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to load signer portfolio.",
            },
          }));
          console.error("[smart-account] failed to load signer portfolio", err);
        }
      })();

      signerPortfolioLoadPromisesRef.current.set(promiseKey, promise);

      try {
        await promise;
      } finally {
        if (
          signerPortfolioLoadPromisesRef.current.get(promiseKey) === promise
        ) {
          signerPortfolioLoadPromisesRef.current.delete(promiseKey);
        }
      }
    },
    [
      smartAccountScopeGeneration,
      smartAccountScopeSnapshot,
      stablecoinMints,
      walletDataClient,
    ]
  );

  const loadSignerActivity = useCallback(
    async (
      signerAddress: string,
      loadOptions?: SmartAccountDetailLoadOptions
    ) => {
      if (!signerAddress) {
        return;
      }

      const requestedScope = smartAccountScopeSnapshot;
      const isCurrent = loadOptions?.isCurrent ?? (() => true);
      if (
        !smartAccountScopeGeneration.isCurrent(requestedScope) ||
        !isCurrent()
      ) {
        return;
      }
      const promiseKey = `${requestedScope.scope}:${requestedScope.generation}:${signerAddress}`;
      const forceRefresh = loadOptions?.forceRefresh ?? false;
      const existing = signerActivityLoadPromisesRef.current.get(promiseKey);
      if (existing && !forceRefresh) {
        return existing;
      }

      const promise = (async () => {
        try {
          const publicKey = new PublicKey(signerAddress);
          const [portfolio, activityPage] = await Promise.all([
            walletDataClient.getPortfolio(publicKey, { forceRefresh }),
            walletDataClient.getActivity(publicKey, {
              limit: 30,
              forceRefresh,
            }),
          ]);
          const solPriceUsd = resolveSolPriceUsd({
            effectiveSolPriceUsd: portfolio.totals.effectiveSolPriceUsd,
            positions: portfolio.positions,
          });
          const { activityRows, transactionDetails } =
            mapVaultActivityPageToView(
              activityPage,
              portfolio.positions,
              solPriceUsd
            );

          if (
            !smartAccountScopeGeneration.isCurrent(requestedScope) ||
            !isCurrent()
          )
            return;
          setSignerPortfolioByAddress((current) => {
            const previous =
              current[signerAddress] ?? EMPTY_SIGNER_PORTFOLIO_VIEW;
            return {
              ...current,
              [signerAddress]: {
                ...previous,
                activityRows,
                transactionDetails,
                hasLoadedActivity: true,
                error: null,
              },
            };
          });
        } catch (err) {
          if (
            !smartAccountScopeGeneration.isCurrent(requestedScope) ||
            !isCurrent()
          )
            return;
          setSignerPortfolioByAddress((current) => ({
            ...current,
            [signerAddress]: {
              ...(current[signerAddress] ?? EMPTY_SIGNER_PORTFOLIO_VIEW),
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to load signer activity.",
            },
          }));
          console.error("[smart-account] failed to load signer activity", err);
        }
      })();

      signerActivityLoadPromisesRef.current.set(promiseKey, promise);

      try {
        await promise;
      } finally {
        if (signerActivityLoadPromisesRef.current.get(promiseKey) === promise) {
          signerActivityLoadPromisesRef.current.delete(promiseKey);
        }
      }
    },
    [smartAccountScopeGeneration, smartAccountScopeSnapshot, walletDataClient]
  );

  const refreshGroups = useCallback(
    async (request: SmartAccountRefreshGroupsRequest): Promise<void> => {
      const settingsPda = user?.settingsPda ?? null;
      if (!settingsPda) {
        return;
      }

      const requestedScope = smartAccountScopeSnapshot;
      const groups = Array.from(new Set(request.groups));
      const groupSet = new Set(groups);
      const forceRefreshGroups = new Set(request.forceRefreshGroups ?? []);
      const orderTokens = new Map<
        SmartAccountRefreshGroup,
        SmartAccountRefreshOrderToken
      >();
      for (const group of groups) {
        orderTokens.set(group, refreshOrderRef.current.begin(group));
      }
      const canCommit = (group: SmartAccountRefreshGroup) => {
        const token = orderTokens.get(group);
        return Boolean(
          token &&
            smartAccountScopeGeneration.isCurrent(requestedScope) &&
            refreshOrderRef.current.isCurrent(token)
        );
      };
      if (
        !smartAccountScopeGeneration.isCurrent(requestedScope) ||
        groups.length === 0
      ) {
        return;
      }
      const accountIndexes = Array.from(new Set(request.accountIndexes ?? []));
      const signerAddresses = Array.from(
        new Set((request.signerAddresses ?? []).filter(Boolean))
      );
      const shouldRefreshAuthenticatedWallet =
        groupSet.has("wallet") && request.refreshAuthenticatedWallet !== false;
      const connectedWallet = shouldRefreshAuthenticatedWallet
        ? wallet.publicKey?.toBase58() ?? null
        : null;
      const shouldInvalidateVaultData =
        groupSet.has("vaults") ||
        groupSet.has("activity") ||
        groupSet.has("wallet");
      const vaultAddresses = (shouldInvalidateVaultData ? accountIndexes : [])
        .map(
          (accountIndex) =>
            overview?.vaults.find(
              (entry) => entry.accountIndex === accountIndex
            )?.address ?? null
        )
        .filter((value): value is string => Boolean(value));
      const invalidateAddresses = Array.from(
        new Set(
          [
            connectedWallet,
            ...vaultAddresses,
            ...(groupSet.has("activity") || groupSet.has("wallet")
              ? signerAddresses
              : []),
          ].filter((value): value is string => Boolean(value))
        )
      );

      if (invalidateAddresses.length > 0) {
        walletDataClient.invalidateCaches({
          portfolio: invalidateAddresses,
          activity: invalidateAddresses,
        });
      }
      if (groupSet.has("vaults") && canCommit("vaults")) {
        for (const address of invalidateAddresses) {
          pendingVaultInvalidationAddressesRef.current.add(address);
        }
      }

      const runScopedRefresh = (
        suffix: string,
        loader: () => Promise<void>
      ) => {
        const key = `${requestedScope.scope}:${requestedScope.generation}:${suffix}`;
        return groupRefreshSingleflightRef.current.run(key, loader);
      };

      const loadBase = async () => {
        if (!canCommit("base")) return;
        setIsBaseLoading(true);
        try {
          const url = new URL(
            "/api/smart-accounts/overview/base",
            window.location.origin
          );
          const base = await fetchSmartAccountGroup<SmartAccountOverviewBase>(
            url
          );
          if (!canCommit("base")) return;
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "base",
            data: base,
          });
          setOverview((current) => {
            if (current?.settingsPda === settingsPda) {
              return mergeBaseOverview(current, base);
            }
            return mergeCachedGroupsOntoOverview(
              createOverviewFromBase(base),
              readSmartAccountOverviewCache({ settingsPda, solanaEnv }),
              { includeVaultSnapshots: loadVaultSnapshots }
            );
          });
          setScopedErrors((current) => ({ ...current, base: null }));
        } catch (nextError) {
          if (!canCommit("base")) return;
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Failed to load smart-account overview.";
          setScopedErrors((current) => ({ ...current, base: message }));
          throw nextError;
        } finally {
          if (canCommit("base")) setIsBaseLoading(false);
        }
      };

      const loadPolicies = async () => {
        if (!canCommit("policies")) return;
        setIsPoliciesLoading(true);
        try {
          const url = new URL(
            "/api/smart-accounts/overview/policies",
            window.location.origin
          );
          if (forceRefreshGroups.has("policies")) {
            url.searchParams.set("forceRefresh", "1");
          }
          const policies =
            await fetchSmartAccountGroup<SmartAccountPolicyOverview>(url);
          if (!canCommit("policies")) return;
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "policies",
            data: policies,
          });
          setOverview((current) =>
            current?.settingsPda === settingsPda
              ? mergePolicyOverview(current, policies)
              : current
          );
          setScopedErrors((current) => ({ ...current, policies: null }));
        } catch (nextError) {
          if (!canCommit("policies")) return;
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Failed to load smart-account policies.";
          setScopedErrors((current) => ({ ...current, policies: message }));
          throw nextError;
        } finally {
          if (canCommit("policies")) setIsPoliciesLoading(false);
        }
      };

      const loadProposals = async () => {
        if (!canCommit("proposals")) return;
        setIsProposalsLoading(true);
        try {
          const url = new URL(
            "/api/smart-accounts/overview/proposals",
            window.location.origin
          );
          const proposals = await fetchSmartAccountGroup<
            SmartAccountProposalSnapshot[]
          >(url);
          if (!canCommit("proposals")) return;
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "proposals",
            data: proposals,
          });
          setOverview((current) =>
            current?.settingsPda === settingsPda
              ? { ...current, proposals, fetchedAt: Date.now() }
              : current
          );
          setScopedErrors((current) => ({ ...current, proposals: null }));
        } catch (nextError) {
          if (!canCommit("proposals")) return;
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Failed to load smart-account proposals.";
          setScopedErrors((current) => ({ ...current, proposals: message }));
          throw nextError;
        } finally {
          if (canCommit("proposals")) setIsProposalsLoading(false);
        }
      };

      const loadVaults = async () => {
        if (!canCommit("vaults")) return;
        setIsVaultsLoading(true);
        let pendingInvalidationAddresses: string[] = [];
        try {
          pendingInvalidationAddresses = Array.from(
            pendingVaultInvalidationAddressesRef.current
          );
          pendingVaultInvalidationAddressesRef.current.clear();
          const cachedBase = readSmartAccountOverviewCache({
            settingsPda,
            solanaEnv,
          })?.groups.base?.data;
          const url = new URL(
            "/api/smart-accounts/overview/vaults",
            window.location.origin
          );
          url.searchParams.set(
            "accountUtilization",
            String(
              cachedBase?.accountUtilization ??
                Math.max(0, (overview?.vaults.length ?? 1) - 1)
            )
          );
          if (pendingInvalidationAddresses.length > 0) {
            url.searchParams.set(
              "invalidate",
              pendingInvalidationAddresses.join(",")
            );
          }
          const vaults = await fetchSmartAccountGroup<
            SmartAccountVaultSnapshot[]
          >(url);
          if (!canCommit("vaults")) return;
          writeSmartAccountOverviewCacheGroup({
            settingsPda,
            solanaEnv,
            group: "vaults",
            data: vaults,
          });
          setOverview((current) =>
            current?.settingsPda === settingsPda
              ? mergeVaultSnapshots(current, vaults)
              : current
          );
          setScopedErrors((current) => ({ ...current, vaults: null }));
        } catch (nextError) {
          if (!canCommit("vaults")) return;
          for (const address of pendingInvalidationAddresses) {
            pendingVaultInvalidationAddressesRef.current.add(address);
          }
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Failed to load vault balances.";
          setScopedErrors((current) => ({ ...current, vaults: message }));
          throw nextError;
        } finally {
          if (canCommit("vaults")) setIsVaultsLoading(false);
        }
      };

      const groupTasks = groups.flatMap((group) => {
        if (group === "base") return runScopedRefresh(group, loadBase);
        if (group === "policies") return runScopedRefresh(group, loadPolicies);
        if (group === "proposals")
          return runScopedRefresh(group, loadProposals);
        if (group === "vaults") return runScopedRefresh(group, loadVaults);
        if (group === "earn") return runScopedRefresh(group, refreshEarnState);
        return [];
      });

      const detailTasks: Promise<unknown>[] = [];
      if (groupSet.has("activity")) {
        for (const accountIndex of accountIndexes) {
          detailTasks.push(
            runScopedRefresh(`activity:vault:${accountIndex}`, () =>
              loadVaultActivity(accountIndex, {
                forceRefresh: true,
                isCurrent: () => canCommit("activity"),
              })
            )
          );
        }
        for (const address of signerAddresses) {
          const entry = signerPortfolioByAddress[address];
          if (entry?.hasLoadedActivity) {
            detailTasks.push(
              runScopedRefresh(`activity:signer:${address}`, () =>
                loadSignerActivity(address, {
                  forceRefresh: true,
                  isCurrent: () => canCommit("activity"),
                })
              )
            );
          }
        }
      }

      if (groupSet.has("wallet")) {
        const reloadCandidates = new Set(signerAddresses);
        if (connectedWallet) reloadCandidates.add(connectedWallet);
        for (const address of reloadCandidates) {
          if (!signerPortfolioByAddress[address]) continue;
          detailTasks.push(
            runScopedRefresh(`wallet:signer:${address}`, () =>
              loadSignerPortfolio(address, {
                forceRefresh: true,
                isCurrent: () => canCommit("wallet"),
              })
            )
          );
        }
        const onAfter = shouldRefreshAuthenticatedWallet
          ? onAfterTxRef.current
          : null;
        if (onAfter) {
          detailTasks.push(
            runScopedRefresh("wallet:authenticated", async () => {
              if (!canCommit("wallet")) return;
              await onAfter({ isCurrent: () => canCommit("wallet") });
            })
          );
        }
      }

      await Promise.all([...groupTasks, ...detailTasks]);
    },
    [
      loadSignerActivity,
      loadSignerPortfolio,
      loadVaultActivity,
      loadVaultSnapshots,
      overview?.vaults,
      refreshEarnState,
      signerPortfolioByAddress,
      smartAccountScopeGeneration,
      smartAccountScopeSnapshot,
      solanaEnv,
      user?.settingsPda,
      wallet.publicKey,
      walletDataClient,
    ]
  );

  const refreshMutationPlan = useCallback(
    async (plan: SmartAccountRefreshPlan): Promise<void> => {
      const includesPolicies = plan.groups.includes("policies");
      const requestedScope = smartAccountScopeSnapshot;
      if (includesPolicies) {
        policyFollowUpRef.current.reset();
      }
      try {
        await refreshGroups({
          ...plan,
          forceRefreshGroups: includesPolicies ? ["policies"] : [],
        });
      } finally {
        if (
          includesPolicies &&
          smartAccountScopeGeneration.isCurrent(requestedScope)
        ) {
          policyFollowUpRef.current.schedule(
            () => {
              if (!smartAccountScopeGeneration.isCurrent(requestedScope)) {
                return;
              }
              return refreshGroups({
                forceRefreshGroups: ["policies"],
                groups: ["policies"],
                refreshAuthenticatedWallet: false,
              });
            },
            (error) => {
              console.warn(
                "[smart-account] policy consistency refresh failed",
                error
              );
            }
          );
        }
      }
    },
    [refreshGroups, smartAccountScopeGeneration, smartAccountScopeSnapshot]
  );

  const refreshAfterTx = useCallback(
    async (args: {
      accountIndex?: number;
      groups?: readonly SmartAccountRefreshGroup[];
      refreshAuthenticatedWallet?: boolean;
      signerAddresses?: string[];
    }): Promise<void> => {
      await refreshGroups({
        groups: args.groups ?? ["wallet"],
        accountIndexes:
          args.accountIndex === undefined ? [] : [args.accountIndex],
        signerAddresses: args.signerAddresses,
        refreshAuthenticatedWallet: args.refreshAuthenticatedWallet,
      });
    },
    [refreshGroups]
  );

  const queueMutationRefresh = useCallback(
    (plan: SmartAccountRefreshPlan, label: string) => {
      void refreshMutationPlan(plan).catch((err) => {
        console.warn(`[smart-account] ${label} refresh failed`, err);
      });
    },
    [refreshMutationPlan]
  );

  const patchSettingsTransactionIndex = useCallback(
    (transactionIndex: bigint | number | string | undefined) => {
      if (transactionIndex === undefined || !user?.settingsPda) return;
      const nextIndex = String(transactionIndex);
      const shouldReplace = (currentIndex: string) => {
        try {
          return BigInt(nextIndex) > BigInt(currentIndex);
        } catch {
          return nextIndex !== currentIndex;
        }
      };

      setOverview((current) => {
        if (!current || current.settingsPda !== user.settingsPda) {
          return current;
        }

        return shouldReplace(current.transactionIndex)
          ? { ...current, transactionIndex: nextIndex }
          : current;
      });

      const cachedBase = readSmartAccountOverviewCache({
        settingsPda: user.settingsPda,
        solanaEnv,
      })?.groups.base?.data;
      if (cachedBase && shouldReplace(cachedBase.transactionIndex)) {
        writeSmartAccountOverviewCacheGroup({
          settingsPda: user.settingsPda,
          solanaEnv,
          group: "base",
          data: { ...cachedBase, transactionIndex: nextIndex },
        });
      }
    },
    [solanaEnv, user?.settingsPda]
  );

  const vaultEntries = useMemo<SmartAccountVaultEntry[]>(() => {
    return (overview?.vaults ?? []).map((vault) => {
      const balance = splitUsd(vault.portfolio.totals.totalUsd);
      const solPriceUsd = resolveSolPriceUsd({
        effectiveSolPriceUsd: vault.portfolio.totals.effectiveSolPriceUsd,
        positions: vault.portfolio.positions,
      });
      const signers = mapSignersToEntries({
        signers: vault.signers ?? [],
        authenticatedWalletAddress: user?.walletAddress,
        authenticatedUserCashUsd,
        authenticatedUserTotalUsd,
        solPriceUsd,
        spendingLimits: vault.spendingLimits ?? [],
      });

      return {
        accountIndex: vault.accountIndex,
        label: "Stash",
        address: vault.address,
        totalUsd: vault.portfolio.totals.totalUsd,
        balanceWhole: balance.whole,
        balanceFraction: balance.fraction,
        signers,
      };
    });
  }, [
    overview?.vaults,
    user?.walletAddress,
    authenticatedUserCashUsd,
    authenticatedUserTotalUsd,
  ]);

  const totalUsd = useMemo(
    () =>
      getSmartAccountTotalUsd({
        authenticatedWalletAddress: user?.walletAddress,
        vaultEntries,
      }),
    [user?.walletAddress, vaultEntries]
  );

  const vaultMintsSignature = useMemo(() => {
    const allPositions = (overview?.vaults ?? []).flatMap(
      (vault) => vault.portfolio.positions
    );
    return createTokenMarketMintsSignature(allPositions);
  }, [overview?.vaults]);

  const [vaultPriceChange24hByMint, setVaultPriceChange24hByMint] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());

  useEffect(() => {
    if (!vaultMintsSignature) {
      setVaultPriceChange24hByMint(new Map());
      return;
    }

    let cancelled = false;
    void fetchTokenMarkets(vaultMintsSignature)
      .then(({ markets }) => {
        if (cancelled) return;
        const next = new Map<string, number>();
        for (const market of markets) {
          if (
            typeof market.priceChange24hPercent === "number" &&
            Number.isFinite(market.priceChange24hPercent)
          ) {
            next.set(market.mint, market.priceChange24hPercent);
          }
        }
        setVaultPriceChange24hByMint(next);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn(
          "[smart-account-sidebar] failed to fetch token markets",
          error
        );
      });

    return () => {
      cancelled = true;
    };
  }, [vaultMintsSignature]);

  const selectedVault = useMemo<SmartAccountVaultView | null>(() => {
    const vault =
      overview?.vaults.find(
        (entry) => entry.accountIndex === selectedVaultIndex
      ) ??
      overview?.vaults[0] ??
      null;

    if (!vault) {
      return null;
    }

    const fallbackBalance = splitUsd(vault.portfolio.totals.totalUsd);
    const entry = vaultEntries.find(
      (candidate) => candidate.accountIndex === vault.accountIndex
    ) ?? {
      accountIndex: vault.accountIndex,
      label: "Stash",
      address: vault.address,
      totalUsd: vault.portfolio.totals.totalUsd,
      balanceWhole: fallbackBalance.whole,
      balanceFraction: fallbackBalance.fraction,
      signers: mapSignersToEntries({
        signers: vault.signers ?? [],
        authenticatedWalletAddress: user?.walletAddress,
        authenticatedUserCashUsd,
        authenticatedUserTotalUsd,
        solPriceUsd: resolveSolPriceUsd({
          effectiveSolPriceUsd: vault.portfolio.totals.effectiveSolPriceUsd,
          positions: vault.portfolio.positions,
        }),
        spendingLimits: vault.spendingLimits ?? [],
      }),
    };
    const tokenRows = mapVaultToTokenRows(
      vault.portfolio.positions,
      vaultPriceChange24hByMint,
      stablecoinMints
    );
    const cashTokenRows = tokenRows.filter((row) =>
      isStablecoinMint(row.id?.replace(/-secured$/, ""), stablecoinMints)
    );
    const investmentTokenRows = tokenRows.filter(
      (row) =>
        !isStablecoinMint(row.id?.replace(/-secured$/, ""), stablecoinMints)
    );
    const activityView =
      vaultActivityByAccountIndex[vault.accountIndex] ??
      mapVaultToActivityView(vault);

    return {
      entry: {
        accountIndex: entry.accountIndex,
        label: entry.label,
        address: entry.address,
        totalUsd: entry.totalUsd,
        balanceWhole: entry.balanceWhole,
        balanceFraction: entry.balanceFraction,
        signers: entry.signers,
      },
      positions: vault.portfolio.positions,
      tokenRows,
      cashTokenRows,
      investmentTokenRows,
      activityRows: activityView.activityRows,
      transactionDetails: activityView.transactionDetails,
      spendingLimits: vault.spendingLimits ?? [],
    };
  }, [
    overview?.vaults,
    selectedVaultIndex,
    user?.walletAddress,
    authenticatedUserCashUsd,
    authenticatedUserTotalUsd,
    stablecoinMints,
    vaultActivityByAccountIndex,
    vaultEntries,
    vaultPriceChange24hByMint,
  ]);

  const approvals = useMemo(
    () =>
      [...(overview?.proposals ?? [])]
        .sort(compareProposalSnapshotsByRecency)
        .map(mapProposalToApprovalItem),
    [overview?.proposals]
  );

  const runProposalAction = useCallback(
    async (
      proposal: SmartAccountProposalSnapshot,
      action: "approve" | "reject" | "execute"
    ) => {
      if (!overview) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (!wallet.publicKey || !user?.walletAddress) {
        throw new Error(
          "Connect the authenticated wallet to sign this action."
        );
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        throw new Error(
          "Connected wallet does not match the authenticated wallet."
        );
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        throw new Error(
          "Connected wallet cannot sign smart-account transactions."
        );
      }

      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const sharedArgs = {
        settingsPda: new PublicKey(proposal.consensusAddress),
        transactionIndex: BigInt(proposal.transactionIndex),
        signer: wallet.publicKey,
        feePayer: wallet.publicKey,
      };
      const prepared =
        action === "approve"
          ? await client.prepareApproveProposal(sharedArgs)
          : action === "reject"
          ? await client.prepareRejectProposal(sharedArgs)
          : proposal.payloadType === "settings_transaction"
          ? await client.prepareExecuteSettingsProposal(sharedArgs)
          : proposal.payloadType === "policy_transaction"
          ? await client.prepareExecutePolicyProposal(sharedArgs)
          : proposal.payloadType === "transaction"
          ? await client.prepareExecuteProposal(sharedArgs)
          : (() => {
              throw new Error(
                "This proposal type cannot be executed from the wallet sidebar."
              );
            })();

      setIsActionPending(true);
      setPendingProposalId(proposal.proposalAddress);

      try {
        await sendPreparedWithWallet({
          connection,
          wallet: walletBridge,
          prepared,
          confirm: true,
        });
        const affectedSignerAddresses = Array.from(
          new Set(
            [proposal.creator, proposal.summary.destination].filter(
              (address): address is string => Boolean(address)
            )
          )
        );
        queueMutationRefresh(
          resolveSmartAccountMutationRefreshPlan({
            kind: "proposal_action",
            action,
            payloadType: proposal.payloadType,
            accountIndex: proposal.accountIndex ?? undefined,
            signerAddresses:
              affectedSignerAddresses.length > 0
                ? affectedSignerAddresses
                : undefined,
          }),
          "post-proposal"
        );
      } finally {
        setIsActionPending(false);
        setPendingProposalId(null);
      }
    },
    [connection, overview, queueMutationRefresh, user?.walletAddress, wallet]
  );

  const runSpendingLimitAction = useCallback(
    async (args: {
      actionKey: string;
      prepare: (
        client: ReturnType<typeof createSmartAccountVaultsClient>
      ) => Promise<{
        prepared: Parameters<typeof sendPreparedWithWallet>[0]["prepared"];
        transactionIndex?: bigint | number | string;
      }>;
      refreshKind: "policy" | "root" | "spending_limit_use";
      requireAuthenticatedWallet?: boolean;
      affected?: { accountIndex?: number; signerAddresses?: string[] };
    }) => {
      if (!overview) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (!wallet.publicKey) {
        throw new Error("Connect a wallet to sign this action.");
      }

      if (args.requireAuthenticatedWallet ?? true) {
        if (!user?.walletAddress) {
          throw new Error(
            "Connect the authenticated wallet to sign this action."
          );
        }

        if (wallet.publicKey.toBase58() !== user.walletAddress) {
          throw new Error(
            "Connected wallet does not match the authenticated wallet."
          );
        }
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        throw new Error(
          "Connected wallet cannot sign smart-account transactions."
        );
      }

      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const { prepared, transactionIndex } = await args.prepare(client);

      setIsActionPending(true);
      setPendingSpendingLimitActionKey(args.actionKey);

      try {
        try {
          await sendPreparedWithWallet({
            connection,
            wallet: walletBridge,
            prepared,
            confirm: true,
          });
        } catch (sendError) {
          throw await normalizeSpendingLimitError(sendError, connection);
        }
      } finally {
        setIsActionPending(false);
        setPendingSpendingLimitActionKey(null);
      }

      patchSettingsTransactionIndex(transactionIndex);
      queueMutationRefresh(
        args.refreshKind === "spending_limit_use"
          ? resolveSmartAccountMutationRefreshPlan({
              kind: "spending_limit_use",
              accountIndex: args.affected?.accountIndex ?? 0,
              signerAddresses: args.affected?.signerAddresses,
            })
          : resolveSmartAccountMutationRefreshPlan({
              kind: "settings_change",
              scope: args.refreshKind,
              threshold: overview.threshold ?? 1,
              signerAddresses: args.affected?.signerAddresses,
            }),
        "post-policy"
      );
    },
    [
      connection,
      overview,
      patchSettingsTransactionIndex,
      queueMutationRefresh,
      user?.walletAddress,
      wallet,
    ]
  );

  const setSignerSpendingLimitUsd = useCallback(
    async (args: {
      accountIndex: number;
      amountUsd: number;
      existingSpendingLimitAddress?: string | null;
      signerAddress: string;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (!Number.isFinite(args.amountUsd) || args.amountUsd <= 0) {
        throw new Error("Enter a spending limit greater than $0.");
      }

      const vault = overview.vaults.find(
        (entry) => entry.accountIndex === args.accountIndex
      );
      const existingSpendingLimit = args.existingSpendingLimitAddress
        ? vault?.spendingLimits.find(
            (entry) => entry.address === args.existingSpendingLimitAddress
          ) ??
          overview.spendingLimits.find(
            (entry) => entry.address === args.existingSpendingLimitAddress
          ) ??
          null
        : null;

      if (args.existingSpendingLimitAddress && !existingSpendingLimit) {
        throw new Error("Spending limit is not loaded. Refresh and try again.");
      }

      const conversion = resolveSpendingLimitUsdConversion({
        spendingLimit: existingSpendingLimit,
        vault,
      });

      if (!conversion.priceUsd) {
        throw new Error(
          `${conversion.symbol}/USD price is unavailable for this spending limit.`
        );
      }

      const amount = usdToTokenRawAmount({
        amountUsd: args.amountUsd,
        decimals: conversion.decimals,
        priceUsd: conversion.priceUsd,
      });

      await runSpendingLimitAction({
        actionKey: `set:${args.accountIndex}:${args.signerAddress}`,
        refreshKind: "policy",
        prepare: (client) =>
          client.prepareSetSpendingLimitPolicy({
            settingsPda: new PublicKey(overview.settingsPda),
            creator: wallet.publicKey!,
            feePayer: wallet.publicKey!,
            signer: new PublicKey(args.signerAddress),
            accountIndex: args.existingSpendingLimitAddress
              ? undefined
              : args.accountIndex,
            amount,
            period: args.existingSpendingLimitAddress ? undefined : "month",
            existingSpendingLimitPolicy: args.existingSpendingLimitAddress
              ? new PublicKey(args.existingSpendingLimitAddress)
              : null,
          }),
        affected: {
          accountIndex: args.accountIndex,
          signerAddresses: [args.signerAddress],
        },
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const addInitiateSigner = useCallback(
    async (args: {
      signerAddress: string;
      permissions?: SmartAccountSignerPermission[];
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      const signer = new PublicKey(args.signerAddress);
      const requestedPermissions = args.permissions ?? ["initiate"];
      const existingSigner = overview.policies
        .filter((policy) => policy.state === "SpendingLimit")
        .flatMap((policy) => policy.signers)
        .find((entry) => entry.address === signer.toBase58());

      if (existingSigner) {
        const existingMask = new Set(existingSigner.permissions);
        const wantsAll = requestedPermissions.every((perm) =>
          existingMask.has(perm)
        );
        if (wantsAll) {
          return;
        }
      }

      await runSpendingLimitAction({
        actionKey: `add-signer:${signer.toBase58()}`,
        refreshKind: "policy",
        prepare: (client) =>
          client.prepareAddInitiateSigner({
            settingsPda: new PublicKey(overview.settingsPda),
            creator: wallet.publicKey!,
            feePayer: wallet.publicKey!,
            signer,
            permissions: requestedPermissions,
          }),
        affected: { signerAddresses: [signer.toBase58()] },
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const updateSignerPermissions = useCallback(
    async (args: {
      signerAddress: string;
      permissions: SmartAccountSignerPermission[];
      /**
       * When set, the helper updates this signer's permissions inside a
       * SpendingLimit policy (PolicyUpdate). When omitted, the helper
       * updates the root signer entry on the settings PDA
       * (RemoveSigner+AddSigner). Root + policy live in different lists,
       * so the caller picks based on signer scope.
       */
      policyAddress?: string | null;
      accountIndex?: number;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (args.permissions.length === 0) {
        throw new Error("Signer must keep at least one permission.");
      }

      const signer = new PublicKey(args.signerAddress);
      const isPolicyScoped = Boolean(args.policyAddress);

      await runSpendingLimitAction({
        actionKey: `update-signer-permissions:${signer.toBase58()}`,
        refreshKind: isPolicyScoped ? "policy" : "root",
        prepare: (client) =>
          isPolicyScoped
            ? client.prepareUpdatePolicySignerPermissions({
                settingsPda: new PublicKey(overview.settingsPda),
                creator: wallet.publicKey!,
                feePayer: wallet.publicKey!,
                signer,
                permissions: args.permissions,
                policyPda: args.policyAddress
                  ? new PublicKey(args.policyAddress)
                  : null,
                accountIndex: args.accountIndex,
              })
            : client.prepareUpdateSignerPermissions({
                settingsPda: new PublicKey(overview.settingsPda),
                creator: wallet.publicKey!,
                feePayer: wallet.publicKey!,
                signer,
                permissions: args.permissions,
              }),
        affected: {
          accountIndex: args.accountIndex,
          signerAddresses: [signer.toBase58()],
        },
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const deleteSignerSpendingLimit = useCallback(
    async (args: {
      accountIndex: number;
      spendingLimitAddress: string;
      signerAddress: string;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      await runSpendingLimitAction({
        actionKey: `delete:${args.accountIndex}:${args.signerAddress}`,
        refreshKind: "policy",
        prepare: (client) =>
          client.prepareRemoveSpendingLimitPolicy({
            settingsPda: new PublicKey(overview.settingsPda),
            creator: wallet.publicKey!,
            feePayer: wallet.publicKey!,
            spendingLimitPolicy: new PublicKey(args.spendingLimitAddress),
          }),
        affected: {
          accountIndex: args.accountIndex,
          signerAddresses: [args.signerAddress],
        },
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const deleteSigner = useCallback(
    async (args: {
      accountIndex: number;
      policyAddress?: string | null;
      signerAddress: string;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      const policyAddress = args.policyAddress;
      if (!policyAddress) {
        throw new Error("Only constrained agent signers can be deleted here.");
      }

      await runSpendingLimitAction({
        actionKey: `delete-signer:${args.accountIndex}:${args.signerAddress}`,
        refreshKind: "policy",
        prepare: (client) =>
          client.prepareRemoveInitiateSigner({
            settingsPda: new PublicKey(overview.settingsPda),
            creator: wallet.publicKey!,
            feePayer: wallet.publicKey!,
            signer: new PublicKey(args.signerAddress),
            accountIndex: args.accountIndex,
            policyPda: new PublicKey(policyAddress),
          }),
        affected: {
          accountIndex: args.accountIndex,
          signerAddresses: [args.signerAddress],
        },
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const topUpSignerWithSpendingLimitUsd = useCallback(
    async (args: {
      accountIndex: number;
      amountUsd: number;
      signerAddress: string;
      spendingLimitAddress: string;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (!Number.isFinite(args.amountUsd) || args.amountUsd <= 0) {
        throw new Error("Enter a top-up amount greater than $0.");
      }

      const vault = overview.vaults.find(
        (entry) => entry.accountIndex === args.accountIndex
      );
      const spendingLimit =
        vault?.spendingLimits.find(
          (entry) => entry.address === args.spendingLimitAddress
        ) ??
        overview.spendingLimits.find(
          (entry) => entry.address === args.spendingLimitAddress
        ) ??
        null;

      if (!spendingLimit || spendingLimit.mint !== SOL_SPENDING_LIMIT_MINT) {
        throw new Error("A SOL spending limit is required for top-up.");
      }

      if (spendingLimit.isExpired) {
        throw new Error("This spending limit is expired.");
      }

      const connectedWalletAddress = wallet.publicKey.toBase58();
      const policySigner = overview.policies
        .find((policy) => policy.address === spendingLimit.address)
        ?.signers.find((signer) => signer.address === connectedWalletAddress);

      if (!policySigner?.canInitiate) {
        throw new Error(
          "Connected wallet is not authorized to use this spending limit. Connect a wallet listed on this spending-limit policy with proposal access, or add it to the policy first."
        );
      }

      const solPriceUsd = resolveVaultSolPriceUsd(vault);
      if (!solPriceUsd) {
        throw new Error("SOL/USD price is unavailable for this vault.");
      }

      const amount = usdToLamports(args.amountUsd, solPriceUsd);
      const remainingAmount = BigInt(spendingLimit.effectiveRemainingAmountRaw);

      if (amount > remainingAmount) {
        throw new Error("Top-up amount exceeds the remaining spending limit.");
      }

      await runSpendingLimitAction({
        actionKey: `topup:${args.accountIndex}:${args.signerAddress}`,
        refreshKind: "spending_limit_use",
        prepare: async (client) => ({
          prepared: await client.prepareUseSolSpendingLimitPolicy({
            settingsPda: new PublicKey(overview.settingsPda),
            feePayer: wallet.publicKey!,
            signer: wallet.publicKey!,
            spendingLimitPolicy: new PublicKey(args.spendingLimitAddress),
            destination: new PublicKey(args.signerAddress),
            accountIndex: args.accountIndex,
            amountLamports: amount,
          }),
        }),
        requireAuthenticatedWallet: false,
        affected: {
          accountIndex: args.accountIndex,
          signerAddresses: [args.signerAddress],
        },
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const evaluateVaultTransferCapability = useCallback(
    (args: {
      accountIndex: number;
      mint: string;
      amountRaw: bigint;
      recipientAddress?: string;
    }): VaultTransferCapability => {
      if (!overview || !wallet.publicKey) {
        return { kind: "blocked", reason: "Smart account not loaded yet" };
      }

      const connectedAddress = wallet.publicKey.toBase58();
      const vault = overview.vaults.find(
        (entry) => entry.accountIndex === args.accountIndex
      );
      if (!vault) {
        return { kind: "blocked", reason: "Stash not found" };
      }

      const isSol = args.mint === NATIVE_SOL_MINT;
      const spendingLimitMint = isSol ? SOL_SPENDING_LIMIT_MINT : args.mint;
      const coveringSpendingLimit = vault.spendingLimits.find(
        (limit) =>
          !limit.isExpired &&
          limit.mint === spendingLimitMint &&
          limit.signers.includes(connectedAddress) &&
          BigInt(limit.effectiveRemainingAmountRaw) >= args.amountRaw &&
          (limit.destinations.length === 0 ||
            (args.recipientAddress
              ? limit.destinations.includes(args.recipientAddress)
              : true))
      );

      if (coveringSpendingLimit) {
        if (!isSol) {
          return {
            kind: "blocked",
            reason:
              "Agent SPL transfers via spending limit are not supported yet",
          };
        }
        return {
          kind: "spending-limit",
          spendingLimitAddress: coveringSpendingLimit.address,
          mint: args.mint,
        };
      }

      const settingsSigner = overview.signers.find(
        (signer) =>
          signer.scope === "settings" &&
          signer.address === connectedAddress &&
          signer.canInitiate
      );

      if (settingsSigner) {
        const threshold = overview.threshold ?? 1;
        return {
          kind: "settings",
          threshold,
          // threshold-1 needs propose+approve+execute; threshold>1 only proposes.
          expectedSigns: threshold <= 1 ? 3 : 1,
        };
      }

      return {
        kind: "blocked",
        reason:
          "Connected wallet isn't authorized to send from this vault. Connect a vault signer or ask the owner to grant a spending limit.",
      };
    },
    [overview, wallet.publicKey]
  );

  const executeVaultTransfer = useCallback(
    async (request: VaultTransferRequest): Promise<VaultTransferResult> => {
      if (!overview || !wallet.publicKey) {
        return { success: false, error: "Smart account not loaded yet." };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const vault = overview.vaults.find(
        (entry) => entry.accountIndex === request.accountIndex
      );
      if (!vault) {
        return { success: false, error: "Stash not found." };
      }

      const position = vault.portfolio.positions.find(
        (entry) => entry.asset.mint === request.mint
      );
      if (!position || typeof position.asset.decimals !== "number") {
        return {
          success: false,
          error: `Unknown token decimals for mint ${request.mint}. Refresh the wallet and retry.`,
        };
      }
      const decimals = position.asset.decimals;

      let recipientPubkey: PublicKey;
      try {
        recipientPubkey = new PublicKey(request.recipientAddress);
      } catch {
        return { success: false, error: "Invalid recipient wallet address." };
      }

      if (!Number.isFinite(request.amount) || request.amount <= 0) {
        return {
          success: false,
          error: "Amount must be greater than 0.",
        };
      }

      const amountRaw = BigInt(
        Math.floor(request.amount * Math.pow(10, decimals))
      );
      if (amountRaw <= BigInt(0)) {
        return {
          success: false,
          error: "Amount is too small for this token's precision.",
        };
      }

      if (
        BigInt(Math.floor(position.publicBalance * Math.pow(10, decimals))) <
        amountRaw
      ) {
        return {
          success: false,
          error: "Stash balance is insufficient for this transfer.",
        };
      }

      const capability = evaluateVaultTransferCapability({
        accountIndex: request.accountIndex,
        mint: request.mint,
        amountRaw,
        recipientAddress: request.recipientAddress,
      });

      if (capability.kind === "blocked") {
        return { success: false, error: capability.reason };
      }

      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const settingsPda = new PublicKey(overview.settingsPda);
      const isSol = request.mint === NATIVE_SOL_MINT;

      try {
        if (capability.kind === "spending-limit") {
          const prepared = await client.prepareUseSolSpendingLimitPolicy({
            settingsPda,
            feePayer: wallet.publicKey,
            signer: wallet.publicKey,
            spendingLimitPolicy: new PublicKey(capability.spendingLimitAddress),
            destination: recipientPubkey,
            accountIndex: request.accountIndex,
            amountLamports: amountRaw,
          });
          const signature = await sendPreparedWithWallet({
            connection,
            wallet: walletBridge,
            prepared,
            confirm: true,
          });
          queueMutationRefresh(
            resolveSmartAccountMutationRefreshPlan({
              kind: "vault_transfer",
              execution: "spending_limit",
              accountIndex: request.accountIndex,
              signerAddresses: [request.recipientAddress],
            }),
            "post-transfer"
          );
          return { success: true, signature, status: "executed" };
        }

        // capability.kind === "settings"
        const proposeOp = isSol
          ? await client.prepareSolTransferProposal({
              settingsPda,
              creator: wallet.publicKey,
              feePayer: wallet.publicKey,
              destination: recipientPubkey,
              amountLamports: amountRaw,
              accountIndex: request.accountIndex,
            })
          : await client.prepareSplTransferProposal({
              settingsPda,
              creator: wallet.publicKey,
              feePayer: wallet.publicKey,
              mint: new PublicKey(request.mint),
              destinationOwner: recipientPubkey,
              amount: amountRaw,
              decimals,
              accountIndex: request.accountIndex,
              createDestinationAta: true,
            });

        const proposeSignature = await sendPreparedWithWallet({
          connection,
          wallet: walletBridge,
          prepared: proposeOp,
          confirm: true,
        });

        if (capability.threshold > 1) {
          queueMutationRefresh(
            resolveSmartAccountMutationRefreshPlan({
              kind: "vault_transfer",
              execution: "proposed",
              accountIndex: request.accountIndex,
              signerAddresses: [request.recipientAddress],
            }),
            "post-transfer-proposal"
          );
          return {
            success: true,
            signature: proposeSignature,
            status: "proposed",
          };
        }

        // threshold-1: read settings to learn the proposal's transactionIndex,
        // then approve + execute as separate signs.
        const settingsAfterPropose =
          await client.sdk.smartAccounts.queries.fetchSettings(settingsPda);
        const transactionIndex = BigInt(
          String(settingsAfterPropose.transactionIndex)
        );
        patchSettingsTransactionIndex(transactionIndex);

        const approveOp = await client.prepareApproveProposal({
          settingsPda,
          transactionIndex,
          signer: wallet.publicKey,
          feePayer: wallet.publicKey,
        });
        await sendPreparedWithWallet({
          connection,
          wallet: walletBridge,
          prepared: approveOp,
          confirm: true,
        });

        const executeOp = await client.prepareExecuteProposal({
          settingsPda,
          transactionIndex,
          signer: wallet.publicKey,
          feePayer: wallet.publicKey,
        });
        const executeSignature = await sendPreparedWithWallet({
          connection,
          wallet: walletBridge,
          prepared: executeOp,
          confirm: true,
        });

        queueMutationRefresh(
          resolveSmartAccountMutationRefreshPlan({
            kind: "vault_transfer",
            execution: "settings",
            accountIndex: request.accountIndex,
            signerAddresses: [request.recipientAddress],
          }),
          "post-transfer"
        );
        return {
          success: true,
          signature: executeSignature,
          status: "executed",
        };
      } catch (err) {
        const rawMessage =
          err instanceof Error ? err.message : "Stash transfer failed.";
        const haystack = rawMessage.toLowerCase();
        const isRentError =
          haystack.includes("insufficient funds for rent") ||
          haystack.includes("insufficient lamports") ||
          haystack.includes("would result in account being unable to pay rent");
        const friendly = isRentError
          ? "Stash must keep a minimum SOL balance for rent. Try a smaller amount."
          : rawMessage;
        console.error("[executeVaultTransfer] failed", err);
        return { success: false, error: friendly };
      }
    },
    [
      connection,
      evaluateVaultTransferCapability,
      overview,
      patchSettingsTransactionIndex,
      queueMutationRefresh,
      wallet,
    ]
  );

  const executeVaultSwap = useCallback(
    async (request: VaultSwapRequest): Promise<VaultSwapResult> => {
      if (!overview || !wallet.publicKey) {
        return { success: false, error: "Smart account not loaded yet." };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const vault = overview.vaults.find(
        (entry) => entry.accountIndex === request.accountIndex
      );
      if (!vault) {
        return { success: false, error: "Stash not found." };
      }

      const connectedAddress = wallet.publicKey.toBase58();
      const settingsSigner = overview.signers.find(
        (signer) =>
          signer.scope === "settings" &&
          signer.address === connectedAddress &&
          signer.canInitiate
      );

      if (!settingsSigner) {
        return {
          success: false,
          error:
            "Connected wallet isn't authorized to swap from this vault. Connect a vault signer with proposal access.",
        };
      }

      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const settingsPda = new PublicKey(overview.settingsPda);

      try {
        const { instructions, addressLookupTableAccounts } =
          await decompileVersionedTransaction({
            connection,
            transaction: request.transaction,
          });
        const preparedProposal = await client.prepareCustomInstructionProposal({
          settingsPda,
          creator: wallet.publicKey,
          feePayer: wallet.publicKey,
          instructions,
          accountIndex: request.accountIndex,
          addressLookupTableAccounts,
        });
        const proposeSignature = await sendPreparedWithWallet({
          connection,
          wallet: walletBridge,
          prepared: preparedProposal,
          confirm: true,
        });
        const threshold = overview.threshold ?? 1;

        if (threshold > 1) {
          queueMutationRefresh(
            resolveSmartAccountMutationRefreshPlan({
              kind: "vault_swap",
              execution: "proposed",
              accountIndex: request.accountIndex,
            }),
            "post-swap-proposal"
          );
          return {
            success: true,
            signature: proposeSignature,
            status: "proposed",
          };
        }

        const settingsAfterPropose =
          await client.sdk.smartAccounts.queries.fetchSettings(settingsPda);
        const transactionIndex = BigInt(
          String(settingsAfterPropose.transactionIndex)
        );
        patchSettingsTransactionIndex(transactionIndex);

        const approveOp = await client.prepareApproveProposal({
          settingsPda,
          transactionIndex,
          signer: wallet.publicKey,
          feePayer: wallet.publicKey,
        });
        await sendPreparedWithWallet({
          connection,
          wallet: walletBridge,
          prepared: approveOp,
          confirm: true,
        });

        const executeOp = await client.prepareExecuteProposal({
          settingsPda,
          transactionIndex,
          signer: wallet.publicKey,
          feePayer: wallet.publicKey,
        });
        const executeSignature = await sendPreparedWithWallet({
          connection,
          wallet: walletBridge,
          prepared: executeOp,
          confirm: true,
        });

        queueMutationRefresh(
          resolveSmartAccountMutationRefreshPlan({
            kind: "vault_swap",
            execution: "executed",
            accountIndex: request.accountIndex,
          }),
          "post-swap"
        );
        return {
          success: true,
          signature: executeSignature,
          status: "executed",
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Stash swap failed.";
        console.error("[executeVaultSwap] failed", err);
        return { success: false, error };
      }
    },
    [
      connection,
      overview,
      patchSettingsTransactionIndex,
      queueMutationRefresh,
      wallet,
    ]
  );

  const executeEarnPolicySetup =
    useCallback(async (): Promise<EarnPolicySetupResult> => {
      if (!wallet.publicKey) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (!user?.walletAddress) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        return {
          success: false,
          error: "Connected wallet does not match the authenticated wallet.",
        };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const currentEarnState = earnState ?? (await fetchEarnState());
      if (currentEarnState && currentEarnState !== earnState) {
        setEarnState(currentEarnState);
      }
      const currentEarnPolicy = currentEarnState?.policy ?? null;
      if (
        !shouldInitializeEarnYieldRoutingPolicyForDeposit({
          hasActiveEarnPosition:
            Boolean(currentEarnPolicy) &&
            isActiveEarnStatePosition(currentEarnState),
          hasEarnPolicy: Boolean(currentEarnPolicy),
        })
      ) {
        return {
          success: true,
          status: "executed",
          policy: currentEarnPolicy ?? undefined,
        };
      }

      const expectedEarnCluster = resolveEarnLoyalCluster(solanaEnv);

      setIsActionPending(true);
      try {
        const preparedPolicy = await prepareEarnPolicyOnServer();
        const setupPolicyPrepared = preparedPolicy.finalizePrepared;
        if (!setupPolicyPrepared) {
          return {
            success: false,
            error:
              "Prepared Earn setup policy is missing. Review Earn again before signing.",
          };
        }
        const sendResult = await sendPreparedEarnWithClusterPreflight({
          expectedCluster: expectedEarnCluster,
          operation: "policy setup",
          preparedCluster: preparedPolicy.persistence.cluster,
          send: () =>
            sendPreparedWithWallet({
              connection,
              wallet: walletBridge,
              prepared: preparedPolicy.prepared,
              confirm: true,
            }),
        });
        if (!sendResult.success) {
          return sendResult;
        }
        const signature = sendResult.signature;
        const confirmedSlot = await resolveConfirmedSignatureSlot({
          connection,
          signature,
        });
        const setupSendResult = await sendPreparedEarnWithClusterPreflight({
          expectedCluster: expectedEarnCluster,
          operation: "setup policy setup",
          preparedCluster: preparedPolicy.persistence.cluster,
          send: () =>
            sendPreparedWithWallet({
              connection,
              wallet: walletBridge,
              prepared: setupPolicyPrepared,
              confirm: true,
            }),
        });
        if (!setupSendResult.success) {
          return setupSendResult;
        }
        const setupPolicySignature = setupSendResult.signature;
        const setupPolicyConfirmedSlot = await resolveConfirmedSignatureSlot({
          connection,
          signature: setupPolicySignature,
        });

        await postConfirmedEarnPolicySetup({
          preparedPolicy,
          signature,
          confirmedSlot,
          setupPolicySignature,
          setupPolicyConfirmedSlot,
        });

        return {
          success: true,
          signature,
          confirmedSlot,
          status: "executed",
          policy: {
            account: preparedPolicy.policy.account.toBase58(),
            delegatedSigners: [preparedPolicy.persistence.delegatedSigner],
            id: preparedPolicy.policy.id.toString(),
            kaminoLiquidityMints:
              preparedPolicy.persistence.kaminoLiquidityMints,
            kaminoMarkets: preparedPolicy.persistence.kaminoMarkets,
            lastSeenSignature: signature,
            lastSeenSlot: confirmedSlot,
            riskProfile: preparedPolicy.persistence.riskProfile,
            routeModes: preparedPolicy.persistence.routeModes,
            seed: preparedPolicy.policy.seed.toString(),
            setupPolicy: preparedPolicy.setupPolicy
              ? {
                  account: preparedPolicy.setupPolicy.account.toBase58(),
                  delegatedSigners: [
                    preparedPolicy.persistence.delegatedSigner,
                  ],
                  id: preparedPolicy.setupPolicy.id.toString(),
                  lastSeenSignature: setupPolicySignature ?? signature,
                  lastSeenSlot: setupPolicyConfirmedSlot ?? confirmedSlot,
                  seed: preparedPolicy.setupPolicy.seed.toString(),
                }
              : null,
            stableMints: preparedPolicy.persistence.stableMints,
            universePreset: preparedPolicy.persistence.universePreset,
            vaultIndex: preparedPolicy.vault.accountIndex,
            vaultPubkey: preparedPolicy.vault.pubkey.toBase58(),
          },
        };
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Earn policy setup failed.";
        console.error("[executeEarnPolicySetup] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    }, [connection, earnState, solanaEnv, user?.walletAddress, wallet]);

  const executeEarnDepositPolicyStage = useCallback(
    async (
      request: EarnDepositPolicyStageRequest
    ): Promise<EarnDepositPolicyStageResult> => {
      if (!wallet.publicKey) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (!user?.walletAddress) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        return {
          success: false,
          error: "Connected wallet does not match the authenticated wallet.",
        };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const prepared =
        request.stage === "policy"
          ? request.preparedDeposit.policySetupPrepared
          : request.preparedDeposit.policyFinalizePrepared;
      if (!prepared) {
        return {
          success: false,
          error:
            request.stage === "policy"
              ? "Prepared Earn policy setup is missing. Review the deposit again before signing."
              : "Prepared Earn policy finalization is missing. Review the deposit again before signing.",
        };
      }
      const nativeSolError = getNativeSolRequirementError(
        request.preparedDeposit.nativeSolRequirement
      );
      if (nativeSolError) {
        return { success: false, error: nativeSolError };
      }

      const expectedEarnCluster = resolveEarnLoyalCluster(solanaEnv);

      setIsActionPending(true);
      try {
        const sendResult = await sendPreparedEarnWithClusterPreflight({
          expectedCluster: expectedEarnCluster,
          operation:
            request.stage === "policy" ? "policy setup" : "setup policy setup",
          preparedCluster: request.preparedDeposit.persistence.cluster,
          send: () =>
            sendPreparedWithWallet({
              connection,
              wallet: walletBridge,
              prepared,
              confirm: true,
            }),
        });
        if (!sendResult.success) {
          return sendResult;
        }

        const confirmedSlot = await resolveConfirmedSignatureSlot({
          connection,
          signature: sendResult.signature,
        });

        await postConfirmedEarnDepositPolicyStage({
          confirmedSlot,
          preparedDeposit: request.preparedDeposit,
          signature: sendResult.signature,
          stage: request.stage,
        });

        return {
          success: true,
          signature: sendResult.signature,
          confirmedSlot,
          status: "executed",
        };
      } catch (err) {
        const error =
          err instanceof Error
            ? err.message
            : request.stage === "policy"
            ? "Earn policy setup failed."
            : "Earn policy finalization failed.";
        console.error("[executeEarnDepositPolicyStage] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    [connection, solanaEnv, user?.walletAddress, wallet]
  );

  const executeEarnDepositBatch = useCallback(
    async (
      request: EarnDepositBatchRequest
    ): Promise<EarnDepositBatchResult> => {
      if (!wallet.publicKey) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (!user?.walletAddress) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        return {
          success: false,
          error: "Connected wallet does not match the authenticated wallet.",
        };
      }

      if (request.amountRaw <= BigInt(0)) {
        return { success: false, error: "Amount must be greater than 0." };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }
      if (!walletBridge.signAllTransactions) {
        return { success: false, batchUnavailable: true };
      }

      if (
        request.preparedDeposit.persistence.principalAmountRaw !==
        request.amountRaw.toString()
      ) {
        return {
          success: false,
          error:
            "Prepared Earn deposit amount changed. Review the deposit again before signing.",
        };
      }

      type EarnDepositBatchStage = "policy" | "policy-finalize" | "deposit";
      const batchStages: Array<{
        stage: EarnDepositBatchStage;
        prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
      }> = [];

      if (
        request.startStage === "policy" &&
        request.preparedDeposit.policySetupPrepared
      ) {
        batchStages.push({
          stage: "policy",
          prepared: request.preparedDeposit.policySetupPrepared,
        });
      }
      if (
        (request.startStage === "policy" ||
          request.startStage === "policy-finalize") &&
        request.preparedDeposit.policyFinalizePrepared
      ) {
        batchStages.push({
          stage: "policy-finalize",
          prepared: request.preparedDeposit.policyFinalizePrepared,
        });
      }
      batchStages.push({
        stage: "deposit",
        prepared: request.preparedDeposit.prepared,
      });

      if (batchStages.length < 2) {
        return { success: false, batchUnavailable: true };
      }

      const expectedEarnCluster = resolveEarnLoyalCluster(solanaEnv);
      const clusterError = validatePreparedEarnPersistenceCluster({
        expectedCluster: expectedEarnCluster,
        operation: "deposit",
        preparedCluster: request.preparedDeposit.persistence.cluster,
      });
      if (clusterError) {
        return { success: false, error: clusterError };
      }
      const nativeSolError = getNativeSolRequirementError(
        request.preparedDeposit.nativeSolRequirement
      );
      if (nativeSolError) {
        return { success: false, error: nativeSolError };
      }

      setIsActionPending(true);
      try {
        const currentEarnState = earnState ?? (await fetchEarnState());
        if (currentEarnState && currentEarnState !== earnState) {
          setEarnState(currentEarnState);
        }

        const onboarding = currentEarnState?.onboarding;
        let policyConfirmedSlot =
          request.policyConfirmedSlot ??
          onboarding?.policy?.lastSeenSlot ??
          currentEarnState?.policy?.lastSeenSlot;
        let policySignature =
          request.policySignature ??
          onboarding?.policy?.lastSeenSignature ??
          currentEarnState?.policy?.lastSeenSignature;
        let setupPolicyConfirmedSlot =
          request.setupPolicyConfirmedSlot ??
          onboarding?.setupPolicy?.lastSeenSlot;
        let setupPolicySignature =
          request.setupPolicySignature ??
          onboarding?.setupPolicy?.lastSeenSignature;
        let depositConfirmedSlot: string | undefined;
        let depositSignature: string | undefined;

        const collectedSignatureFields = () => ({
          ...(policyConfirmedSlot && policySignature
            ? { policyConfirmedSlot, policySignature }
            : {}),
          ...(setupPolicyConfirmedSlot && setupPolicySignature
            ? { setupPolicyConfirmedSlot, setupPolicySignature }
            : {}),
        });
        const resolveResumeStage =
          (): EarnDepositBatchResult["resumeStage"] => {
            if (setupPolicyConfirmedSlot && setupPolicySignature) {
              return "deposit";
            }
            if (!request.preparedDeposit.policyFinalizePrepared) {
              return policyConfirmedSlot && policySignature
                ? "deposit"
                : undefined;
            }
            return policyConfirmedSlot && policySignature
              ? "policy-finalize"
              : undefined;
          };

        const confirmationRecordFailureRef: {
          current: {
            confirmedSlot: string;
            error: unknown;
            stage: EarnDepositBatchStage;
            signature: string;
          } | null;
        } = { current: null };

        try {
          await sendPreparedBatchWithWallet({
            connection,
            wallet: walletBridge,
            prepared: batchStages.map((stage) => stage.prepared),
            confirm: true,
            onTransactionConfirmed: async ({ index, signature }) => {
              const confirmedStage = batchStages[index];
              if (!confirmedStage) {
                throw new Error(
                  "Confirmed transaction did not match a prepared Earn deposit stage."
                );
              }

              const confirmedSlot = await resolveConfirmedSignatureSlot({
                connection,
                signature,
              });

              if (
                confirmedStage.stage === "policy" ||
                confirmedStage.stage === "policy-finalize"
              ) {
                try {
                  await postConfirmedEarnDepositPolicyStage({
                    confirmedSlot,
                    preparedDeposit: request.preparedDeposit,
                    signature,
                    stage: confirmedStage.stage,
                  });
                } catch (error) {
                  confirmationRecordFailureRef.current = {
                    confirmedSlot,
                    error,
                    stage: confirmedStage.stage,
                    signature,
                  };
                  throw error;
                }

                if (confirmedStage.stage === "policy") {
                  policyConfirmedSlot = confirmedSlot;
                  policySignature = signature;
                } else {
                  setupPolicyConfirmedSlot = confirmedSlot;
                  setupPolicySignature = signature;
                }
                return;
              }

              // A top-up signs no policy transaction, so the confirm route
              // resolves the reused policy's citation itself (DB row, else
              // chain). Citing it here would dead-end every wallet whose row is
              // gone — e.g. after a full Earn exit.
              const policySignatureResolution = isReusedEarnDepositPolicy(
                request.preparedDeposit
              )
                ? null
                : resolveEarnDepositConfirmPolicySignature({
                    activePolicy: currentEarnState?.policy ?? null,
                    policyConfirmedSlot,
                    policySignature,
                    preparedDeposit: request.preparedDeposit,
                    setupPolicyConfirmedSlot,
                    setupPolicySignature,
                  });
              if (
                policySignatureResolution &&
                "error" in policySignatureResolution
              ) {
                throw new Error(policySignatureResolution.error);
              }

              depositConfirmedSlot = confirmedSlot;
              depositSignature = signature;
              try {
                await postConfirmedEarnDeposit({
                  preparedDeposit: request.preparedDeposit,
                  policyConfirmedSlot:
                    policySignatureResolution?.policyConfirmedSlot,
                  policySignature: policySignatureResolution?.policySignature,
                  setupPolicyConfirmedSlot:
                    policySignatureResolution?.setupPolicyConfirmedSlot,
                  setupPolicySignature:
                    policySignatureResolution?.setupPolicySignature,
                  signature,
                  confirmedSlot,
                  smartAccountAddress:
                    request.preparedDeposit.vault.pubkey.toBase58(),
                });
              } catch (error) {
                confirmationRecordFailureRef.current = {
                  confirmedSlot,
                  error,
                  stage: confirmedStage.stage,
                  signature,
                };
                throw error;
              }
            },
          });
        } catch (error) {
          const confirmationRecordFailure =
            confirmationRecordFailureRef.current;
          if (confirmationRecordFailure) {
            return {
              success: false,
              signature: confirmationRecordFailure.signature,
              confirmedSlot: confirmationRecordFailure.confirmedSlot,
              status: "confirmation_record_failed",
              ...collectedSignatureFields(),
              resumeStage: resolveResumeStage(),
              error:
                confirmationRecordFailure.error instanceof Error
                  ? confirmationRecordFailure.error.message
                  : "Failed to record confirmed Earn deposit stage.",
            };
          }

          return {
            success: false,
            ...collectedSignatureFields(),
            resumeStage: resolveResumeStage(),
            error:
              error instanceof Error ? error.message : "Earn deposit failed.",
          };
        }

        if (!depositSignature || !depositConfirmedSlot) {
          return {
            success: false,
            ...collectedSignatureFields(),
            resumeStage: resolveResumeStage(),
            error: "Earn deposit batch did not complete the deposit.",
          };
        }

        return {
          success: true,
          signature: depositSignature,
          confirmedSlot: depositConfirmedSlot,
          status: "executed",
          ...collectedSignatureFields(),
        };
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Earn deposit failed.";
        console.error("[executeEarnDepositBatch] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    [connection, earnState, solanaEnv, user?.walletAddress, wallet]
  );

  const executeEarnDeposit = useCallback(
    async (request: EarnDepositRequest): Promise<EarnDepositResult> => {
      console.log("[executeEarnDeposit] called", {
        amountRaw: request.amountRaw.toString(),
        hasOverview: Boolean(overview),
        hasSmartAccountAddress: Boolean(user?.smartAccountAddress),
        hasUserWalletAddress: Boolean(user?.walletAddress),
        hasWalletPublicKey: Boolean(wallet.publicKey),
      });

      if (!wallet.publicKey) {
        console.log("[executeEarnDeposit] aborted: no connected wallet", {
          hasOverview: Boolean(overview),
          hasSmartAccountAddress: Boolean(user?.smartAccountAddress),
          hasWalletPublicKey: Boolean(wallet.publicKey),
        });
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (!user?.walletAddress) {
        console.log("[executeEarnDeposit] aborted: no authenticated wallet");
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        console.log("[executeEarnDeposit] aborted: wallet mismatch", {
          authenticatedWallet: user.walletAddress,
          connectedWallet: wallet.publicKey.toBase58(),
        });
        return {
          success: false,
          error: "Connected wallet does not match the authenticated wallet.",
        };
      }

      if (request.amountRaw <= BigInt(0)) {
        console.log("[executeEarnDeposit] aborted: non-positive amount", {
          amountRaw: request.amountRaw.toString(),
        });
        return { success: false, error: "Amount must be greater than 0." };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        console.log("[executeEarnDeposit] aborted: no wallet bridge");
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const expectedEarnCluster = resolveEarnLoyalCluster(solanaEnv);

      setIsActionPending(true);
      try {
        console.log("[executeEarnDeposit] preparing Earn USDC deposit", {
          amountRaw: request.amountRaw.toString(),
          cluster: expectedEarnCluster,
          prepareLocation: request.preparedDeposit ? "preview" : "server",
        });
        const preparedDeposit =
          request.preparedDeposit ??
          (await prepareEarnDepositOnServer({
            amountRaw: request.amountRaw,
          }));
        if (
          preparedDeposit.persistence.principalAmountRaw !==
          request.amountRaw.toString()
        ) {
          return {
            success: false,
            error:
              "Prepared Earn deposit amount changed. Review the deposit again before signing.",
          };
        }
        const nativeSolError = getNativeSolRequirementError(
          preparedDeposit.nativeSolRequirement
        );
        if (nativeSolError) {
          return { success: false, error: nativeSolError };
        }
        console.log(
          "[executeEarnDeposit] prepared deposit; sending to wallet",
          {
            instructionCount: preparedDeposit.prepared.instructions.length,
            vaultAccountIndex: preparedDeposit.vault.accountIndex,
            vaultAddress: preparedDeposit.vault.pubkey.toBase58(),
          }
        );
        const currentEarnState = earnState ?? (await fetchEarnState());
        if (currentEarnState && currentEarnState !== earnState) {
          setEarnState(currentEarnState);
        }
        const onboarding = currentEarnState?.onboarding;
        // See the staged flow above: the confirm route owns the reused policy's
        // citation, so a top-up must not be blocked on the browser's copy of it.
        const policySignatureResolution = isReusedEarnDepositPolicy(
          preparedDeposit
        )
          ? null
          : resolveEarnDepositConfirmPolicySignature({
              activePolicy: currentEarnState?.policy ?? null,
              policyConfirmedSlot:
                request.policyConfirmedSlot ??
                onboarding?.policy?.lastSeenSlot ??
                currentEarnState?.policy?.lastSeenSlot,
              policySignature:
                request.policySignature ??
                onboarding?.policy?.lastSeenSignature ??
                currentEarnState?.policy?.lastSeenSignature,
              preparedDeposit,
              setupPolicyConfirmedSlot:
                request.setupPolicyConfirmedSlot ??
                onboarding?.setupPolicy?.lastSeenSlot,
              setupPolicySignature:
                request.setupPolicySignature ??
                onboarding?.setupPolicy?.lastSeenSignature,
            });
        if (policySignatureResolution && "error" in policySignatureResolution) {
          return {
            success: false,
            error: policySignatureResolution.error,
          };
        }

        const sendResult = await sendPreparedEarnWithClusterPreflight({
          expectedCluster: expectedEarnCluster,
          operation: "deposit",
          preparedCluster: preparedDeposit.persistence.cluster,
          send: () =>
            sendPreparedWithWallet({
              connection,
              wallet: walletBridge,
              prepared: preparedDeposit.prepared,
              confirm: true,
            }),
        });
        if (!sendResult.success) {
          return sendResult;
        }
        const signature = sendResult.signature;
        console.log("[executeEarnDeposit] wallet send completed", {
          signature,
        });
        const confirmedSlot = await resolveConfirmedSignatureSlot({
          connection,
          signature,
        });
        console.log("[executeEarnDeposit] signature confirmed", {
          confirmedSlot,
          signature,
        });

        const recordDepositConfirmation = async () => {
          await postConfirmedEarnDeposit({
            preparedDeposit,
            policyConfirmedSlot: policySignatureResolution?.policyConfirmedSlot,
            policySignature: policySignatureResolution?.policySignature,
            setupPolicyConfirmedSlot:
              policySignatureResolution?.setupPolicyConfirmedSlot,
            setupPolicySignature:
              policySignatureResolution?.setupPolicySignature,
            signature,
            confirmedSlot,
            smartAccountAddress: preparedDeposit.vault.pubkey.toBase58(),
          });
          console.log("[executeEarnDeposit] backend confirmation posted", {
            confirmedSlot,
            signature,
          });
        };

        const shouldRecordDepositConfirmationAsync =
          request.recordConfirmationAsync &&
          preparedDeposit.persistence.policyInitialization === "reuse";

        if (shouldRecordDepositConfirmationAsync) {
          void recordDepositConfirmation().catch((error) => {
            console.warn(
              "[executeEarnDeposit] async backend confirmation failed",
              {
                confirmedSlot,
                errorMessage:
                  error instanceof Error ? error.message : "Unknown error.",
                errorName: error instanceof Error ? error.name : typeof error,
                signature,
              }
            );
          });
        } else {
          await recordDepositConfirmation();
        }

        return {
          success: true,
          signature,
          confirmedSlot,
          status: "executed",
        };
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Earn deposit failed.";
        console.error("[executeEarnDeposit] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    [
      connection,
      earnState,
      overview,
      solanaEnv,
      user?.smartAccountAddress,
      user?.walletAddress,
      wallet,
    ]
  );

  const executeEarnWithdraw = useCallback(
    async (request: EarnWithdrawRequest): Promise<EarnWithdrawResult> => {
      if (!wallet.publicKey) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (!user?.walletAddress) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        return {
          success: false,
          error: "Connected wallet does not match the authenticated wallet.",
        };
      }

      if (request.amountRaw <= BigInt(0)) {
        return { success: false, error: "Amount must be greater than 0." };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const expectedEarnCluster = resolveEarnLoyalCluster(solanaEnv);

      setIsActionPending(true);
      try {
        const preparedWithdraw = request.preparedWithdraw;
        const selectedStepIndex = request.stepIndex ?? 0;
        const preparedStep =
          preparedWithdraw.withdrawSteps[selectedStepIndex] ??
          preparedWithdraw.withdrawSteps[0];
        if (!preparedStep) {
          return {
            success: false,
            error: "Prepared Earn withdrawal is missing withdraw steps.",
          };
        }

        const autodepositClosePrepared =
          preparedWithdraw.autodepositClosePrepared ?? null;
        if (
          request.autodepositCloseAlreadyCompleted &&
          autodepositClosePrepared
        ) {
          return {
            success: false,
            error:
              "Prepared Earn withdrawal still includes Autodeposit close. Re-review withdrawal before signing.",
          };
        }

        let autodepositCloseSignature: string | undefined;
        let autodepositCloseConfirmedSlot: string | undefined;

        if (autodepositClosePrepared) {
          const closeSendResult = await sendPreparedEarnWithClusterPreflight({
            expectedCluster: expectedEarnCluster,
            operation: "autodeposit close",
            preparedCluster: autodepositClosePrepared.persistence.cluster,
            send: () =>
              sendPreparedWithWallet({
                connection,
                wallet: walletBridge,
                prepared: autodepositClosePrepared.prepared,
                confirm: true,
              }),
          });
          if (!closeSendResult.success) {
            return closeSendResult;
          }
          autodepositCloseSignature = closeSendResult.signature;
          autodepositCloseConfirmedSlot = await resolveConfirmedSignatureSlot({
            connection,
            signature: autodepositCloseSignature,
          });
          try {
            await postConfirmedEarnAutodepositClose({
              preparedClose: autodepositClosePrepared,
              signature: autodepositCloseSignature,
              confirmedSlot: autodepositCloseConfirmedSlot,
            });
          } catch (error) {
            return {
              success: false,
              signature: autodepositCloseSignature,
              confirmedSlot: autodepositCloseConfirmedSlot,
              status: "confirmation_record_failed",
              mode: request.mode,
              amountRaw: request.amountRaw.toString(),
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to record confirmed Autodeposit close.",
            };
          }
        }

        const sendResult = await sendPreparedEarnWithClusterPreflight({
          expectedCluster: expectedEarnCluster,
          operation: "withdrawal",
          preparedCluster: preparedStep.persistence.cluster,
          send: () =>
            sendPreparedWithWallet({
              connection,
              wallet: walletBridge,
              prepared: preparedStep.prepared,
              confirm: true,
            }),
        });
        if (!sendResult.success) {
          return sendResult;
        }
        const signature = sendResult.signature;
        const confirmedSlot = await resolveConfirmedSignatureSlot({
          connection,
          signature,
        });

        const recordWithdrawalConfirmation = async () => {
          await postConfirmedEarnWithdraw({
            autodepositCloseConfirmedSlot,
            autodepositCloseSignature,
            preparedWithdraw,
            preparedStep,
            signature,
            confirmedSlot,
            smartAccountAddress: preparedWithdraw.vault.pubkey.toBase58(),
          });

          try {
            await Promise.resolve(request.onConfirmationRecorded?.());
          } catch (error) {
            console.warn(
              "[executeEarnWithdraw] post-confirm UI refresh failed",
              error
            );
          }
        };
        const shouldRecordConfirmationAsync =
          request.mode === "partial" &&
          request.recordConfirmationAsync &&
          selectedStepIndex === preparedWithdraw.withdrawSteps.length - 1;

        if (shouldRecordConfirmationAsync) {
          void recordWithdrawalConfirmation().catch((error) => {
            console.warn(
              "[executeEarnWithdraw] async backend confirmation failed",
              {
                confirmedSlot,
                errorMessage:
                  error instanceof Error ? error.message : "Unknown error.",
                errorName: error instanceof Error ? error.name : typeof error,
                mode: request.mode,
                signature,
                stepIndex: selectedStepIndex,
              }
            );
          });
        } else {
          try {
            await recordWithdrawalConfirmation();
          } catch (error) {
            return {
              success: false,
              signature,
              confirmedSlot,
              status: "confirmation_record_failed",
              mode: request.mode,
              amountRaw: request.amountRaw.toString(),
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to record confirmed earn withdrawal.",
            };
          }
        }

        return {
          success: true,
          signature,
          confirmedSlot,
          status: "executed",
          mode: preparedStep.mode,
          amountRaw: preparedStep.amountRaw.toString(),
        };
      } catch (err) {
        const error = getDetailedWalletErrorMessage(
          err,
          "Earn withdrawal failed."
        );
        console.error("[executeEarnWithdraw] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    [connection, solanaEnv, user?.walletAddress, wallet]
  );

  const executeEarnCleanup = useCallback(
    async (request: EarnCleanupRequest): Promise<EarnCleanupResult> => {
      if (!wallet.publicKey) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (!user?.walletAddress) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        return {
          success: false,
          error: "Connected wallet does not match the authenticated wallet.",
        };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const expectedEarnCluster = resolveEarnLoyalCluster(solanaEnv);

      setIsActionPending(true);
      try {
        const preparedCleanup =
          request.preparedCleanup ?? (await prepareEarnCleanupOnServer());
        const autodepositClosePrepared =
          preparedCleanup.autodepositClosePrepared ?? null;
        let autodepositCloseSignature: string | undefined;
        let autodepositCloseConfirmedSlot: string | undefined;

        if (autodepositClosePrepared) {
          const closeSendResult = await sendPreparedEarnWithClusterPreflight({
            expectedCluster: expectedEarnCluster,
            operation: "autodeposit close",
            preparedCluster: autodepositClosePrepared.persistence.cluster,
            send: () =>
              sendPreparedWithWallet({
                connection,
                wallet: walletBridge,
                prepared: autodepositClosePrepared.prepared,
                confirm: true,
              }),
          });
          if (!closeSendResult.success) {
            return closeSendResult;
          }
          autodepositCloseSignature = closeSendResult.signature;
          autodepositCloseConfirmedSlot = await resolveConfirmedSignatureSlot({
            connection,
            signature: autodepositCloseSignature,
          });
        }

        const sendResult = await sendPreparedEarnWithClusterPreflight({
          expectedCluster: expectedEarnCluster,
          operation: "earn cleanup",
          preparedCluster: preparedCleanup.persistence.cluster,
          send: () =>
            sendPreparedWithWallet({
              connection,
              wallet: walletBridge,
              prepared: preparedCleanup.prepared,
              confirm: true,
            }),
        });
        if (!sendResult.success) {
          return sendResult;
        }
        const signature = sendResult.signature;
        const confirmedSlot = await resolveConfirmedSignatureSlot({
          connection,
          signature,
        });

        try {
          await postConfirmedEarnCleanup({
            autodepositCloseConfirmedSlot,
            autodepositCloseSignature,
            preparedCleanup,
            signature,
            confirmedSlot,
          });
        } catch (error) {
          return {
            success: false,
            signature,
            confirmedSlot,
            status: "confirmation_record_failed",
            idleTransferAmountRaw:
              preparedCleanup.persistence.idleTransferAmountRaw,
            error:
              error instanceof Error
                ? error.message
                : "Failed to record confirmed Earn cleanup.",
          };
        }

        return {
          success: true,
          signature,
          confirmedSlot,
          status: "executed",
          idleTransferAmountRaw:
            preparedCleanup.persistence.idleTransferAmountRaw,
        };
      } catch (err) {
        const error = getDetailedWalletErrorMessage(
          err,
          "Earn cleanup failed."
        );
        console.error("[executeEarnCleanup] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    [connection, solanaEnv, user?.walletAddress, wallet]
  );

  const getEarnAutodepositPrepareContext = useCallback(() => {
    if (!overview) {
      throw new Error("Smart account not loaded yet.");
    }

    if (!wallet.publicKey) {
      throw new Error("Connect the authenticated wallet to sign this action.");
    }

    if (!user?.walletAddress) {
      throw new Error("Connect the authenticated wallet to sign this action.");
    }

    if (wallet.publicKey.toBase58() !== user.walletAddress) {
      throw new Error(
        "Connected wallet does not match the authenticated wallet."
      );
    }

    const policySignerPublicKey = earnState?.policySignerPublicKey;
    if (!policySignerPublicKey) {
      throw new Error("Earn policy signer is unavailable. Refresh and retry.");
    }

    return {
      client: createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      }),
      cluster: resolveEarnLoyalCluster(solanaEnv),
      feePayer: wallet.publicKey,
      policySigner: new PublicKey(policySignerPublicKey),
      settingsPda: new PublicKey(overview.settingsPda),
      signer: wallet.publicKey,
      walletAddress: new PublicKey(user.walletAddress),
    };
  }, [
    connection,
    earnState?.policySignerPublicKey,
    overview,
    solanaEnv,
    user?.walletAddress,
    wallet.publicKey,
  ]);

  const prepareEarnAutodepositSetup = useCallback(
    async (
      request: Omit<EarnAutodepositSetupRequest, "preparedSetup">
    ): Promise<SmartAccountPreparedEarnUsdcAutodepositSetup> => {
      const context = getEarnAutodepositPrepareContext();
      const key = createEarnAutodepositPrepareKey({
        context,
        kind: "setup",
        request,
      });
      const existing = earnAutodepositSetupPreparePromisesRef.current.get(key);
      if (existing) {
        return existing;
      }

      const promise = context.client.prepareEarnUsdcAutodepositSetup({
        amountRaw: request.amountRaw,
        cluster: context.cluster,
        expiryTimestamp: request.expiryTimestamp,
        feePayer: context.feePayer,
        minimumDelegatorBalanceRaw: request.walletBalanceFloorRaw,
        nonce: request.nonce,
        periodLengthSeconds: request.periodLengthSeconds,
        policySeed: request.policySeed,
        policySigner: context.policySigner,
        settingsPda: context.settingsPda,
        signer: context.signer,
        startTimestamp: request.startTimestamp,
        walletAddress: context.walletAddress,
      });
      earnAutodepositSetupPreparePromisesRef.current.set(key, promise);

      try {
        return await promise;
      } finally {
        earnAutodepositSetupPreparePromisesRef.current.delete(key);
      }
    },
    [getEarnAutodepositPrepareContext]
  );

  const prepareEarnAutodepositSetupBatch = useCallback(
    async (
      request: Omit<EarnAutodepositSetupRequest, "preparedSetup"> & {
        preparedSetup?: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
        refreshImmediateStartTimestamp?: boolean;
      }
    ): Promise<EarnAutodepositSetupBatchPrepare> => {
      const context = getEarnAutodepositPrepareContext();
      const key = createEarnAutodepositPrepareKey({
        context,
        kind: "batch",
        preparedSetup: request.preparedSetup,
        request,
      });
      const existing =
        earnAutodepositSetupBatchPreparePromisesRef.current.get(key);
      if (existing) {
        return existing;
      }

      const setupInput = {
        amountRaw: request.amountRaw,
        cluster: context.cluster,
        expiryTimestamp: request.expiryTimestamp,
        feePayer: context.feePayer,
        minimumDelegatorBalanceRaw: request.walletBalanceFloorRaw,
        nonce: request.nonce,
        periodLengthSeconds: request.periodLengthSeconds,
        policySeed: request.policySeed,
        policySigner: context.policySigner,
        settingsPda: context.settingsPda,
        signer: context.signer,
        startTimestamp: request.startTimestamp,
        walletAddress: context.walletAddress,
      };
      const promise = (async () => {
        const preparedSetups = request.preparedSetup
          ? await context.client.prepareEarnUsdcAutodepositSetupBatchFromPrepared(
              {
                ...setupInput,
                preparedSetup: request.preparedSetup,
                refreshImmediateStartTimestamp:
                  request.refreshImmediateStartTimestamp,
              }
            )
          : await context.client.prepareEarnUsdcAutodepositSetupBatch({
              ...setupInput,
            });
        const preparedSetup = preparedSetups[0];

        if (!preparedSetup) {
          throw new Error("Failed to prepare Autodeposit setup.");
        }

        return {
          nextPreparedSetup: preparedSetups[1] ?? null,
          preparedSetup,
        };
      })();
      earnAutodepositSetupBatchPreparePromisesRef.current.set(key, promise);

      try {
        return await promise;
      } finally {
        earnAutodepositSetupBatchPreparePromisesRef.current.delete(key);
      }
    },
    [getEarnAutodepositPrepareContext]
  );

  const prepareEarnAutodepositClose = useCallback(
    async (
      request: Omit<EarnAutodepositCloseRequest, "preparedClose">
    ): Promise<SmartAccountPreparedEarnUsdcAutodepositClose> => {
      const context = getEarnAutodepositPrepareContext();
      return context.client.prepareEarnUsdcAutodepositClose({
        cluster: context.cluster,
        feePayer: context.feePayer,
        policy: new PublicKey(request.policy),
        policySigner: context.policySigner,
        recurringDelegation: new PublicKey(request.recurringDelegation),
        settingsPda: context.settingsPda,
        signer: context.signer,
        walletAddress: context.walletAddress,
      });
    },
    [getEarnAutodepositPrepareContext]
  );

  const executeEarnAutodepositSetup = useCallback(
    async (
      request: EarnAutodepositSetupRequest
    ): Promise<EarnAutodepositSetupResult> => {
      if (!wallet.publicKey) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (!user?.walletAddress) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        return {
          success: false,
          error: "Connected wallet does not match the authenticated wallet.",
        };
      }

      if (request.amountRaw <= BigInt(0)) {
        return { success: false, error: "Amount must be greater than 0." };
      }
      if (request.walletBalanceFloorRaw < BigInt(0)) {
        return {
          success: false,
          error: "Autodeposit wallet balance floor cannot be negative.",
        };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const expectedEarnCluster = resolveEarnLoyalCluster(solanaEnv);
      const requestedStartTimestamp = getRequestedEarnAutodepositStartTimestamp(
        {
          expiryTimestamp: request.expiryTimestamp,
          startTimestamp: request.startTimestamp,
        }
      );

      setIsActionPending(true);
      try {
        const preparedSetup =
          request.preparedSetup ??
          (await prepareEarnAutodepositSetup({
            amountRaw: request.amountRaw,
            expiryTimestamp: request.expiryTimestamp,
            nonce: request.nonce,
            periodLengthSeconds: request.periodLengthSeconds,
            policySeed: request.policySeed,
            startTimestamp: requestedStartTimestamp,
            walletBalanceFloorRaw: request.walletBalanceFloorRaw,
          }));

        if (
          preparedSetup.persistence.amountPerPeriodRaw !==
          request.amountRaw.toString()
        ) {
          return {
            success: false,
            error:
              "Prepared Autodeposit amount changed. Review Autodeposit again before signing.",
          };
        }

        if (
          preparedSetup.stage === "create_policy" &&
          walletBridge.signAllTransactions
        ) {
          let batchPrepare: EarnAutodepositSetupBatchPrepare | null = null;
          try {
            batchPrepare = await prepareEarnAutodepositSetupBatch({
              amountRaw: request.amountRaw,
              expiryTimestamp:
                request.expiryTimestamp ??
                preparedSetup.subscription.expiryTimestamp,
              nonce: preparedSetup.subscription.nonce,
              periodLengthSeconds:
                request.periodLengthSeconds ??
                preparedSetup.subscription.periodLengthSeconds,
              policySeed: preparedSetup.policy.seed ?? undefined,
              preparedSetup,
              startTimestamp: requestedStartTimestamp,
              walletBalanceFloorRaw: request.walletBalanceFloorRaw,
            });
          } catch (error) {
            console.warn(
              "[executeEarnAutodepositSetup] batch prepare failed; falling back to staged setup",
              error
            );
          }

          if (
            batchPrepare &&
            isMatchingEarnAutodepositSetupBatch({
              amountRaw: request.amountRaw,
              nextPreparedSetup: batchPrepare.nextPreparedSetup,
              preparedSetup: batchPrepare.preparedSetup,
            })
          ) {
            const batchPreparedSetup = batchPrepare.preparedSetup;
            const batchNextPreparedSetup = batchPrepare.nextPreparedSetup;
            if (!batchPreparedSetup || !batchNextPreparedSetup) {
              return {
                success: false,
                error:
                  "Autodeposit setup batch did not include a recurring delegation.",
              };
            }
            const batchPreparedSetups: readonly SmartAccountPreparedEarnUsdcAutodepositSetup[] =
              [batchPreparedSetup, batchNextPreparedSetup];
            const clusterError = batchPreparedSetups
              .map((setup) =>
                validatePreparedEarnPersistenceCluster({
                  expectedCluster: expectedEarnCluster,
                  operation: "autodeposit setup",
                  preparedCluster: setup.persistence.cluster,
                })
              )
              .find((error): error is string => Boolean(error));
            if (clusterError) {
              return { success: false, error: clusterError };
            }
            const nativeSolError = getNativeSolRequirementError(
              combineSmartAccountNativeSolRequirements(
                batchPreparedSetups.map((setup) => setup.nativeSolRequirement)
              )
            );
            if (nativeSolError) {
              return { success: false, error: nativeSolError };
            }

            const confirmationRecordFailureRef: {
              current: {
                confirmedSlot: string;
                error: unknown;
                preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
                signature: string;
              } | null;
            } = { current: null };
            let policyConfirmedSlot: string | undefined;
            let policySignature: string | undefined;
            let recurringDelegationConfirmedSlot: string | undefined;
            let recurringDelegationSent = false;
            let recurringDelegationSignature: string | undefined;
            let confirmResponse:
              | EarnAutodepositSetupConfirmResponse
              | undefined;

            try {
              // Keep the one-prompt signAll UX, but confirm and record each
              // setup stage before sending the next dependent transaction.
              await sendPreparedBatchWithWallet({
                connection,
                wallet: walletBridge,
                prepared: batchPreparedSetups.map((setup) => setup.prepared),
                confirm: true,
                onTransactionSent: ({ index }) => {
                  const sentSetup = batchPreparedSetups[index];
                  if (sentSetup?.stage === "create_recurring_delegation") {
                    recurringDelegationSent = true;
                  }
                },
                onTransactionConfirmed: async ({ index, signature }) => {
                  const confirmedSetup = batchPreparedSetups[index];
                  if (!confirmedSetup) {
                    throw new Error(
                      "Confirmed transaction did not match a prepared Autodeposit setup."
                    );
                  }

                  const confirmedSlot = await resolveConfirmedSignatureSlot({
                    connection,
                    signature,
                  });
                  try {
                    const response = await postConfirmedEarnAutodepositSetup({
                      preparedSetup: confirmedSetup,
                      signature,
                      confirmedSlot,
                      walletBalanceFloorRaw: request.walletBalanceFloorRaw,
                    });
                    if (confirmedSetup.stage === "create_policy") {
                      policyConfirmedSlot = confirmedSlot;
                      policySignature = signature;
                    } else {
                      recurringDelegationConfirmedSlot = confirmedSlot;
                      recurringDelegationSignature = signature;
                    }
                    if (
                      confirmedSetup.stage === "create_recurring_delegation"
                    ) {
                      confirmResponse = response;
                    }
                  } catch (error) {
                    confirmationRecordFailureRef.current = {
                      confirmedSlot,
                      error,
                      preparedSetup: confirmedSetup,
                      signature,
                    };
                    throw error;
                  }
                },
              });
            } catch (error) {
              const confirmationRecordFailure =
                confirmationRecordFailureRef.current;
              if (confirmationRecordFailure) {
                return {
                  success: false,
                  signature: confirmationRecordFailure.signature,
                  ...getEarnAutodepositSetupSignatureFields(
                    confirmationRecordFailure.preparedSetup,
                    confirmationRecordFailure.signature
                  ),
                  confirmedSlot: confirmationRecordFailure.confirmedSlot,
                  status: "confirmation_record_failed",
                  preparedSetup: confirmationRecordFailure.preparedSetup,
                  error:
                    confirmationRecordFailure.error instanceof Error
                      ? confirmationRecordFailure.error.message
                      : "Failed to record confirmed Autodeposit setup.",
                };
              }

              if (
                policySignature &&
                policyConfirmedSlot &&
                !recurringDelegationSent
              ) {
                return {
                  success: true,
                  signature: policySignature,
                  policySignature,
                  confirmedSlot: policyConfirmedSlot,
                  status: "executed",
                  preparedSetup: batchPreparedSetup,
                  nextPreparedSetup: batchNextPreparedSetup,
                };
              }

              return {
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Autodeposit setup failed.",
              };
            }

            if (
              !confirmResponse ||
              !recurringDelegationConfirmedSlot ||
              !recurringDelegationSignature
            ) {
              return {
                success: false,
                error:
                  "Autodeposit setup batch did not complete the recurring delegation.",
              };
            }

            const scheduledSweeps = confirmResponse.bootstrapSweep?.sweep
              ? [confirmResponse.bootstrapSweep.sweep]
              : [];

            return {
              success: true,
              signature: recurringDelegationSignature,
              targetId: confirmResponse.target?.id,
              policySignature,
              recurringDelegationSignature,
              confirmedSlot: recurringDelegationConfirmedSlot,
              status: "executed",
              preparedSetup: batchNextPreparedSetup,
              bootstrapSweep: confirmResponse.bootstrapSweep,
              scheduledSweeps,
            };
          }
        }

        const nativeSolError = getNativeSolRequirementError(
          preparedSetup.nativeSolRequirement
        );
        if (nativeSolError) {
          return { success: false, error: nativeSolError };
        }

        const setupSend = await sendPreparedEarnWithClusterPreflight({
          expectedCluster: expectedEarnCluster,
          operation: "autodeposit setup",
          preparedCluster: preparedSetup.persistence.cluster,
          send: () =>
            sendPreparedWithWallet({
              connection,
              wallet: walletBridge,
              prepared: preparedSetup.prepared,
              confirm: true,
            }),
        });
        if (!setupSend.success) {
          return setupSend;
        }
        const confirmedSlot = await resolveConfirmedSignatureSlot({
          connection,
          signature: setupSend.signature,
        });
        let confirmResponse: EarnAutodepositSetupConfirmResponse;
        try {
          confirmResponse = await postConfirmedEarnAutodepositSetup({
            preparedSetup,
            signature: setupSend.signature,
            confirmedSlot,
            walletBalanceFloorRaw: request.walletBalanceFloorRaw,
          });
        } catch (error) {
          return {
            success: false,
            signature: setupSend.signature,
            ...getEarnAutodepositSetupSignatureFields(
              preparedSetup,
              setupSend.signature
            ),
            confirmedSlot,
            status: "confirmation_record_failed",
            preparedSetup,
            error:
              error instanceof Error
                ? error.message
                : "Failed to record confirmed Autodeposit setup.",
          };
        }
        const completedAutodepositSetup =
          preparedSetup.stage === "create_recurring_delegation" ||
          preparedSetup.stage === "approve_token_delegate";
        const nextPreparedSetup = completedAutodepositSetup
          ? null
          : preparedSetup.stage === "create_policy"
          ? (
              await prepareEarnAutodepositSetupBatch({
                amountRaw: request.amountRaw,
                expiryTimestamp:
                  request.expiryTimestamp ??
                  preparedSetup.subscription.expiryTimestamp,
                nonce: preparedSetup.subscription.nonce,
                periodLengthSeconds:
                  request.periodLengthSeconds ??
                  preparedSetup.subscription.periodLengthSeconds,
                policySeed: preparedSetup.policy.seed ?? undefined,
                preparedSetup,
                refreshImmediateStartTimestamp:
                  requestedStartTimestamp === undefined,
                // Undefined means "immediate"; let the builder resolve it
                // after policy confirmation so the delegation start is not stale.
                startTimestamp: requestedStartTimestamp,
                walletBalanceFloorRaw: request.walletBalanceFloorRaw,
              })
            ).nextPreparedSetup
          : await prepareEarnAutodepositSetup({
              amountRaw: request.amountRaw,
              expiryTimestamp:
                request.expiryTimestamp ??
                preparedSetup.subscription.expiryTimestamp,
              nonce: preparedSetup.subscription.nonce,
              periodLengthSeconds:
                request.periodLengthSeconds ??
                preparedSetup.subscription.periodLengthSeconds,
              policySeed: preparedSetup.policy.seed ?? undefined,
              startTimestamp: requestedStartTimestamp,
              walletBalanceFloorRaw: request.walletBalanceFloorRaw,
            });

        const scheduledSweeps =
          confirmResponse.bootstrapSweep?.sweep && completedAutodepositSetup
            ? [confirmResponse.bootstrapSweep.sweep]
            : completedAutodepositSetup
            ? []
            : undefined;

        return {
          success: true,
          signature: setupSend.signature,
          targetId: confirmResponse.target?.id,
          ...getEarnAutodepositSetupSignatureFields(
            preparedSetup,
            setupSend.signature
          ),
          confirmedSlot,
          status: "executed",
          preparedSetup,
          nextPreparedSetup,
          bootstrapSweep: confirmResponse.bootstrapSweep,
          scheduledSweeps,
        };
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Autodeposit setup failed.";
        console.error("[executeEarnAutodepositSetup] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    [
      connection,
      prepareEarnAutodepositSetup,
      prepareEarnAutodepositSetupBatch,
      solanaEnv,
      user?.walletAddress,
      wallet,
    ]
  );

  const executeEarnAutodepositFloorUpdate = useCallback(
    async (
      request: EarnAutodepositFloorUpdateRequest
    ): Promise<EarnAutodepositFloorUpdateResult> => {
      if (request.walletBalanceFloorRaw < BigInt(0)) {
        return {
          success: false,
          error: "Autodeposit wallet balance floor cannot be negative.",
        };
      }

      setIsActionPending(true);
      try {
        const response = await postEarnAutodepositFloorUpdate(request);
        const scheduledSweeps = response.rebaselineSweep?.sweep
          ? [response.rebaselineSweep.sweep]
          : [];

        return {
          success: true,
          rebaselineSweep: response.rebaselineSweep,
          scheduledSweeps,
          target: response.target,
        };
      } catch (err) {
        const error =
          err instanceof Error
            ? err.message
            : "Autodeposit wallet balance floor update failed.";
        console.error("[executeEarnAutodepositFloorUpdate] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    []
  );

  const executeEarnAutodepositToggle = useCallback(
    async (
      request: EarnAutodepositToggleRequest
    ): Promise<EarnAutodepositToggleResult> => {
      setIsActionPending(true);
      try {
        const response = await postEarnAutodepositToggle(request);
        return { success: true, scheduledSweeps: [], target: response.target };
      } catch (err) {
        const error =
          err instanceof Error
            ? err.message
            : "Autodeposit active state update failed.";
        console.error("[executeEarnAutodepositToggle] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    []
  );

  const executeEarnAutodepositClose = useCallback(
    async (
      request: EarnAutodepositCloseRequest
    ): Promise<EarnAutodepositCloseResult> => {
      if (!wallet.publicKey) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (!user?.walletAddress) {
        return {
          success: false,
          error: "Connect the authenticated wallet to sign this action.",
        };
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        return {
          success: false,
          error: "Connected wallet does not match the authenticated wallet.",
        };
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        return {
          success: false,
          error: "Connected wallet cannot sign transactions.",
        };
      }

      const expectedEarnCluster = resolveEarnLoyalCluster(solanaEnv);

      setIsActionPending(true);
      try {
        const preparedClose =
          request.preparedClose ??
          (await prepareEarnAutodepositClose({
            policy: request.policy,
            recurringDelegation: request.recurringDelegation,
          }));
        const closeSend = await sendPreparedEarnWithClusterPreflight({
          expectedCluster: expectedEarnCluster,
          operation: "autodeposit close",
          preparedCluster: preparedClose.persistence.cluster,
          send: () =>
            sendPreparedWithWallet({
              connection,
              wallet: walletBridge,
              prepared: preparedClose.prepared,
              confirm: true,
            }),
        });
        if (!closeSend.success) {
          return closeSend;
        }
        const confirmedSlot = await resolveConfirmedSignatureSlot({
          connection,
          signature: closeSend.signature,
        });
        let confirmResponse: EarnAutodepositCloseConfirmResponse;
        try {
          confirmResponse = await postConfirmedEarnAutodepositClose({
            preparedClose,
            signature: closeSend.signature,
            confirmedSlot,
          });
        } catch (error) {
          return {
            success: false,
            signature: closeSend.signature,
            confirmedSlot,
            status: "confirmation_record_failed",
            error:
              error instanceof Error
                ? error.message
                : "Failed to record confirmed Autodeposit close.",
          };
        }

        return {
          success: true,
          signature: closeSend.signature,
          targetId: confirmResponse.target?.id,
          confirmedSlot,
          status: "executed",
        };
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Autodeposit close failed.";
        console.error("[executeEarnAutodepositClose] failed", err);
        return { success: false, error };
      } finally {
        setIsActionPending(false);
      }
    },
    [
      connection,
      prepareEarnAutodepositClose,
      solanaEnv,
      user?.walletAddress,
      wallet,
    ]
  );

  const isLoading =
    isBaseLoading ||
    (loadVaultSnapshots && isVaultsLoading) ||
    isPoliciesLoading ||
    isProposalsLoading;

  return {
    overview,
    earnAutodeposit: earnState?.autodeposit ?? null,
    earnOnboarding: earnState?.onboarding ?? null,
    earnPolicy,
    earnPolicySignerPublicKey: earnState?.policySignerPublicKey ?? null,
    earnVaultPubkey: earnState?.vault.pubkey ?? null,
    earnStateLoadErrors: earnState?.loadErrors ?? {},
    hasEarnStateResolved,
    isLoading,
    isEarnStateLoading,
    isBaseLoading,
    isVaultsLoading,
    isPoliciesLoading,
    isProposalsLoading,
    isBestApyReservesLoading,
    bestApyReservesByStablecoin,
    scopedErrors,
    error,
    totalUsd,
    vaultEntries,
    selectedVaultIndex,
    setSelectedVaultIndex,
    selectedVault,
    approvals,
    loadVaultActivity,
    refresh,
    refreshGroups,
    refreshMutationPlan,
    refreshEarnState,
    refreshAfterTx,
    approveProposal: (proposal) => runProposalAction(proposal, "approve"),
    rejectProposal: (proposal) => runProposalAction(proposal, "reject"),
    executeProposal: (proposal) => runProposalAction(proposal, "execute"),
    addInitiateSigner,
    updateSignerPermissions,
    deleteSigner,
    setSignerSpendingLimitUsd,
    topUpSignerWithSpendingLimitUsd,
    deleteSignerSpendingLimit,
    evaluateVaultTransferCapability,
    executeVaultTransfer,
    executeVaultSwap,
    executeEarnDeposit,
    executeEarnDepositBatch,
    executeEarnDepositPolicyStage,
    executeEarnPolicySetup,
    executeEarnWithdraw,
    executeEarnCleanup,
    prepareEarnAutodepositSetup,
    prepareEarnAutodepositClose,
    executeEarnAutodepositSetup,
    executeEarnAutodepositFloorUpdate,
    executeEarnAutodepositToggle,
    executeEarnAutodepositClose,
    isActionPending,
    requiresEarnPolicySetupForDeposit,
    pendingProposalId,
    pendingSpendingLimitActionKey,
    signerPortfolioByAddress,
    loadSignerPortfolio,
    loadSignerActivity,
  };
}
