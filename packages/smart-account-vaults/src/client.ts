import bs58 from "bs58";
import BN from "bn.js";
import {
  createLoyalSmartAccountsClient,
  generated,
  pda,
  type LoyalSmartAccountsClient,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  LoyalCluster,
  RiskBasket,
  Stablecoin,
  SUBSCRIPTIONS_PROGRAM_ID,
  SUBSCRIPTIONS_TRANSFER_RECURRING,
  SUBSCRIPTION_AUTHORITY_DATA_LEN,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET,
  SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET,
  SUBSCRIPTION_TRANSFER_MINT_OFFSET,
  KAMINO_USER_METADATA_SEED,
  KAMINO_VANILLA_OBLIGATION_ID,
  KAMINO_VANILLA_OBLIGATION_TAG,
  createYieldRoutePolicyPlan,
  createYieldRouteSetupPolicyPlan,
  deriveRecurringDelegation,
  deriveSubscriptionAuthority,
  deriveSubscriptionEventAuthority,
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
  getStablecoinMintForCluster,
  getStablecoinMintsForCluster,
  subscriptionCreateRecurringDelegationData,
  subscriptionInitAuthorityData,
  subscriptionRevokeDelegationData,
  subscriptionTransferRecurringData,
} from "@loyal-labs/actions";
import { executePolicyTransaction as buildExecutePolicyTransactionInstruction } from "@loyal-labs/loyal-smart-accounts-core/internal";
import {
  accountsForTransactionExecute,
  Policy,
  Permission,
  Permissions,
  Proposal,
  SettingsTransaction,
  compilePreparedOperation,
  Transaction,
  freezePreparedOperation,
  instructionsToSynchronousTransactionDetailsV2,
  policyDiscriminator,
  proposalDiscriminator,
  settingsTransactionDiscriminator,
  toBigInt,
  transactionMessageBeet,
  transactionDiscriminator,
  transactionMessageToMultisigTransactionMessageBytes,
  type SettingsAction,
  type SmartAccountSigner,
} from "@loyal-labs/loyal-smart-accounts-core";
import {
  NATIVE_SOL_MINT,
  type PortfolioPosition,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { decodeSolanaInstruction } from "@loyal-labs/solana-instruction-decoder";
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createRevokeInstruction,
  createTransferCheckedInstruction,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  SystemInstruction,
  TransactionInstruction,
  type AccountMeta,
  type AccountInfo,
  type AddressLookupTableAccount,
  type Connection,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";
import {
  createVaultCustomInstructionMessage,
  createVaultSolTransferMessage,
  createVaultSplTransferMessage,
  isSupportedTokenProgram,
  resolveVaultAccountIndex,
} from "./messages";
import type {
  SmartAccountOverview,
  SmartAccountOverviewBase,
  SmartAccountAddSignerProposalInput,
  SmartAccountAddRootSignerInput,
  SmartAccountClosePoliciesProposalInput,
  SmartAccountClosePoliciesSyncInput,
  SmartAccountClosePolicyProposalInput,
  SmartAccountClosePolicySyncInput,
  SmartAccountEarnUsdcAutodepositCloseInput,
  SmartAccountEarnUsdcAutodepositCanonicalArtifactsInput,
  SmartAccountEarnUsdcAutodepositSetupAccountEvidence,
  SmartAccountEarnUsdcAutodepositPullInput,
  SmartAccountEarnUsdcAutodepositSetupInput,
  SmartAccountCustomInstructionProposalInput,
  SmartAccountEarnUsdcCleanupInput,
  SmartAccountEarnUsdcDepositInput,
  SmartAccountEarnVaultRefundInput,
  SmartAccountEarnVaultRefundSnapshot,
  SmartAccountEarnUsdcReserveTargetInput,
  SmartAccountEarnUsdcYieldRoutingPolicyInput,
  SmartAccountNativeSolRequirement,
  SmartAccountNativeSolRequirementItem,
  SmartAccountEarnUsdcWithdrawInput,
  SmartAccountPolicyOverview,
  SmartAccountPolicySnapshot,
  SmartAccountPolicyCustomInstructionProposalInput,
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositPull,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
  SmartAccountPreparedEarnUsdcCleanup,
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnVaultRefund,
  SmartAccountPreparedEarnUsdcWithdrawStep,
  SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
  SmartAccountPreparedEarnUsdcWithdraw,
  SmartAccountPreparedSettingsChange,
  SmartAccountProposalPayloadType,
  SmartAccountProposalSnapshot,
  SmartAccountProposalStatus,
  SmartAccountRemoveSpendingLimitProposalInput,
  SmartAccountSetSpendingLimitProposalInput,
  SmartAccountSignerPermission,
  SmartAccountSignerSnapshot,
  SmartAccountSpendingLimitSnapshot,
  SmartAccountProposalSummary,
  SmartAccountRemoveSignerProposalInput,
  SmartAccountRemoveRootSignerInput,
  SmartAccountUpdateSignerPermissionsInput,
  SmartAccountTokenTransferProposalInput,
  SmartAccountTransferProposalInput,
  SmartAccountUseSpendingLimitInput,
  SmartAccountVaultSnapshot,
  SmartAccountVaultBaseSnapshot,
  SmartAccountVaultsClientConfig,
} from "./types";
import {
  SOL_SPENDING_LIMIT_MINT,
  formatTokenAmount,
  getEffectiveSpendingLimitRemainingAmount,
  getSpendingLimitNextReset,
  toSpendingLimitPeriodLabel,
  tokenAmountToNumber,
  type SmartAccountSpendingLimitPeriod,
} from "./spending-limits";
import type { EarnPolicyCreateSimulationDiagnosticsMetadata } from "./simulation-diagnostics";

const SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET = BigInt(64);

type VaultMessage = {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: PublicKey[];
  instructions: Array<{
    programIdIndex: number;
    accountIndexes: Uint8Array | number[];
    data: Uint8Array | number[];
  }>;
  addressTableLookups?: Array<{
    accountKey: PublicKey;
    writableIndexes: Uint8Array | number[];
    readonlyIndexes: Uint8Array | number[];
  }>;
};

type TransactionPayloadDetailsLike = {
  accountIndex: number;
  message: VaultMessage;
};

type TransactionPayloadLike = Transaction["payload"] & {
  __kind: "TransactionPayload";
  fields: [TransactionPayloadDetailsLike];
};

type PolicyPayloadLike = Transaction["payload"] & {
  __kind: "PolicyPayload";
  fields: [{ payload: generated.PolicyPayload }];
};

type AsyncPolicyTransactionPayloadLike = {
  accountIndex: number;
  transactionMessage: Uint8Array;
};

const EARN_DEPOSIT_VAULT_INDEX = 1 as const;
const EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES = [0, 1] as const;
const EARN_POLICY_PACKET_DATA_SIZE = 1232;
const EARN_DEPOSIT_USDC_DECIMALS = 6;
const EARN_RISK_PROFILE = RiskBasket.Safe;
const EARN_ROUTE_MODES = ["same_mint_kamino"] as const;
const EARN_UNIVERSE_PRESET = "canonical_stable_kamino";
const SYSVAR_RENT_PUBKEY = new PublicKey(
  "SysvarRent111111111111111111111111111111111"
);
const DEFAULT_PUBKEY = PublicKey.default;
const KAMINO_DEVNET_USDC_RESERVE_LIQUIDITY_SUPPLY = new PublicKey(
  "Bh45cPkpfRvz9hAs23ye5TowsGbhbh4BXT4AGww8JfES"
);
const KAMINO_DEVNET_USDC_RESERVE_COLLATERAL_MINT = new PublicKey(
  "8GoBXfEq3aTiWTxEP2tAaygJMx3LhG764iN5e6gqaLA"
);
const KAMINO_DEPOSIT_INSTRUCTIONS_URL =
  "https://api.kamino.finance/ktx/klend/deposit-instructions";
const KAMINO_WITHDRAW_INSTRUCTIONS_URL =
  "https://api.kamino.finance/ktx/klend/withdraw-instructions";
const KAMINO_BROWSER_DEPOSIT_INSTRUCTIONS_URL =
  "/api/kamino/klend/deposit-instructions";
const KAMINO_BROWSER_WITHDRAW_INSTRUCTIONS_URL =
  "/api/kamino/klend/withdraw-instructions";
const KAMINO_EARN_SETUP_RENT_BUFFER_LAMPORTS = 39_532_800;
const KAMINO_FARMS_PROGRAM_ID = new PublicKey(
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
);
const KAMINO_RESERVE_DISCRIMINATOR = Buffer.from([
  43, 242, 204, 202, 26, 247, 59, 127,
]);
const KAMINO_OBLIGATION_DISCRIMINATOR = Buffer.from([
  168, 206, 141, 106, 88, 76, 172, 167,
]);
const KAMINO_FRACTION_BITS = BigInt(60);
const KAMINO_FRACTION_SCALE = BigInt(1) << KAMINO_FRACTION_BITS;
const KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET = 8;
const KAMINO_RESERVE_LAYOUT_OFFSETS = {
  lendingMarket: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 24,
  farmCollateral: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 56,
  farmDebt: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 88,
  liquidityMintPubkey: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 120,
  liquiditySupplyVault: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 152,
  liquidityAvailableAmount: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 216,
  liquidityBorrowedAmountSf: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 224,
  liquidityAccumulatedProtocolFeesSf:
    KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 336,
  liquidityAccumulatedReferrerFeesSf:
    KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 352,
  liquidityPendingReferrerFeesSf:
    KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 368,
  collateralMintPubkey: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 2552,
  collateralMintTotalSupply: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 2584,
  collateralSupplyVault: KAMINO_RESERVE_ACCOUNT_DISCRIMINATOR_OFFSET + 2592,
} as const;
const KAMINO_OBLIGATION_LAYOUT_OFFSETS = {
  lendingMarket: KAMINO_OBLIGATION_DISCRIMINATOR.length + 24,
  owner: KAMINO_OBLIGATION_DISCRIMINATOR.length + 56,
  deposits: KAMINO_OBLIGATION_DISCRIMINATOR.length + 88,
} as const;
const KAMINO_OBLIGATION_DEPOSIT_SLOT_COUNT = 8;
const KAMINO_OBLIGATION_DEPOSIT_OFFSET = 96;
const KAMINO_OBLIGATION_DEPOSIT_SIZE = 136;
const KAMINO_OBLIGATION_DEPOSIT_DEPOSITED_AMOUNT_OFFSET = 32;
const KAMINO_SETUP_INSTRUCTION_DISCRIMINATORS = [
  [117, 169, 176, 69, 197, 23, 15, 162],
  [251, 10, 231, 76, 27, 11, 159, 96],
  [136, 63, 15, 186, 211, 152, 168, 164],
] as const;
const KAMINO_INIT_OBLIGATION_FARMS_FOR_RESERVE_DISCRIMINATOR =
  KAMINO_SETUP_INSTRUCTION_DISCRIMINATORS[2];
const KAMINO_RESERVE_FARM_KIND_COLLATERAL = 0;
const KAMINO_REFRESH_OBLIGATION_DISCRIMINATOR = [
  33, 132, 147, 228, 151, 192, 72, 89,
] as const;

type KaminoDepositInstructionResponse = {
  instructions?: Array<{
    accounts?: Array<{
      address?: unknown;
      role?: unknown;
    }>;
    data?: unknown;
    programAddress?: unknown;
  }>;
};

type KaminoInstructionResponse = KaminoDepositInstructionResponse;

type KaminoEarnTarget = ReturnType<typeof getKaminoUsdcEarnTargetForCluster> & {
  reserveCollateralMint?: PublicKey;
  reserveLiquiditySupply?: PublicKey;
  supplyApyBps: bigint | null;
};

type EarnPolicyUniverse = {
  kaminoLiquidityMints: PublicKey[];
  kaminoMarkets: PublicKey[];
  riskProfile: RiskBasket;
  routeModes: readonly string[];
  stableMints: PublicKey[];
  universePreset: string;
};

type KaminoInstructionBundle = {
  instruction: TransactionInstruction;
  instructions: TransactionInstruction[];
  matchingInstructions: TransactionInstruction[];
};

export type KaminoReserveSnapshot = {
  collateralSupplyRaw: bigint;
  totalLiquiditySupplyScaled: bigint;
};

export type KaminoObligationDeposit = {
  depositedAmountRaw: bigint;
  reserve: PublicKey;
  slotIndex: number;
};

export type KaminoObligationAccount = {
  deposits: KaminoObligationDeposit[];
  lendingMarket: PublicKey;
  owner: PublicKey;
};

export type KaminoReserveTokenAccounts = {
  farmCollateral: PublicKey;
  farmDebt: PublicKey;
  lendingMarket: PublicKey;
  reserveCollateralMint: PublicKey;
  reserveCollateralSupply: PublicKey;
  reserveLiquidityMint: PublicKey;
  reserveLiquiditySupply: PublicKey;
};

function resolveKaminoEarnTarget(
  cluster: LoyalCluster,
  target?: SmartAccountEarnUsdcReserveTargetInput
): KaminoEarnTarget {
  const defaultTarget = getKaminoUsdcEarnTargetForCluster(cluster);
  const resolvedTarget: KaminoEarnTarget = target
    ? {
        ...defaultTarget,
        liquidityMint: target.liquidityMint,
        market: target.market,
        reserve: target.reserve,
        reserveCollateralMint: target.reserveCollateralMint,
        reserveLiquiditySupply: target.reserveLiquiditySupply,
        supplyApyBps: target.supplyApyBps ?? null,
      }
    : {
        ...defaultTarget,
        supplyApyBps: null,
      };

  if (cluster === LoyalCluster.Devnet) {
    return {
      ...resolvedTarget,
      reserveCollateralMint:
        resolvedTarget.reserveCollateralMint ??
        KAMINO_DEVNET_USDC_RESERVE_COLLATERAL_MINT,
      reserveLiquiditySupply:
        resolvedTarget.reserveLiquiditySupply ??
        KAMINO_DEVNET_USDC_RESERVE_LIQUIDITY_SUPPLY,
    };
  }

  return resolvedTarget;
}

function resolveEarnPolicyUniverse(cluster: LoyalCluster): EarnPolicyUniverse {
  const stableMints = [...getStablecoinMintsForCluster(cluster)];
  return {
    kaminoLiquidityMints: stableMints,
    kaminoMarkets: [
      ...getRiskBasketMarketsForCluster(cluster, EARN_RISK_PROFILE),
    ],
    riskProfile: EARN_RISK_PROFILE,
    routeModes: EARN_ROUTE_MODES,
    stableMints,
    universePreset: EARN_UNIVERSE_PRESET,
  };
}

function serializeEarnPolicyUniverse(universe: EarnPolicyUniverse) {
  return {
    kaminoLiquidityMints: universe.kaminoLiquidityMints.map((mint) =>
      mint.toBase58()
    ),
    kaminoMarkets: universe.kaminoMarkets.map((market) => market.toBase58()),
    riskProfile: universe.riskProfile,
    routeModes: [...universe.routeModes],
    stableMints: universe.stableMints.map((mint) => mint.toBase58()),
    universePreset: universe.universePreset,
  };
}

function earnPolicyUniverseFromPlan(
  plan: Pick<
    ReturnType<typeof createYieldRoutePolicyPlan>,
    "persistence" | "spec"
  >
): EarnPolicyUniverse {
  return {
    kaminoLiquidityMints: [...plan.spec.kaminoLiquidityMints],
    kaminoMarkets: [...plan.spec.kaminoMarkets],
    riskProfile: plan.persistence.riskProfile,
    routeModes: plan.persistence.routeModes,
    stableMints: [...plan.spec.stableMints],
    universePreset: plan.persistence.universePreset,
  };
}

function preparedPacketLength(
  prepared: PreparedLoyalSmartAccountsOperation<string>
): number | null {
  try {
    return compilePreparedOperation({
      blockhash: "11111111111111111111111111111111",
      prepared,
    }).serialize().length;
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

const FALLBACK_LAMPORTS_PER_SIGNATURE = 5_000;
const RENT_EXEMPT_ACCOUNT_STORAGE_OVERHEAD_BYTES = BigInt(128);
const MAINNET_RENT_EXEMPT_LAMPORTS_PER_BYTE = BigInt(6_960);
const rentExemptionLamportsCache = new Map<string, bigint>();

type NativeSolRentCandidate = {
  account: PublicKey;
  exists?: boolean;
  kind: SmartAccountNativeSolRequirementItem["kind"];
  label: string;
  space: number;
  stage: string;
};

type NativeSolFixedItem = Omit<
  SmartAccountNativeSolRequirementItem,
  "lamports"
> & {
  lamports: bigint | number | string;
};

type NativeSolBalanceSource = NonNullable<
  SmartAccountNativeSolRequirement["balanceSource"]
>;

type PolicyByteSizeArgs = Parameters<typeof Policy.byteSize>[0];

function toLamportsBigInt(lamports: bigint | number | string): bigint {
  if (typeof lamports === "bigint") {
    return lamports;
  }

  if (typeof lamports === "number") {
    return BigInt(Math.max(0, Math.trunc(lamports)));
  }

  return BigInt(lamports);
}

function getFallbackPreparedFeeLamports(
  prepared: PreparedLoyalSmartAccountsOperation<string>
): bigint {
  return (
    BigInt(getPreparedRequiredSignatureCount(prepared)) *
    BigInt(FALLBACK_LAMPORTS_PER_SIGNATURE)
  );
}

function getStaticMainnetRentExemptionLamports(space: number): bigint {
  return (
    (BigInt(space) + RENT_EXEMPT_ACCOUNT_STORAGE_OVERHEAD_BYTES) *
    MAINNET_RENT_EXEMPT_LAMPORTS_PER_BYTE
  );
}

async function resolveRentExemptionLamports(args: {
  cluster?: LoyalCluster;
  connection: Connection;
  preferStaticMainnetRent?: boolean;
  space: number;
}): Promise<bigint | null> {
  if (
    args.preferStaticMainnetRent &&
    (args.cluster === undefined || args.cluster === LoyalCluster.MainnetBeta)
  ) {
    return getStaticMainnetRentExemptionLamports(args.space);
  }

  if (typeof args.connection.getMinimumBalanceForRentExemption !== "function") {
    return null;
  }

  const cacheKey = `${args.cluster ?? "unknown"}:${args.space}`;
  const cached = rentExemptionLamportsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const lamports = await args.connection.getMinimumBalanceForRentExemption(
    args.space,
    "confirmed"
  );
  if (lamports <= 0) {
    return null;
  }

  const normalized = BigInt(lamports);
  rentExemptionLamportsCache.set(cacheKey, normalized);
  return normalized;
}

function policyCreationPayloadToState(
  payload: generated.PolicyCreationPayload
): PolicyByteSizeArgs["policyState"] {
  return payload as unknown as PolicyByteSizeArgs["policyState"];
}

function normalizeComparableGeneratedValue(value: unknown): unknown {
  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  if (BN.isBN(value)) {
    return value.toString(10);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableGeneratedValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeComparableGeneratedValue(entry)])
    );
  }

  return value;
}

function generatedValuesEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeComparableGeneratedValue(left)) ===
    JSON.stringify(normalizeComparableGeneratedValue(right))
  );
}

function policyRentSpace(args: {
  feePayer: PublicKey;
  policyPayload: generated.PolicyCreationPayload;
  policySeed: bigint;
  policySigner: PublicKey;
  programId: PublicKey;
  settingsPda: PublicKey;
}): number {
  const [, bump] = pda.getPolicyPda({
    programId: args.programId,
    settingsPda: args.settingsPda,
    policySeed: Number(args.policySeed),
  });

  return Policy.byteSize({
    bump,
    expiration: null,
    policyState: policyCreationPayloadToState(args.policyPayload),
    rentCollector: args.feePayer,
    seed: toBn(args.policySeed),
    settings: args.settingsPda,
    signers: [createPolicySigner(args.policySigner)],
    staleTransactionIndex: toBn(BigInt(0)),
    start: toBn(BigInt(0)),
    threshold: 1,
    timeLock: 0,
    transactionIndex: toBn(BigInt(0)),
  });
}

function getPreparedRequiredSignatureCount(
  prepared: PreparedLoyalSmartAccountsOperation<string>
): number {
  try {
    const transaction = compilePreparedOperation({
      blockhash: "11111111111111111111111111111111",
      prepared,
    });

    return Math.max(1, transaction.message.header.numRequiredSignatures);
  } catch {
    return 1;
  }
}

async function estimatePreparedFeeLamports(args: {
  connection: Connection;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
}): Promise<bigint> {
  const fallback = getFallbackPreparedFeeLamports(args.prepared);
  const connectionWithFees = args.connection as Connection & {
    getFeeForMessage?: (
      message: ReturnType<typeof compilePreparedOperation>["message"],
      commitment?: "confirmed"
    ) => Promise<{ value: number | null } | number | null>;
    getLatestBlockhash?: (
      commitment?: "confirmed"
    ) => Promise<{ blockhash: string }>;
  };

  if (typeof connectionWithFees.getFeeForMessage !== "function") {
    return fallback;
  }

  try {
    const latestBlockhash =
      typeof connectionWithFees.getLatestBlockhash === "function"
        ? await connectionWithFees.getLatestBlockhash("confirmed")
        : { blockhash: "11111111111111111111111111111111" };
    const transaction = compilePreparedOperation({
      blockhash: latestBlockhash.blockhash,
      prepared: args.prepared,
    });
    const feeResponse = await connectionWithFees.getFeeForMessage(
      transaction.message,
      "confirmed"
    );
    const fee =
      typeof feeResponse === "number" ? feeResponse : feeResponse?.value;

    return typeof fee === "number" && fee >= 0 ? BigInt(fee) : fallback;
  } catch {
    return fallback;
  }
}

async function getExistingAccountSet(args: {
  accounts: readonly PublicKey[];
  connection: Connection;
}): Promise<Set<string>> {
  const accounts = dedupePublicKeys(args.accounts);
  const existing = new Set<string>();

  if (accounts.length === 0) {
    return existing;
  }

  const connectionWithBatch = args.connection as Connection & {
    getMultipleAccountsInfo?: (
      publicKeys: PublicKey[],
      commitment?: "confirmed"
    ) => Promise<Array<AccountInfo<Buffer> | null>>;
  };

  if (typeof connectionWithBatch.getMultipleAccountsInfo === "function") {
    try {
      const infos = await connectionWithBatch.getMultipleAccountsInfo(
        accounts,
        "confirmed"
      );
      infos.forEach((info, index) => {
        if (info) {
          existing.add(accounts[index]!.toBase58());
        }
      });
      return existing;
    } catch {
      // Fall back to single-account reads below.
    }
  }

  if (typeof args.connection.getAccountInfo !== "function") {
    return existing;
  }

  for (const account of accounts) {
    try {
      const info = await args.connection.getAccountInfo(account, "confirmed");
      if (info) {
        existing.add(account.toBase58());
      }
    } catch {
      // Missing account probes are best effort; unknown accounts are treated as missing.
    }
  }

  return existing;
}

async function getAccountInfoMap(args: {
  accounts: readonly PublicKey[];
  connection: Connection;
}): Promise<Map<string, AccountInfo<Buffer> | null>> {
  const accounts = dedupePublicKeys(args.accounts);
  const results = new Map<string, AccountInfo<Buffer> | null>();

  if (accounts.length === 0) {
    return results;
  }

  const connectionWithBatch = args.connection as Connection & {
    getMultipleAccountsInfo?: (
      publicKeys: PublicKey[],
      commitment?: "confirmed"
    ) => Promise<Array<AccountInfo<Buffer> | null>>;
  };

  if (typeof connectionWithBatch.getMultipleAccountsInfo === "function") {
    try {
      const infos = await connectionWithBatch.getMultipleAccountsInfo(
        accounts,
        "confirmed"
      );
      accounts.forEach((account, index) => {
        results.set(account.toBase58(), infos[index] ?? null);
      });
      return results;
    } catch {
      // Fall back to single-account reads below.
    }
  }

  for (const account of accounts) {
    results.set(
      account.toBase58(),
      await args.connection.getAccountInfo(account, "confirmed")
    );
  }

  return results;
}

async function estimateNativeSolRequirement(args: {
  balanceLamports?: bigint | number | string;
  balanceSource?: NativeSolBalanceSource;
  checkBalance?: boolean;
  cluster?: LoyalCluster;
  connection: Connection;
  estimateFees?: boolean;
  fixedItems?: readonly NativeSolFixedItem[];
  payer: PublicKey;
  preferStaticMainnetRent?: boolean;
  prepared: readonly PreparedLoyalSmartAccountsOperation<string>[];
  rentCandidates?: readonly NativeSolRentCandidate[];
}): Promise<SmartAccountNativeSolRequirement> {
  const fixedItems = args.fixedItems ?? [];
  const rentCandidates = args.rentCandidates ?? [];
  const unknownRentCandidates = rentCandidates.filter(
    (candidate) => candidate.exists === undefined
  );
  const existingAccounts = await getExistingAccountSet({
    accounts: unknownRentCandidates.map((candidate) => candidate.account),
    connection: args.connection,
  });
  const items: SmartAccountNativeSolRequirementItem[] = [];

  for (const item of fixedItems) {
    const lamports = toLamportsBigInt(item.lamports);
    if (lamports <= BigInt(0)) {
      continue;
    }

    items.push({
      ...item,
      lamports: lamports.toString(),
    });
  }

  for (const candidate of rentCandidates) {
    const accountKey = candidate.account.toBase58();
    const exists =
      candidate.exists === undefined
        ? existingAccounts.has(accountKey)
        : candidate.exists;
    if (exists) {
      continue;
    }
    const lamports = await resolveRentExemptionLamports({
      cluster: args.cluster,
      connection: args.connection,
      preferStaticMainnetRent: args.preferStaticMainnetRent,
      space: candidate.space,
    });
    if (lamports === null || lamports <= BigInt(0)) {
      continue;
    }

    items.push({
      account: accountKey,
      kind: candidate.kind,
      label: candidate.label,
      lamports: lamports.toString(),
      stage: candidate.stage,
    });
  }

  for (const [index, prepared] of args.prepared.entries()) {
    const lamports =
      args.estimateFees === false
        ? getFallbackPreparedFeeLamports(prepared)
        : await estimatePreparedFeeLamports({
            connection: args.connection,
            prepared,
          });
    if (lamports <= BigInt(0)) {
      continue;
    }

    items.push({
      kind: "transaction_fee",
      label: "Estimated transaction fee",
      lamports: lamports.toString(),
      stage: prepared.operation || `transaction_${index + 1}`,
    });
  }

  const requiredLamports = items.reduce(
    (total, item) => total + BigInt(item.lamports),
    BigInt(0)
  );
  const balanceSource: NativeSolBalanceSource =
    args.balanceSource ??
    (args.balanceLamports !== undefined
      ? "provided"
      : args.checkBalance === false
      ? "assumed_sufficient"
      : "queried");
  const balanceLamports =
    args.balanceLamports !== undefined
      ? toLamportsBigInt(args.balanceLamports)
      : args.checkBalance === false ||
        typeof args.connection.getBalance !== "function"
      ? requiredLamports
      : BigInt(await args.connection.getBalance(args.payer, "confirmed"));
  const deficitLamports =
    requiredLamports > balanceLamports
      ? requiredLamports - balanceLamports
      : BigInt(0);

  return {
    balanceLamports: balanceLamports.toString(),
    balanceSource,
    canProceed: deficitLamports === BigInt(0),
    deficitLamports: deficitLamports.toString(),
    items,
    payer: args.payer.toBase58(),
    requiredLamports: requiredLamports.toString(),
  };
}

function getLendingMarketAuthority(args: {
  market: PublicKey;
  lendProgramId: PublicKey;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), args.market.toBuffer()],
    args.lendProgramId
  )[0];
}

function encodeU64InstructionData(
  discriminator: readonly number[],
  amountRaw: bigint
): Buffer {
  if (amountRaw < BigInt(0) || amountRaw > BigInt("18446744073709551615")) {
    throw new Error("Kamino instruction amount must fit in u64.");
  }

  const data = new Uint8Array(16);
  data.set(discriminator, 0);
  new DataView(data.buffer).setBigUint64(8, amountRaw, true);
  return Buffer.from(data);
}

function bufferStartsWith(data: Buffer, prefix: Buffer): boolean {
  if (data.length < prefix.length) {
    return false;
  }

  return prefix.every((byte, index) => data[index] === byte);
}

function readUint64LE(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.length) {
    throw new RangeError("Cannot read u64 outside the provided byte range.");
  }

  let value = BigInt(0);
  for (let index = 0; index < 8; index += 1) {
    value += BigInt(data[offset + index] ?? 0) << BigInt(index * 8);
  }
  return value;
}

function readUint128LE(data: Uint8Array, offset: number): bigint {
  const low = readUint64LE(data, offset);
  const high = readUint64LE(data, offset + 8);
  return low + (high << BigInt(64));
}

function readPublicKey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function assertKaminoReserveAccountData(data: Buffer | Uint8Array): Buffer {
  const normalizedData = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!bufferStartsWith(normalizedData, KAMINO_RESERVE_DISCRIMINATOR)) {
    throw new Error("Kamino reserve account has an invalid discriminator.");
  }

  return normalizedData;
}

function assertKaminoObligationAccountData(data: Buffer | Uint8Array): Buffer {
  const normalizedData = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!bufferStartsWith(normalizedData, KAMINO_OBLIGATION_DISCRIMINATOR)) {
    throw new Error("Kamino obligation account has an invalid discriminator.");
  }

  return normalizedData;
}

export function parseKaminoReserveTokenAccounts(
  data: Buffer | Uint8Array
): KaminoReserveTokenAccounts {
  const normalizedData = assertKaminoReserveAccountData(data);
  const requiredLength =
    KAMINO_RESERVE_LAYOUT_OFFSETS.collateralSupplyVault + 32;
  if (normalizedData.length < requiredLength) {
    throw new Error("Kamino reserve account is smaller than expected.");
  }

  return {
    farmCollateral: readPublicKey(
      normalizedData,
      KAMINO_RESERVE_LAYOUT_OFFSETS.farmCollateral
    ),
    farmDebt: readPublicKey(
      normalizedData,
      KAMINO_RESERVE_LAYOUT_OFFSETS.farmDebt
    ),
    lendingMarket: readPublicKey(
      normalizedData,
      KAMINO_RESERVE_LAYOUT_OFFSETS.lendingMarket
    ),
    reserveCollateralMint: readPublicKey(
      normalizedData,
      KAMINO_RESERVE_LAYOUT_OFFSETS.collateralMintPubkey
    ),
    reserveCollateralSupply: readPublicKey(
      normalizedData,
      KAMINO_RESERVE_LAYOUT_OFFSETS.collateralSupplyVault
    ),
    reserveLiquidityMint: readPublicKey(
      normalizedData,
      KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityMintPubkey
    ),
    reserveLiquiditySupply: readPublicKey(
      normalizedData,
      KAMINO_RESERVE_LAYOUT_OFFSETS.liquiditySupplyVault
    ),
  };
}

export function parseKaminoObligationAccount(
  data: Buffer | Uint8Array
): KaminoObligationAccount {
  const normalizedData = assertKaminoObligationAccountData(data);
  const requiredLength =
    KAMINO_OBLIGATION_DEPOSIT_OFFSET +
    KAMINO_OBLIGATION_DEPOSIT_SLOT_COUNT * KAMINO_OBLIGATION_DEPOSIT_SIZE;
  if (normalizedData.length < requiredLength) {
    throw new Error("Kamino obligation account is smaller than expected.");
  }

  const deposits: KaminoObligationDeposit[] = [];
  for (
    let slotIndex = 0;
    slotIndex < KAMINO_OBLIGATION_DEPOSIT_SLOT_COUNT;
    slotIndex += 1
  ) {
    const offset =
      KAMINO_OBLIGATION_LAYOUT_OFFSETS.deposits +
      slotIndex * KAMINO_OBLIGATION_DEPOSIT_SIZE;
    const reserve = readPublicKey(normalizedData, offset);
    const depositedAmountRaw = readUint64LE(
      normalizedData,
      offset + KAMINO_OBLIGATION_DEPOSIT_DEPOSITED_AMOUNT_OFFSET
    );
    if (reserve.equals(DEFAULT_PUBKEY) || depositedAmountRaw <= BigInt(0)) {
      continue;
    }

    deposits.push({
      depositedAmountRaw,
      reserve,
      slotIndex,
    });
  }

  return {
    deposits,
    lendingMarket: readPublicKey(
      normalizedData,
      KAMINO_OBLIGATION_LAYOUT_OFFSETS.lendingMarket
    ),
    owner: readPublicKey(
      normalizedData,
      KAMINO_OBLIGATION_LAYOUT_OFFSETS.owner
    ),
  };
}

export function parseKaminoObligationDeposits(
  data: Buffer | Uint8Array
): KaminoObligationDeposit[] {
  return parseKaminoObligationAccount(data).deposits;
}

function deriveKaminoFarmUserStatePda(args: {
  farmState: PublicKey;
  owner: PublicKey;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), args.farmState.toBuffer(), args.owner.toBuffer()],
    KAMINO_FARMS_PROGRAM_ID
  )[0];
}

export function parseKaminoReserveSnapshot(
  data: Buffer | Uint8Array
): KaminoReserveSnapshot {
  const normalizedData = assertKaminoReserveAccountData(data);

  const requiredLength =
    KAMINO_RESERVE_LAYOUT_OFFSETS.collateralMintTotalSupply + 8;
  if (normalizedData.length < requiredLength) {
    throw new Error("Kamino reserve account is smaller than expected.");
  }

  const liquidityAvailableAmount = readUint64LE(
    normalizedData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAvailableAmount
  );
  const liquidityBorrowedAmountSf = readUint128LE(
    normalizedData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityBorrowedAmountSf
  );
  const liquidityAccumulatedProtocolFeesSf = readUint128LE(
    normalizedData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAccumulatedProtocolFeesSf
  );
  const liquidityAccumulatedReferrerFeesSf = readUint128LE(
    normalizedData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAccumulatedReferrerFeesSf
  );
  const liquidityPendingReferrerFeesSf = readUint128LE(
    normalizedData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityPendingReferrerFeesSf
  );
  const collateralSupplyRaw = readUint64LE(
    normalizedData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.collateralMintTotalSupply
  );
  const grossLiquiditySupplyScaled =
    (liquidityAvailableAmount << KAMINO_FRACTION_BITS) +
    liquidityBorrowedAmountSf;
  const totalFeeAmountScaled =
    liquidityAccumulatedProtocolFeesSf +
    liquidityAccumulatedReferrerFeesSf +
    liquidityPendingReferrerFeesSf;

  return {
    collateralSupplyRaw,
    totalLiquiditySupplyScaled:
      grossLiquiditySupplyScaled > totalFeeAmountScaled
        ? grossLiquiditySupplyScaled - totalFeeAmountScaled
        : BigInt(0),
  };
}

export function parseKaminoObligationDepositedCollateralAmountRaw(args: {
  data: Buffer | Uint8Array;
  reserve: PublicKey;
}): bigint {
  return (
    parseKaminoObligationDeposits(args.data).find((deposit) =>
      deposit.reserve.equals(args.reserve)
    )?.depositedAmountRaw ?? BigInt(0)
  );
}

export function calculateKaminoRedeemableLiquidityAmountRaw(args: {
  collateralAmountRaw: bigint;
  snapshot: KaminoReserveSnapshot;
}): bigint {
  if (args.collateralAmountRaw <= BigInt(0)) {
    return BigInt(0);
  }
  if (
    args.snapshot.collateralSupplyRaw === BigInt(0) ||
    args.snapshot.totalLiquiditySupplyScaled === BigInt(0)
  ) {
    return args.collateralAmountRaw;
  }

  return (
    (args.collateralAmountRaw * args.snapshot.totalLiquiditySupplyScaled) /
    (args.snapshot.collateralSupplyRaw * KAMINO_FRACTION_SCALE)
  );
}

export function calculateKaminoCollateralAmountForRedeemableLiquidityRaw(args: {
  liquidityAmountRaw: bigint;
  snapshot: KaminoReserveSnapshot;
}): bigint {
  if (args.liquidityAmountRaw <= BigInt(0)) {
    return BigInt(0);
  }
  if (
    args.snapshot.collateralSupplyRaw === BigInt(0) ||
    args.snapshot.totalLiquiditySupplyScaled === BigInt(0)
  ) {
    return args.liquidityAmountRaw;
  }

  const numerator =
    args.liquidityAmountRaw *
    args.snapshot.collateralSupplyRaw *
    KAMINO_FRACTION_SCALE;
  return (
    (numerator + args.snapshot.totalLiquiditySupplyScaled - BigInt(1)) /
    args.snapshot.totalLiquiditySupplyScaled
  );
}

export function resolveEarnUsdcVaultTokenAccounts(args: {
  cluster?: LoyalCluster;
  target?: SmartAccountEarnUsdcReserveTargetInput;
  vaultPda: PublicKey;
}): {
  collateralAta: PublicKey | null;
  targetReserve: {
    liquidityMint: PublicKey;
    market: PublicKey;
    reserve: PublicKey;
    reserveCollateralMint?: PublicKey;
  };
  usdcAta: PublicKey;
} {
  const target = resolveKaminoEarnTarget(
    args.cluster ?? LoyalCluster.MainnetBeta,
    args.target
  );
  const usdcAta = getAssociatedTokenAddressSync(
    target.liquidityMint,
    args.vaultPda,
    true,
    TOKEN_PROGRAM_ID
  );
  const collateralAta = target.reserveCollateralMint
    ? getAssociatedTokenAddressSync(
        target.reserveCollateralMint,
        args.vaultPda,
        true,
        TOKEN_PROGRAM_ID
      )
    : null;

  return {
    collateralAta,
    targetReserve: {
      liquidityMint: target.liquidityMint,
      market: target.market,
      reserve: target.reserve,
      reserveCollateralMint: target.reserveCollateralMint,
    },
    usdcAta,
  };
}

function requireLocalKaminoTargetAccounts(target: KaminoEarnTarget): {
  reserveCollateralMint: PublicKey;
  reserveLiquiditySupply: PublicKey;
} {
  if (!target.reserveCollateralMint || !target.reserveLiquiditySupply) {
    throw new Error("Local Kamino instruction target is incomplete.");
  }

  return {
    reserveCollateralMint: target.reserveCollateralMint,
    reserveLiquiditySupply: target.reserveLiquiditySupply,
  };
}

function createLocalKaminoDepositInstruction(args: {
  amountRaw: bigint;
  obligation?: PublicKey;
  reserveAccounts?: KaminoReserveTokenAccounts;
  target: KaminoEarnTarget;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
  vaultCollateralAta: PublicKey;
}): TransactionInstruction {
  if (args.obligation && args.reserveAccounts) {
    const lendingMarketAuthority = getLendingMarketAuthority({
      market: args.target.market,
      lendProgramId: args.target.lendProgramId,
    });
    const hasCollateralFarm = !args.reserveAccounts.farmCollateral.equals(
      PublicKey.default
    );
    const obligationFarmUserState = hasCollateralFarm
      ? deriveKaminoFarmUserStatePda({
          farmState: args.reserveAccounts.farmCollateral,
          owner: args.obligation,
        })
      : args.target.lendProgramId;
    const reserveFarmState = hasCollateralFarm
      ? args.reserveAccounts.farmCollateral
      : args.target.lendProgramId;

    return new TransactionInstruction({
      programId: args.target.lendProgramId,
      keys: [
        { pubkey: args.vaultPda, isSigner: true, isWritable: true },
        { pubkey: args.obligation, isSigner: false, isWritable: true },
        { pubkey: args.target.market, isSigner: false, isWritable: false },
        { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
        { pubkey: args.target.reserve, isSigner: false, isWritable: true },
        {
          pubkey: args.reserveAccounts.reserveLiquidityMint,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: args.reserveAccounts.reserveLiquiditySupply,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: args.reserveAccounts.reserveCollateralMint,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: args.reserveAccounts.reserveCollateralSupply,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: args.vaultUsdcAta, isSigner: false, isWritable: true },
        {
          pubkey: args.target.lendProgramId,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: obligationFarmUserState,
          isSigner: false,
          isWritable: hasCollateralFarm,
        },
        {
          pubkey: reserveFarmState,
          isSigner: false,
          isWritable: hasCollateralFarm,
        },
        { pubkey: KAMINO_FARMS_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeU64InstructionData(
        args.target.depositDiscriminator,
        args.amountRaw
      ),
    });
  }

  const { reserveCollateralMint, reserveLiquiditySupply } =
    requireLocalKaminoTargetAccounts(args.target);
  const lendingMarketAuthority = getLendingMarketAuthority({
    market: args.target.market,
    lendProgramId: args.target.lendProgramId,
  });

  return new TransactionInstruction({
    programId: args.target.lendProgramId,
    keys: [
      { pubkey: args.vaultPda, isSigner: true, isWritable: true },
      { pubkey: args.target.reserve, isSigner: false, isWritable: true },
      { pubkey: args.target.market, isSigner: false, isWritable: false },
      { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: args.target.liquidityMint, isSigner: false, isWritable: false },
      { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
      { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
      { pubkey: args.vaultUsdcAta, isSigner: false, isWritable: true },
      { pubkey: args.vaultCollateralAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: encodeU64InstructionData(
      args.target.depositDiscriminator,
      args.amountRaw
    ),
  });
}

function createLocalKaminoInitObligationFarmsForReserveInstruction(args: {
  obligation: PublicKey;
  reserveAccounts: KaminoReserveTokenAccounts;
  target: KaminoEarnTarget;
  vaultPda: PublicKey;
}): TransactionInstruction | null {
  if (args.reserveAccounts.farmCollateral.equals(PublicKey.default)) {
    return null;
  }

  const lendingMarketAuthority = getLendingMarketAuthority({
    market: args.target.market,
    lendProgramId: args.target.lendProgramId,
  });
  const obligationFarm = deriveKaminoFarmUserStatePda({
    farmState: args.reserveAccounts.farmCollateral,
    owner: args.obligation,
  });

  return new TransactionInstruction({
    programId: args.target.lendProgramId,
    keys: [
      { pubkey: args.vaultPda, isSigner: true, isWritable: true },
      { pubkey: args.vaultPda, isSigner: false, isWritable: false },
      { pubkey: args.obligation, isSigner: false, isWritable: true },
      { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: args.target.reserve, isSigner: false, isWritable: true },
      {
        pubkey: args.reserveAccounts.farmCollateral,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: obligationFarm, isSigner: false, isWritable: true },
      { pubkey: args.target.market, isSigner: false, isWritable: false },
      { pubkey: KAMINO_FARMS_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([
      ...KAMINO_INIT_OBLIGATION_FARMS_FOR_RESERVE_DISCRIMINATOR,
      KAMINO_RESERVE_FARM_KIND_COLLATERAL,
    ]),
  });
}

function insertKaminoSetupInstructionBeforeExecution(args: {
  instructions: TransactionInstruction[];
  setupInstruction: TransactionInstruction;
}): TransactionInstruction[] {
  const refreshObligationInstructionIndex = args.instructions.findIndex(
    (instruction) =>
      instruction.programId.equals(args.setupInstruction.programId) &&
      instructionDataStartsWith(
        instruction.data,
        KAMINO_REFRESH_OBLIGATION_DISCRIMINATOR
      )
  );
  if (refreshObligationInstructionIndex >= 0) {
    return [
      ...args.instructions.slice(0, refreshObligationInstructionIndex),
      args.setupInstruction,
      ...args.instructions.slice(refreshObligationInstructionIndex),
    ];
  }

  const firstExecutionInstructionIndex = args.instructions.findIndex(
    (instruction) =>
      instruction.programId.equals(args.setupInstruction.programId) &&
      !instructionStartsWithAnyDiscriminator(
        instruction,
        KAMINO_SETUP_INSTRUCTION_DISCRIMINATORS
      )
  );

  if (firstExecutionInstructionIndex < 0) {
    return [...args.instructions, args.setupInstruction];
  }

  return [
    ...args.instructions.slice(0, firstExecutionInstructionIndex),
    args.setupInstruction,
    ...args.instructions.slice(firstExecutionInstructionIndex),
  ];
}

function createLocalKaminoWithdrawInstruction(args: {
  amountRaw: bigint;
  obligation?: PublicKey;
  reserveAccounts?: KaminoReserveTokenAccounts;
  target: KaminoEarnTarget;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
  vaultCollateralAta: PublicKey;
}): TransactionInstruction {
  if (args.obligation && args.reserveAccounts) {
    const lendingMarketAuthority = getLendingMarketAuthority({
      market: args.target.market,
      lendProgramId: args.target.lendProgramId,
    });
    const hasCollateralFarm = !args.reserveAccounts.farmCollateral.equals(
      PublicKey.default
    );
    const obligationFarmUserState = hasCollateralFarm
      ? deriveKaminoFarmUserStatePda({
          farmState: args.reserveAccounts.farmCollateral,
          owner: args.obligation,
        })
      : args.target.lendProgramId;
    const reserveFarmState = hasCollateralFarm
      ? args.reserveAccounts.farmCollateral
      : args.target.lendProgramId;

    return new TransactionInstruction({
      programId: args.target.lendProgramId,
      keys: [
        { pubkey: args.vaultPda, isSigner: true, isWritable: true },
        { pubkey: args.obligation, isSigner: false, isWritable: true },
        { pubkey: args.target.market, isSigner: false, isWritable: false },
        { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
        { pubkey: args.target.reserve, isSigner: false, isWritable: true },
        {
          pubkey: args.reserveAccounts.reserveLiquidityMint,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: args.reserveAccounts.reserveCollateralSupply,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: args.reserveAccounts.reserveCollateralMint,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: args.reserveAccounts.reserveLiquiditySupply,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: args.vaultUsdcAta, isSigner: false, isWritable: true },
        {
          pubkey: args.target.lendProgramId,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: obligationFarmUserState,
          isSigner: false,
          isWritable: hasCollateralFarm,
        },
        {
          pubkey: reserveFarmState,
          isSigner: false,
          isWritable: hasCollateralFarm,
        },
        { pubkey: KAMINO_FARMS_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeU64InstructionData(
        args.target.withdrawDiscriminator,
        args.amountRaw
      ),
    });
  }

  const { reserveCollateralMint, reserveLiquiditySupply } =
    requireLocalKaminoTargetAccounts(args.target);
  const lendingMarketAuthority = getLendingMarketAuthority({
    market: args.target.market,
    lendProgramId: args.target.lendProgramId,
  });

  return new TransactionInstruction({
    programId: args.target.lendProgramId,
    keys: [
      { pubkey: args.vaultPda, isSigner: true, isWritable: true },
      { pubkey: args.target.market, isSigner: false, isWritable: false },
      { pubkey: args.target.reserve, isSigner: false, isWritable: true },
      { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: args.target.liquidityMint, isSigner: false, isWritable: false },
      { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
      { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
      { pubkey: args.vaultCollateralAta, isSigner: false, isWritable: true },
      { pubkey: args.vaultUsdcAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: encodeU64InstructionData(
      args.target.withdrawDiscriminator,
      args.amountRaw
    ),
  });
}

function dataSliceEqualsAt(
  offset: bigint,
  value: readonly number[] | Uint8Array
): generated.DataConstraint {
  return {
    dataOffset: toBn(offset),
    dataValue: { __kind: "U8Slice", fields: [Uint8Array.from(value)] },
    operator: generated.DataOperator.Equals,
  };
}

function dataSliceEquals(value: readonly number[]): generated.DataConstraint {
  return dataSliceEqualsAt(BigInt(0), value);
}

function dataU8Equals(offset: bigint, value: number): generated.DataConstraint {
  return {
    dataOffset: toBn(offset),
    dataValue: { __kind: "U8", fields: [value] },
    operator: generated.DataOperator.Equals,
  };
}

function dataU64LessThanOrEqualTo(
  offset: bigint,
  value: bigint
): generated.DataConstraint {
  return {
    dataOffset: toBn(offset),
    dataValue: { __kind: "U64Le", fields: [toBn(value)] },
    operator: generated.DataOperator.LessThanOrEqualTo,
  };
}

function dataU64GreaterThanOrEqualTo(
  offset: bigint,
  value: bigint
): generated.DataConstraint {
  return {
    dataOffset: toBn(offset),
    dataValue: { __kind: "U64Le", fields: [toBn(value)] },
    operator: generated.DataOperator.GreaterThanOrEqualTo,
  };
}

function accountDataBytesEqual(args: {
  offset: bigint;
  value: Uint8Array;
}): generated.DataConstraint {
  return {
    dataOffset: toBn(args.offset),
    dataValue: { __kind: "U8Slice", fields: [args.value] },
    operator: generated.DataOperator.Equals,
  };
}

function pubkeyAccountConstraint(
  accountIndex: number,
  pubkeys: PublicKey[],
  owner: PublicKey | null = null
): generated.AccountConstraint {
  return {
    accountIndex,
    accountConstraint: { __kind: "Pubkey", fields: [pubkeys] },
    owner,
  };
}

function tokenAuthorityAccountConstraint(
  accountIndex: number,
  authority: PublicKey
): generated.AccountConstraint {
  return {
    accountIndex,
    accountConstraint: {
      __kind: "AccountData",
      fields: [
        [
          accountDataBytesEqual({
            offset: BigInt(32),
            value: authority.toBytes(),
          }),
        ],
      ],
    },
    owner: TOKEN_PROGRAM_ID,
  };
}

function createSubscriptionSweepProgramInteractionPolicyCreationPayload(args: {
  delegator: PublicKey;
  vaultPda: PublicKey;
  mint: PublicKey;
  walletUsdcAta: PublicKey;
  vaultUsdcAta: PublicKey;
  maxAmountPerPeriodRaw: bigint;
  minimumDelegatorBalanceRaw?: bigint;
}): generated.PolicyCreationPayload {
  const subscriptionAuthority = deriveSubscriptionAuthority(
    args.delegator,
    args.mint
  );
  const eventAuthority = deriveSubscriptionEventAuthority();
  const recurringDelegationConstraint: generated.AccountConstraint = {
    accountIndex: 0,
    accountConstraint: {
      __kind: "AccountData",
      fields: [
        [
          dataU8Equals(
            BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET),
            SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR
          ),
          accountDataBytesEqual({
            offset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET),
            value: args.delegator.toBytes(),
          }),
          accountDataBytesEqual({
            offset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET),
            value: args.vaultPda.toBytes(),
          }),
          accountDataBytesEqual({
            offset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET),
            value: subscriptionAuthority.toBytes(),
          }),
          accountDataBytesEqual({
            offset: BigInt(SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET),
            value: args.mint.toBytes(),
          }),
          dataU64LessThanOrEqualTo(
            BigInt(SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET),
            args.maxAmountPerPeriodRaw
          ),
        ],
      ],
    },
    owner: SUBSCRIPTIONS_PROGRAM_ID,
  };
  const transferConstraint: generated.InstructionConstraint = {
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    accountConstraints: [
      recurringDelegationConstraint,
      pubkeyAccountConstraint(
        1,
        [subscriptionAuthority],
        SUBSCRIPTIONS_PROGRAM_ID
      ),
      pubkeyAccountConstraint(2, [args.walletUsdcAta], TOKEN_PROGRAM_ID),
      ...(args.minimumDelegatorBalanceRaw !== undefined
        ? [
            delegatorTokenBalanceAccountConstraint(
              args.minimumDelegatorBalanceRaw
            ),
          ]
        : []),
      pubkeyAccountConstraint(3, [args.vaultUsdcAta], TOKEN_PROGRAM_ID),
      pubkeyAccountConstraint(4, [args.mint], TOKEN_PROGRAM_ID),
      pubkeyAccountConstraint(5, [TOKEN_PROGRAM_ID]),
      pubkeyAccountConstraint(6, [args.vaultPda]),
      pubkeyAccountConstraint(7, [eventAuthority]),
      pubkeyAccountConstraint(8, [SUBSCRIPTIONS_PROGRAM_ID]),
    ],
    dataConstraints: [
      dataU8Equals(BigInt(0), SUBSCRIPTIONS_TRANSFER_RECURRING),
      dataSliceEqualsAt(
        BigInt(SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET),
        args.delegator.toBytes()
      ),
      dataSliceEqualsAt(
        BigInt(SUBSCRIPTION_TRANSFER_MINT_OFFSET),
        args.mint.toBytes()
      ),
    ],
  };

  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        instructionsConstraints: [transferConstraint],
        preHook: null,
        postHook: null,
        spendingLimits: [],
      },
    ],
  };
}

function delegatorTokenBalanceAccountConstraint(
  minimumBalanceRaw: bigint
): generated.AccountConstraint {
  return {
    accountIndex: 2,
    accountConstraint: {
      __kind: "AccountData",
      fields: [
        [
          dataU64GreaterThanOrEqualTo(
            SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET,
            minimumBalanceRaw
          ),
        ],
      ],
    },
    owner: TOKEN_PROGRAM_ID,
  };
}

function createEarnKaminoInstructionConstraint(args: {
  accountIndex: number;
  discriminator: readonly number[];
  includeLiquidityMints: boolean;
  liquidityMintAccountIndex?: number;
  target: KaminoEarnTarget;
  universe: EarnPolicyUniverse;
  vaultPda: PublicKey;
}): generated.InstructionConstraint {
  const accountConstraints: generated.AccountConstraint[] = [
    pubkeyAccountConstraint(0, [args.vaultPda]),
    pubkeyAccountConstraint(args.accountIndex, args.universe.kaminoMarkets),
  ];
  if (args.includeLiquidityMints) {
    accountConstraints.push(
      pubkeyAccountConstraint(
        args.liquidityMintAccountIndex ?? 5,
        args.universe.kaminoLiquidityMints,
        TOKEN_PROGRAM_ID
      )
    );
  }

  return {
    programId: args.target.lendProgramId,
    accountConstraints,
    dataConstraints: [dataSliceEquals(args.discriminator)],
  };
}

function createEarnProgramInteractionPolicyCreationPayload(args: {
  target: KaminoEarnTarget;
  universe: EarnPolicyUniverse;
  vaultPda: PublicKey;
}): generated.PolicyCreationPayload {
  const withdrawConstraint = createEarnKaminoInstructionConstraint({
    accountIndex: 2,
    discriminator: args.target.withdrawDiscriminator,
    includeLiquidityMints: false,
    target: args.target,
    universe: args.universe,
    vaultPda: args.vaultPda,
  });
  const depositConstraint = createEarnKaminoInstructionConstraint({
    accountIndex: 2,
    discriminator: args.target.depositDiscriminator,
    includeLiquidityMints: true,
    liquidityMintAccountIndex: 5,
    target: args.target,
    universe: args.universe,
    vaultPda: args.vaultPda,
  });
  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        instructionsConstraints: [withdrawConstraint, depositConstraint],
        preHook: null,
        postHook: null,
        spendingLimits: [],
      },
    ],
  };
}

function deriveKaminoVanillaObligation(
  vault: PublicKey,
  lendingMarket: PublicKey,
  lendProgramId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Uint8Array.of(KAMINO_VANILLA_OBLIGATION_TAG),
      Uint8Array.of(KAMINO_VANILLA_OBLIGATION_ID),
      vault.toBytes(),
      lendingMarket.toBytes(),
      DEFAULT_PUBKEY.toBytes(),
      DEFAULT_PUBKEY.toBytes(),
    ],
    lendProgramId
  )[0];
}

function deriveKaminoUserMetadata(
  vault: PublicKey,
  lendProgramId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [KAMINO_USER_METADATA_SEED, vault.toBytes()],
    lendProgramId
  )[0];
}

function createEarnKaminoInitObligationInstructionConstraint(args: {
  target: KaminoEarnTarget;
  universe: EarnPolicyUniverse;
  vaultPda: PublicKey;
}): generated.InstructionConstraint {
  const marketList = args.universe.kaminoMarkets;
  const obligations = marketList.map((market) =>
    deriveKaminoVanillaObligation(
      args.vaultPda,
      market,
      args.target.lendProgramId
    )
  );
  const dataPrefix = [
    ...args.target.initObligationDiscriminator,
    KAMINO_VANILLA_OBLIGATION_TAG,
    KAMINO_VANILLA_OBLIGATION_ID,
  ];

  return {
    programId: args.target.lendProgramId,
    accountConstraints: [
      pubkeyAccountConstraint(0, [args.vaultPda]),
      pubkeyAccountConstraint(1, [args.vaultPda]),
      pubkeyAccountConstraint(2, obligations),
      pubkeyAccountConstraint(3, marketList),
      pubkeyAccountConstraint(4, [DEFAULT_PUBKEY]),
      pubkeyAccountConstraint(5, [DEFAULT_PUBKEY]),
      pubkeyAccountConstraint(6, [
        deriveKaminoUserMetadata(args.vaultPda, args.target.lendProgramId),
      ]),
      pubkeyAccountConstraint(7, [SYSVAR_RENT_PUBKEY]),
      pubkeyAccountConstraint(8, [SystemProgram.programId]),
    ],
    dataConstraints: [dataSliceEquals(dataPrefix)],
  };
}

function createEarnInitObligationPolicyCreationPayload(args: {
  target: KaminoEarnTarget;
  universe: EarnPolicyUniverse;
  vaultPda: PublicKey;
}): generated.PolicyCreationPayload {
  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        instructionsConstraints: [
          createEarnKaminoInitObligationInstructionConstraint(args),
        ],
        preHook: null,
        postHook: null,
        spendingLimits: [],
      },
    ],
  };
}

function dedupeLookupTableAccounts(
  lookupTableAccounts: readonly AddressLookupTableAccount[]
) {
  const unique = new Map<string, AddressLookupTableAccount>();

  for (const account of lookupTableAccounts) {
    unique.set(account.key.toBase58(), account);
  }

  return [...unique.values()];
}

function mergePreparedOperations(args: {
  operation: string;
  payer: PublicKey;
  programId: PublicKey;
  operations: ReadonlyArray<PreparedLoyalSmartAccountsOperation<string>>;
}): PreparedLoyalSmartAccountsOperation<string> {
  return freezePreparedOperation({
    operation: args.operation,
    payer: args.payer,
    programId: args.programId,
    requiresConfirmation: args.operations.some(
      (operation) => operation.requiresConfirmation
    ),
    instructions: args.operations.flatMap(
      (operation) => operation.instructions
    ),
    lookupTableAccounts: dedupeLookupTableAccounts(
      args.operations.flatMap(
        (operation) => operation.lookupTableAccounts ?? []
      )
    ),
  });
}

function withEarnPolicyCreateSimulationDiagnostics(
  operation: PreparedLoyalSmartAccountsOperation<string>,
  args: {
    policyAccount: PublicKey;
    policySeed: bigint;
    policyStage: EarnPolicyCreateSimulationDiagnosticsMetadata["policyStage"];
    programId: PublicKey;
    settingsPda: PublicKey;
  }
): PreparedLoyalSmartAccountsOperation<string> {
  const policyAccount = args.policyAccount.toBase58();
  const instructionAccounts = new Set(
    operation.instructions.flatMap((instruction) =>
      instruction.keys.map((meta) => meta.pubkey.toBase58())
    )
  );

  return freezePreparedOperation({
    ...operation,
    simulationDiagnostics: {
      includedPolicyAccounts: instructionAccounts.has(policyAccount)
        ? [policyAccount]
        : [],
      kind: "earnPolicyCreateMissingAccount",
      policyAccount,
      policySeed: args.policySeed.toString(),
      policyStage: args.policyStage,
      programId: args.programId.toBase58(),
      settingsPda: args.settingsPda.toBase58(),
    },
  });
}

function toProposalStatus(statusKind: string): SmartAccountProposalStatus {
  switch (statusKind.toLowerCase()) {
    case "draft":
      return "draft";
    case "active":
      return "active";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "executing":
      return "executing";
    case "executed":
      return "executed";
    case "cancelled":
      return "cancelled";
    default:
      return "active";
  }
}

function getWritableFlags(
  message: VaultMessage,
  accountIndex: number
): boolean {
  if (accountIndex < message.numWritableSigners) {
    return true;
  }

  if (accountIndex < message.numSigners) {
    return false;
  }

  return accountIndex - message.numSigners < message.numWritableNonSigners;
}

function compileVaultInstructions(message: VaultMessage) {
  return message.instructions.map((instruction) => {
    const programId = message.accountKeys[instruction.programIdIndex];
    const keys = Array.from(instruction.accountIndexes).map(
      (accountIndex: number) => ({
        pubkey: message.accountKeys[accountIndex],
        isSigner: accountIndex < message.numSigners,
        isWritable: getWritableFlags(message, accountIndex),
      })
    );

    return {
      programId,
      keys,
      data: Buffer.from(instruction.data),
    };
  });
}

function toGeneratedTransactionMessage(
  message: VaultMessage
): generated.SmartAccountTransactionMessage {
  return {
    numSigners: message.numSigners,
    numWritableSigners: message.numWritableSigners,
    numWritableNonSigners: message.numWritableNonSigners,
    accountKeys: message.accountKeys,
    instructions: message.instructions.map((instruction) => ({
      programIdIndex: instruction.programIdIndex,
      accountIndexes: Uint8Array.from(instruction.accountIndexes),
      data: Uint8Array.from(instruction.data),
    })),
    addressTableLookups: (message.addressTableLookups ?? []).map((lookup) => ({
      accountKey: lookup.accountKey,
      writableIndexes: Uint8Array.from(lookup.writableIndexes),
      readonlyIndexes: Uint8Array.from(lookup.readonlyIndexes),
    })),
  };
}

function formatRawTokenAmountForApi(
  amountRaw: bigint,
  decimals: number
): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = amountRaw / base;
  const fraction = amountRaw % base;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  return `${whole.toString()}.${fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")}`;
}

function parseKaminoInstructionRole(role: unknown): {
  isSigner: boolean;
  isWritable: boolean;
} {
  const normalized = typeof role === "string" ? role.toUpperCase() : "";

  return {
    isSigner: normalized.includes("SIGNER"),
    isWritable: normalized.includes("WRITABLE"),
  };
}

function instructionDataStartsWith(
  data: unknown,
  discriminator: readonly number[]
): boolean {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    bytes = Buffer.from(data, "base64");
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    return false;
  }

  if (bytes.length < discriminator.length) {
    return false;
  }

  return discriminator.every((byte, index) => bytes[index] === byte);
}

function instructionStartsWithAnyDiscriminator(
  instruction: TransactionInstruction,
  discriminators: readonly (readonly number[])[]
): boolean {
  return discriminators.some((discriminator) =>
    instructionDataStartsWith(instruction.data, discriminator)
  );
}

function summarizeKaminoPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return { payloadType: typeof payload };
  }

  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      summary[key] = value;
    } else if (Array.isArray(value)) {
      summary[key] = { arrayLength: value.length };
    } else if (typeof value === "object") {
      summary[key] = { keys: Object.keys(value).slice(0, 12) };
    } else {
      summary[key] = { type: typeof value };
    }
  }

  return summary;
}

function toKaminoTransactionInstruction(
  instruction: NonNullable<KaminoInstructionResponse["instructions"]>[number],
  label: string
): TransactionInstruction {
  if (typeof instruction.programAddress !== "string") {
    throw new Error(
      `Kamino ${label} instruction is missing a program address.`
    );
  }

  return {
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => {
      if (typeof account.address !== "string") {
        throw new Error(
          `Kamino ${label} instruction account is missing an address.`
        );
      }
      const role = parseKaminoInstructionRole(account.role);
      return {
        pubkey: new PublicKey(account.address),
        isSigner: role.isSigner,
        isWritable: role.isWritable,
      };
    }),
    data: Buffer.from(instruction.data as string, "base64"),
  };
}

function readKaminoInstructionBundle(
  payload: KaminoInstructionResponse,
  lendProgramId: PublicKey,
  discriminator: readonly number[],
  label = "deposit"
): KaminoInstructionBundle {
  const expectedProgram = lendProgramId.toBase58();
  const matchingInstructionIndexes =
    payload.instructions
      ?.map((entry, index) =>
        entry.programAddress === expectedProgram &&
        instructionDataStartsWith(entry.data, discriminator) &&
        Array.isArray(entry.accounts)
          ? index
          : -1
      )
      .filter((index) => index >= 0) ?? [];
  const instructionIndex = matchingInstructionIndexes[0] ?? -1;
  const instruction =
    instructionIndex >= 0 ? payload.instructions?.[instructionIndex] : null;

  if (!instruction || typeof instruction.programAddress !== "string") {
    console.warn("[smart-account-vaults] Kamino instruction parse failed", {
      expectedProgram,
      instructionCount: payload.instructions?.length ?? 0,
      instructionSummaries: payload.instructions?.map((entry) => ({
        accountCount: Array.isArray(entry.accounts)
          ? entry.accounts.length
          : null,
        dataPrefix:
          typeof entry.data === "string"
            ? Buffer.from(entry.data, "base64")
                .subarray(0, discriminator.length)
                .toString("hex")
            : null,
        dataType: typeof entry.data,
        programAddress:
          typeof entry.programAddress === "string"
            ? entry.programAddress
            : null,
      })),
      label,
      payloadSummary: summarizeKaminoPayload(payload),
      payloadKeys:
        payload && typeof payload === "object" ? Object.keys(payload) : [],
      requiredDiscriminatorHex: Buffer.from(discriminator).toString("hex"),
    });
    throw new Error(`Kamino did not return a ${label} instruction.`);
  }

  const matchingInstructions = matchingInstructionIndexes.map((index) =>
    toKaminoTransactionInstruction(payload.instructions![index]!, label)
  );
  const instructions =
    payload.instructions
      ?.slice(0, instructionIndex + 1)
      .filter((entry) => entry.programAddress === expectedProgram)
      .map((entry) => toKaminoTransactionInstruction(entry, label)) ?? [];

  return {
    instruction: toKaminoTransactionInstruction(instruction, label),
    instructions,
    matchingInstructions,
  };
}

function readKaminoDepositInstruction(
  payload: KaminoInstructionResponse,
  lendProgramId: PublicKey,
  discriminator: readonly number[],
  label = "deposit"
): TransactionInstruction {
  return readKaminoInstructionBundle(
    payload,
    lendProgramId,
    discriminator,
    label
  ).instruction;
}

async function fetchKaminoDepositInstruction(args: {
  amountRaw: bigint;
  depositDiscriminator: readonly number[];
  lendProgramId: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  wallet: PublicKey;
}): Promise<KaminoInstructionBundle> {
  const amount = formatRawTokenAmountForApi(
    args.amountRaw,
    EARN_DEPOSIT_USDC_DECIMALS
  );
  const requestBody = {
    wallet: args.wallet.toBase58(),
    market: args.market.toBase58(),
    reserve: args.reserve.toBase58(),
    amount,
  };
  const response = await fetch(
    typeof window === "undefined"
      ? KAMINO_DEPOSIT_INSTRUCTIONS_URL
      : KAMINO_BROWSER_DEPOSIT_INSTRUCTIONS_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Kamino deposit instruction request failed with status ${response.status}.`
    );
  }

  return readKaminoInstructionBundle(
    (await response.json()) as KaminoInstructionResponse,
    args.lendProgramId,
    args.depositDiscriminator,
    "deposit"
  );
}

async function fetchKaminoWithdrawInstruction(args: {
  amountRaw: bigint;
  lendProgramId: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  withdrawDiscriminator: readonly number[];
  wallet: PublicKey;
}): Promise<KaminoInstructionBundle> {
  const response = await fetch(
    typeof window === "undefined"
      ? KAMINO_WITHDRAW_INSTRUCTIONS_URL
      : KAMINO_BROWSER_WITHDRAW_INSTRUCTIONS_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: args.wallet.toBase58(),
        market: args.market.toBase58(),
        reserve: args.reserve.toBase58(),
        amount: formatRawTokenAmountForApi(
          args.amountRaw,
          EARN_DEPOSIT_USDC_DECIMALS
        ),
      }),
    }
  );

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Kamino withdraw instruction request failed with status ${response.status}: ${responseText}`
    );
  }

  return readKaminoInstructionBundle(
    (await response.json()) as KaminoInstructionResponse,
    args.lendProgramId,
    args.withdrawDiscriminator,
    "withdraw"
  );
}

function requireKaminoAccount(
  instruction: TransactionInstruction,
  index: number,
  label: string
): PublicKey {
  const account = instruction.keys[index]?.pubkey;
  if (!account) {
    throw new Error(`Kamino withdraw instruction is missing ${label}.`);
  }
  return account;
}

function assertKaminoAccountEquals(args: {
  actual: PublicKey;
  expected: PublicKey;
  label: string;
}) {
  if (!args.actual.equals(args.expected)) {
    throw new Error(
      `Kamino withdraw instruction has an unexpected ${args.label}.`
    );
  }
}

function validateKaminoWithdrawInstruction(args: {
  instruction: TransactionInstruction;
  lendProgramId: PublicKey;
  withdrawDiscriminator: readonly number[];
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
  market: PublicKey;
  liquidityMint: PublicKey;
  safeMarkets: Set<string>;
}): {
  executionMarket: PublicKey;
  executionReserve: PublicKey;
  usesCurrentWithdrawAccountOrder: boolean;
  vaultCollateralAta: PublicKey;
  reserveCollateralMint: PublicKey;
} {
  const { instruction } = args;
  if (
    !instruction.data
      .subarray(0, args.withdrawDiscriminator.length)
      .equals(Buffer.from(args.withdrawDiscriminator))
  ) {
    throw new Error(
      "Kamino withdraw instruction has an unexpected withdraw discriminator."
    );
  }
  assertKaminoAccountEquals({
    actual: instruction.programId,
    expected: args.lendProgramId,
    label: "program",
  });
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, 0, "vault"),
    expected: args.vaultPda,
    label: "vault",
  });
  const usesCurrentWithdrawAccountOrder = requireKaminoAccount(
    instruction,
    2,
    "market"
  ).equals(args.market);
  const marketIndex = usesCurrentWithdrawAccountOrder ? 2 : 1;
  const reserveIndex = usesCurrentWithdrawAccountOrder ? 4 : 2;
  const liquidityMintIndex = usesCurrentWithdrawAccountOrder ? 5 : 4;
  const vaultCollateralAccountIndex = usesCurrentWithdrawAccountOrder ? 6 : 7;
  const reserveCollateralMintIndex = usesCurrentWithdrawAccountOrder ? 7 : 5;
  const vaultUsdcAccountIndex = usesCurrentWithdrawAccountOrder ? 9 : 8;
  const tokenProgramIndex = usesCurrentWithdrawAccountOrder ? 11 : 10;

  assertKaminoAccountEquals({
    actual: requireKaminoAccount(instruction, marketIndex, "market"),
    expected: args.market,
    label: "market",
  });
  const executionMarket = requireKaminoAccount(
    instruction,
    marketIndex,
    "market"
  );
  if (!args.safeMarkets.has(executionMarket.toBase58())) {
    throw new Error("Kamino withdraw instruction has an unsafe market.");
  }
  const executionReserve = requireKaminoAccount(
    instruction,
    reserveIndex,
    "reserve"
  );
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(
      instruction,
      liquidityMintIndex,
      "liquidity mint"
    ),
    expected: args.liquidityMint,
    label: "liquidity mint",
  });
  const reserveCollateralMint = requireKaminoAccount(
    instruction,
    reserveCollateralMintIndex,
    "reserve collateral mint"
  );
  const vaultCollateralAta = requireKaminoAccount(
    instruction,
    vaultCollateralAccountIndex,
    "vault collateral account"
  );
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(
      instruction,
      vaultUsdcAccountIndex,
      "vault USDC account"
    ),
    expected: args.vaultUsdcAta,
    label: "vault USDC account",
  });
  assertKaminoAccountEquals({
    actual: requireKaminoAccount(
      instruction,
      tokenProgramIndex,
      "liquidity token program"
    ),
    expected: TOKEN_PROGRAM_ID,
    label: "liquidity token program",
  });
  return {
    executionMarket,
    executionReserve,
    usesCurrentWithdrawAccountOrder,
    reserveCollateralMint,
    vaultCollateralAta,
  };
}

function inferKaminoDepositCollateralAccounts(args: {
  instruction: TransactionInstruction;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
}): { reserveCollateralMint: PublicKey; vaultCollateralAta: PublicKey } | null {
  const writableNonSignerKeys = args.instruction.keys
    .filter(
      (key) =>
        key.isWritable &&
        !key.isSigner &&
        !key.pubkey.equals(args.vaultPda) &&
        !key.pubkey.equals(args.vaultUsdcAta)
    )
    .map((key) => key.pubkey);

  for (const key of args.instruction.keys) {
    const derivedAta = getAssociatedTokenAddressSync(
      key.pubkey,
      args.vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const matchingWritableAccount = writableNonSignerKeys.find((candidate) =>
      candidate.equals(derivedAta)
    );
    if (matchingWritableAccount) {
      return {
        reserveCollateralMint: key.pubkey,
        vaultCollateralAta: matchingWritableAccount,
      };
    }
  }

  return null;
}

function makeSignerWritable(
  instruction: TransactionInstruction,
  signer: PublicKey
): TransactionInstruction {
  return {
    ...instruction,
    keys: instruction.keys.map((key) =>
      key.pubkey.equals(signer) && key.isSigner
        ? { ...key, isWritable: true }
        : key
    ),
  };
}

function createEarnFullWithdrawCleanupInstructions(args: {
  vaultCollateralAtas?: PublicKey[];
  vaultPda: PublicKey;
  vaultSweepLamports?: bigint;
  vaultUsdcAta: PublicKey;
  walletAddress: PublicKey;
}): TransactionInstruction[] {
  const instructions: TransactionInstruction[] = [];
  for (const vaultCollateralAta of args.vaultCollateralAtas ?? []) {
    instructions.push(
      makeSignerWritable(
        createCloseAccountInstruction(
          vaultCollateralAta,
          args.walletAddress,
          args.vaultPda,
          [],
          TOKEN_PROGRAM_ID
        ),
        args.vaultPda
      )
    );
  }

  instructions.push(
    makeSignerWritable(
      createCloseAccountInstruction(
        args.vaultUsdcAta,
        args.walletAddress,
        args.vaultPda,
        [],
        TOKEN_PROGRAM_ID
      ),
      args.vaultPda
    )
  );

  // Refund the vault PDA's SOL on final exit. The first deposit tops the vault
  // up with KAMINO_EARN_SETUP_RENT_BUFFER_LAMPORTS but the Kamino setup only
  // spends part of it — without this sweep the remainder (~0.024 SOL) strands
  // on the vault forever. The Kamino obligation and farms user-state rents are
  // NOT recoverable: klend/kfarms have no close instructions; those accounts
  // are reused by the wallet's next deposit. Amount is the prepare-time
  // balance: anything that lands later stays as dust for the next exit.
  const vaultSweepLamports = args.vaultSweepLamports ?? BigInt(0);
  if (vaultSweepLamports > BigInt(0)) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: args.vaultPda,
        toPubkey: args.walletAddress,
        lamports: vaultSweepLamports,
      })
    );
  }

  return instructions;
}

// Prepare-time read of the vault PDA's SOL for the final-exit sweep. Feature-
// checked like the deposit-side top-up read: some injected connections don't
// implement getBalance — sweeping 0 there simply skips the refund.
async function getVaultSweepLamportsOrZero(
  connection: Connection,
  vaultPda: PublicKey
): Promise<bigint> {
  if (typeof connection.getBalance !== "function") {
    return BigInt(0);
  }
  try {
    return BigInt(await connection.getBalance(vaultPda, "confirmed"));
  } catch {
    return BigInt(0);
  }
}

async function getTokenAccountAmountOrZero(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const getTokenAccountBalance = (
    connection as {
      getTokenAccountBalance?: Connection["getTokenAccountBalance"];
    }
  ).getTokenAccountBalance;
  if (typeof getTokenAccountBalance !== "function") {
    return BigInt(0);
  }

  try {
    const balance = await getTokenAccountBalance.call(
      connection,
      tokenAccount,
      "confirmed"
    );
    return BigInt(balance.value.amount);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("could not find account")
    ) {
      return BigInt(0);
    }
    throw error;
  }
}

async function isTokenAccountOwnedBy(args: {
  account: PublicKey;
  connection: Connection;
  owner: PublicKey;
}): Promise<boolean> {
  const accountInfo = await args.connection.getAccountInfo(
    args.account,
    "confirmed"
  );
  if (!accountInfo || !accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return false;
  }

  return AccountLayout.decode(accountInfo.data).owner.equals(args.owner);
}

async function resolveEarnFullWithdrawAmounts(args: {
  connection: Connection;
  requestedWithdrawAmountRaw: bigint;
  reserve: PublicKey;
  vaultCollateralAta: PublicKey;
}): Promise<{
  expectedRedeemedAmountRaw: bigint;
  kaminoWithdrawAmountRaw: bigint;
  snapshot: KaminoReserveSnapshot;
}> {
  const [vaultCollateralAmountRaw, reserveAccount] = await Promise.all([
    getTokenAccountAmountOrZero(args.connection, args.vaultCollateralAta),
    args.connection.getAccountInfo(args.reserve, "confirmed"),
  ]);

  if (!reserveAccount) {
    throw new Error("Kamino reserve account was not found.");
  }

  const snapshot = parseKaminoReserveSnapshot(reserveAccount.data);
  const expectedRedeemedAmountRaw = calculateKaminoRedeemableLiquidityAmountRaw(
    {
      collateralAmountRaw: vaultCollateralAmountRaw,
      snapshot,
    }
  );
  const kaminoWithdrawAmountRaw =
    vaultCollateralAmountRaw > BigInt(0)
      ? vaultCollateralAmountRaw
      : calculateKaminoCollateralAmountForRedeemableLiquidityRaw({
          liquidityAmountRaw: args.requestedWithdrawAmountRaw,
          snapshot,
        });

  return {
    expectedRedeemedAmountRaw:
      expectedRedeemedAmountRaw > BigInt(0)
        ? expectedRedeemedAmountRaw
        : args.requestedWithdrawAmountRaw,
    kaminoWithdrawAmountRaw,
    snapshot,
  };
}

async function resolveEarnPartialWithdrawAmounts(args: {
  connection: Connection;
  requestedWithdrawAmountRaw: bigint;
  reserve: PublicKey;
}): Promise<{
  expectedRedeemedAmountRaw: bigint;
  kaminoWithdrawAmountRaw: bigint;
  snapshot: KaminoReserveSnapshot;
}> {
  const reserveAccount = await args.connection.getAccountInfo(
    args.reserve,
    "confirmed"
  );
  if (!reserveAccount) {
    throw new Error("Kamino reserve account was not found.");
  }

  const snapshot = parseKaminoReserveSnapshot(reserveAccount.data);
  const kaminoWithdrawAmountRaw =
    calculateKaminoCollateralAmountForRedeemableLiquidityRaw({
      liquidityAmountRaw: args.requestedWithdrawAmountRaw,
      snapshot,
    });
  const expectedRedeemedAmountRaw = calculateKaminoRedeemableLiquidityAmountRaw(
    {
      collateralAmountRaw: kaminoWithdrawAmountRaw,
      snapshot,
    }
  );

  return {
    expectedRedeemedAmountRaw:
      expectedRedeemedAmountRaw > BigInt(0)
        ? expectedRedeemedAmountRaw
        : args.requestedWithdrawAmountRaw,
    kaminoWithdrawAmountRaw:
      kaminoWithdrawAmountRaw > BigInt(0)
        ? kaminoWithdrawAmountRaw
        : args.requestedWithdrawAmountRaw,
    snapshot,
  };
}

function resolveSimulatedRedeemedAmountRaw(args: {
  currentVaultUsdcAmountRaw: bigint;
  simulatedVaultUsdcAmountRaw: bigint;
}): bigint {
  if (args.currentVaultUsdcAmountRaw <= BigInt(0)) {
    return args.simulatedVaultUsdcAmountRaw;
  }

  if (args.simulatedVaultUsdcAmountRaw >= args.currentVaultUsdcAmountRaw) {
    return args.simulatedVaultUsdcAmountRaw - args.currentVaultUsdcAmountRaw;
  }

  return args.simulatedVaultUsdcAmountRaw;
}

function calculateRedeemableAmountOrFallback(args: {
  fallbackAmountRaw: bigint;
  kaminoWithdrawAmountRaw: bigint;
  snapshot: KaminoReserveSnapshot | null;
}): bigint {
  if (!args.snapshot) {
    return args.fallbackAmountRaw;
  }

  const expectedRedeemedAmountRaw = calculateKaminoRedeemableLiquidityAmountRaw(
    {
      collateralAmountRaw: args.kaminoWithdrawAmountRaw,
      snapshot: args.snapshot,
    }
  );

  return expectedRedeemedAmountRaw > BigInt(0)
    ? expectedRedeemedAmountRaw
    : args.fallbackAmountRaw;
}

async function simulatePreparedTokenAccountAmount(args: {
  connection: Connection;
  // Optional extra account whose POST-simulation lamports are wanted (the
  // Earn vault PDA: klend's v2 full withdraw closes the emptied obligation
  // and refunds its rent to the vault mid-transaction, so a prepare-time
  // balance read misses it — only the simulated post-state sees it).
  lamportAccount?: PublicKey;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  tokenAccount: PublicKey;
}): Promise<{ amountRaw: bigint; lamportAccountLamports: bigint | null }> {
  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    blockhash: blockhash.blockhash,
    prepared: args.prepared,
  });
  const simulation = await args.connection.simulateTransaction(transaction, {
    accounts: {
      addresses: [
        args.tokenAccount.toBase58(),
        ...(args.lamportAccount ? [args.lamportAccount.toBase58()] : []),
      ],
      encoding: "base64",
    },
    commitment: "confirmed",
    replaceRecentBlockhash: true,
    sigVerify: false,
  });

  if (simulation.value.err) {
    throw new Error(
      `Earn full withdraw prefix simulation failed: ${JSON.stringify(
        simulation.value.err
      )}\n${(simulation.value.logs ?? []).join("\n")}`
    );
  }

  const lamportAccountInfo = args.lamportAccount
    ? simulation.value.accounts?.[1]
    : null;
  const lamportAccountLamports =
    lamportAccountInfo != null ? BigInt(lamportAccountInfo.lamports) : null;

  const account = simulation.value.accounts?.[0];
  const accountData = account?.data;
  if (!accountData || !Array.isArray(accountData)) {
    return { amountRaw: BigInt(0), lamportAccountLamports };
  }

  const data = Buffer.from(accountData[0] as string, "base64");
  return {
    amountRaw: AccountLayout.decode(data).amount,
    lamportAccountLamports,
  };
}

function formatProposalTokenAmount(
  amountRaw: bigint,
  decimals: number
): string {
  if (decimals === 0) {
    return amountRaw.toString();
  }

  const base = BigInt(10) ** BigInt(decimals);
  const whole = amountRaw / base;
  const fraction = amountRaw % base;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  const paddedFraction = fraction.toString().padStart(decimals, "0");
  return `${whole.toString()}.${paddedFraction.replace(/0+$/, "")}`;
}

function findAssetMetadata(
  assetIndex: Map<string, PortfolioPosition>,
  mint: string | null
) {
  if (!mint) {
    return null;
  }

  return assetIndex.get(mint) ?? null;
}

function summarizeUnknownInstruction(args: {
  programId: PublicKey | null;
  instructionCount: number;
}): SmartAccountProposalSummary {
  return {
    kind: "unknown",
    title: "Transaction",
    subtitle: args.programId
      ? `Program ${args.programId.toBase58()}`
      : "Unknown instruction payload",
    symbol: null,
    amountUi: null,
    amountRaw: null,
    mint: null,
    decimals: null,
    destination: null,
    programId: args.programId?.toBase58() ?? null,
    instructionCount: args.instructionCount,
  };
}

function summarizeSolTransferInstruction(args: {
  instruction: ReturnType<typeof compileVaultInstructions>[number];
  instructionCount: number;
}): SmartAccountProposalSummary | null {
  try {
    const decoded = SystemInstruction.decodeTransfer({
      programId: args.instruction.programId,
      keys: args.instruction.keys,
      data: args.instruction.data,
    });

    return {
      kind: "sol_transfer",
      title: "Send",
      subtitle: `to ${decoded.toPubkey.toBase58()}`,
      symbol: "SOL",
      amountUi: formatProposalTokenAmount(BigInt(decoded.lamports), 9),
      amountRaw: BigInt(decoded.lamports).toString(),
      mint: null,
      decimals: 9,
      destination: decoded.toPubkey.toBase58(),
      programId: args.instruction.programId.toBase58(),
      instructionCount: args.instructionCount,
    };
  } catch {
    return null;
  }
}

function summarizeSplTransferInstruction(args: {
  instruction: ReturnType<typeof compileVaultInstructions>[number];
  instructionCount: number;
  assetIndex: Map<string, PortfolioPosition>;
}): SmartAccountProposalSummary | null {
  try {
    const decoded = decodeTransferCheckedInstruction(
      {
        programId: args.instruction.programId,
        keys: args.instruction.keys,
        data: args.instruction.data,
      },
      args.instruction.programId
    );
    const mint = decoded.keys.mint.pubkey.toBase58();
    const asset = findAssetMetadata(args.assetIndex, mint);

    return {
      kind: "spl_transfer",
      title: "Send",
      subtitle: `to ${decoded.keys.destination.pubkey.toBase58()}`,
      symbol: asset?.asset.symbol ?? null,
      amountUi: formatProposalTokenAmount(
        BigInt(decoded.data.amount.toString()),
        decoded.data.decimals
      ),
      amountRaw: decoded.data.amount.toString(),
      mint,
      decimals: decoded.data.decimals,
      destination: decoded.keys.destination.pubkey.toBase58(),
      programId: args.instruction.programId.toBase58(),
      instructionCount: args.instructionCount,
    };
  } catch {
    return null;
  }
}

function summarizeSettingsTransaction(
  settingsTransaction: SettingsTransaction
): SmartAccountProposalSummary {
  const actionKinds = settingsTransaction.actions.map(
    (action) => action.__kind
  );
  const title =
    actionKinds.length === 1
      ? actionKinds[0].replace(/([a-z])([A-Z])/g, "$1 $2")
      : "Settings changes";

  return {
    kind: "settings_change",
    title,
    subtitle:
      actionKinds.length === 0 ? "No settings actions" : actionKinds.join(", "),
    symbol: null,
    amountUi: null,
    amountRaw: null,
    mint: null,
    decimals: null,
    destination: null,
    programId: null,
    instructionCount: actionKinds.length,
  };
}

function summarizeTransactionPayload(args: {
  payload: Transaction["payload"];
  assetIndex: Map<string, PortfolioPosition>;
  policy: SmartAccountPolicySnapshot | null;
}): {
  summary: SmartAccountProposalSummary;
  accountIndex: number | null;
  decodedInstructions: ReturnType<typeof decodeSolanaInstruction>[];
} {
  if (args.payload.__kind === "PolicyPayload") {
    return summarizePolicyPayload({
      assetIndex: args.assetIndex,
      payload: (args.payload as PolicyPayloadLike).fields[0].payload,
      policy: args.policy,
    });
  }

  if (args.payload.__kind !== "TransactionPayload") {
    return {
      accountIndex: null,
      decodedInstructions: [],
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  const details = (args.payload as TransactionPayloadLike).fields[0];
  return summarizeVaultMessage({
    accountIndex: details.accountIndex,
    assetIndex: args.assetIndex,
    message: details.message,
  });
}

function summarizeVaultMessage(args: {
  message: VaultMessage;
  accountIndex: number;
  assetIndex: Map<string, PortfolioPosition>;
}): {
  summary: SmartAccountProposalSummary;
  accountIndex: number | null;
  decodedInstructions: ReturnType<typeof decodeSolanaInstruction>[];
} {
  const instructions = compileVaultInstructions(args.message);
  const decodedInstructions = instructions.map((instruction) =>
    decodeSolanaInstruction({
      programId: instruction.programId,
      keys: instruction.keys,
      data: instruction.data,
    })
  );

  for (const instruction of instructions) {
    if (instruction.programId.equals(SystemProgram.programId)) {
      const summary = summarizeSolTransferInstruction({
        instruction,
        instructionCount: instructions.length,
      });

      if (summary) {
        return {
          accountIndex: args.accountIndex,
          decodedInstructions,
          summary,
        };
      }
    }

    if (isSupportedTokenProgram(instruction.programId)) {
      const summary = summarizeSplTransferInstruction({
        instruction,
        instructionCount: instructions.length,
        assetIndex: args.assetIndex,
      });

      if (summary) {
        return {
          accountIndex: args.accountIndex,
          decodedInstructions,
          summary,
        };
      }
    }
  }

  const firstInstruction = instructions[0] ?? null;

  if (!firstInstruction) {
    return {
      accountIndex: args.accountIndex,
      decodedInstructions,
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  return {
    accountIndex: args.accountIndex,
    decodedInstructions,
    summary: summarizeUnknownInstruction({
      programId: firstInstruction.programId,
      instructionCount: instructions.length,
    }),
  };
}

function summarizePolicyPayload(args: {
  payload: generated.PolicyPayload;
  policy: SmartAccountPolicySnapshot | null;
  assetIndex: Map<string, PortfolioPosition>;
}): {
  summary: SmartAccountProposalSummary;
  accountIndex: number | null;
  decodedInstructions: ReturnType<typeof decodeSolanaInstruction>[];
} {
  if (args.payload.__kind === "SpendingLimit") {
    const payload = args.payload.fields[0];
    const mint = args.policy?.mint ?? null;
    const asset =
      mint === null
        ? {
            decimals: payload.decimals,
            symbol: null,
          }
        : resolveSpendingLimitAsset({
            assetIndex: args.assetIndex,
            mint,
          });
    const kind =
      mint === SOL_SPENDING_LIMIT_MINT ? "sol_transfer" : "spl_transfer";

    return {
      accountIndex: args.policy?.accountIndex ?? null,
      decodedInstructions: [],
      summary: {
        kind,
        title: "Send",
        subtitle: `to ${payload.destination.toBase58()}`,
        symbol: asset.symbol,
        amountUi: formatProposalTokenAmount(
          toBigInt(payload.amount),
          payload.decimals
        ),
        amountRaw: toBigInt(payload.amount).toString(),
        mint,
        decimals: payload.decimals,
        destination: payload.destination.toBase58(),
        programId: null,
        instructionCount: 1,
      },
    };
  }

  if (args.payload.__kind === "ProgramInteraction") {
    const payload = args.payload.fields[0].transactionPayload;

    if (payload.__kind === "AsyncTransaction") {
      const details = payload.fields[0] as AsyncPolicyTransactionPayloadLike;
      const [message] = transactionMessageBeet.deserialize(
        Buffer.from(details.transactionMessage),
        0
      );

      return summarizeVaultMessage({
        accountIndex: details.accountIndex,
        assetIndex: args.assetIndex,
        message,
      });
    }
  }

  return {
    accountIndex: args.policy?.accountIndex ?? null,
    decodedInstructions: [],
    summary: summarizeUnknownInstruction({
      programId: null,
      instructionCount: 0,
    }),
  };
}

function createProposalFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(proposalDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function createTransactionFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(transactionDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function createSettingsTransactionFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(settingsTransactionDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function createPolicyFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(policyDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function deserializeProposalAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [proposal] = Proposal.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    proposal,
  };
}

function deserializePolicyAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [policy] = Policy.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    policy,
  };
}

function toSignerPermissions(
  permissions: SmartAccountSigner["permissions"]
): SmartAccountSignerPermission[] {
  const nextPermissions: SmartAccountSignerPermission[] = [];

  if (Permissions.has(permissions, Permission.Initiate)) {
    nextPermissions.push("initiate");
  }

  if (Permissions.has(permissions, Permission.Vote)) {
    nextPermissions.push("vote");
  }

  if (Permissions.has(permissions, Permission.Execute)) {
    nextPermissions.push("execute");
  }

  return nextPermissions;
}

function toSignerSnapshot(args: {
  signer: SmartAccountSigner;
  scope: SmartAccountSignerSnapshot["scope"];
  consensusPda: PublicKey;
  threshold: number;
  timeLock: number;
  policyPda?: PublicKey | null;
  policySeed?: string | null;
}): SmartAccountSignerSnapshot {
  const permissions = toSignerPermissions(args.signer.permissions);

  return {
    address: args.signer.key.toBase58(),
    scope: args.scope,
    consensusAddress: args.consensusPda.toBase58(),
    permissions,
    permissionMask: args.signer.permissions.mask,
    lamports: null,
    canInitiate: permissions.includes("initiate"),
    canVote: permissions.includes("vote"),
    canExecute: permissions.includes("execute"),
    threshold: args.threshold,
    timeLock: args.timeLock,
    policyAddress: args.policyPda?.toBase58() ?? null,
    policySeed: args.policySeed ?? null,
  };
}

function deserializeTransactionAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [transaction] = Transaction.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    transaction,
  };
}

function deserializeSettingsTransactionAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [settingsTransaction] = SettingsTransaction.fromAccountInfo(
    args.account
  );
  return {
    address: args.pubkey,
    settingsTransaction,
  };
}

function accountMatchesDiscriminator(
  account: AccountInfo<Buffer>,
  discriminator: readonly number[]
): boolean {
  return Buffer.from(account.data)
    .subarray(0, discriminator.length)
    .equals(Buffer.from(discriminator));
}

function toAssetIndex(vaults: readonly SmartAccountVaultSnapshot[]) {
  const index = new Map<string, PortfolioPosition>();

  for (const vault of vaults) {
    for (const position of vault.portfolio.positions) {
      index.set(position.asset.mint, position);
    }
  }

  return index;
}

function createEmptyActivityPage() {
  return {
    activities: [],
  };
}

function nowMs() {
  return globalThis.performance?.now() ?? Date.now();
}

async function logTimedReadStep<T>(
  label: string,
  details: Record<string, unknown>,
  load: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>
): Promise<T> {
  const startedAt = nowMs();

  try {
    const result = await load();
    console.info(`[smart-account-vaults] ${label}`, {
      ...details,
      ...(summarize?.(result) ?? {}),
      durationMs: Number((nowMs() - startedAt).toFixed(2)),
    });
    return result;
  } catch (error) {
    console.info(`[smart-account-vaults] ${label} failed`, {
      ...details,
      durationMs: Number((nowMs() - startedAt).toFixed(2)),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function requireWalletDataClient(
  walletDataClient: SolanaWalletDataClient | undefined
): SolanaWalletDataClient {
  if (!walletDataClient) {
    throw new Error(
      "A SolanaWalletDataClient is required for vault portfolio and activity queries."
    );
  }

  return walletDataClient;
}

function toConsensusTransactionKey(args: {
  consensusPda: PublicKey;
  transactionIndex: string;
}) {
  return `${args.consensusPda.toBase58()}:${args.transactionIndex}`;
}

function dedupePublicKeys(keys: readonly PublicKey[]): PublicKey[] {
  const unique = new Map<string, PublicKey>();

  for (const key of keys) {
    unique.set(key.toBase58(), key);
  }

  return [...unique.values()];
}

function toWritableAccountMetas(keys: readonly PublicKey[]): AccountMeta[] {
  return keys.map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));
}

function createSubscriptionInitAuthorityInstruction(args: {
  owner: PublicKey;
  subscriptionAuthority: PublicKey;
  tokenMint: PublicKey;
  userAta: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: true },
      {
        pubkey: args.subscriptionAuthority,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.tokenMint, isSigner: false, isWritable: false },
      { pubkey: args.userAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(subscriptionInitAuthorityData()),
  });
}

function createSubscriptionCreateRecurringDelegationInstruction(args: {
  delegator: PublicKey;
  subscriptionAuthority: PublicKey;
  delegation: PublicKey;
  delegatee: PublicKey;
  nonce: bigint;
  amountPerPeriodRaw: bigint;
  periodLengthSeconds: bigint;
  startTimestamp: bigint;
  expiryTimestamp: bigint;
  expectedSubscriptionAuthorityInitId: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [
      { pubkey: args.delegator, isSigner: true, isWritable: true },
      {
        pubkey: args.subscriptionAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: args.delegation, isSigner: false, isWritable: true },
      { pubkey: args.delegatee, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(
      subscriptionCreateRecurringDelegationData({
        amountPerPeriodRaw: args.amountPerPeriodRaw,
        expectedSubscriptionAuthorityInitId:
          args.expectedSubscriptionAuthorityInitId,
        expiryTimestamp: args.expiryTimestamp,
        nonce: args.nonce,
        periodLengthSeconds: args.periodLengthSeconds,
        startTimestamp: args.startTimestamp,
      })
    ),
  });
}

function resolveEarnAutodepositStartTimestamp(args: {
  expiryTimestamp: bigint;
  startTimestamp?: bigint;
}): bigint {
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (
    args.startTimestamp === undefined ||
    (args.startTimestamp !== BigInt(0) && args.startTimestamp <= nowSeconds) ||
    (args.startTimestamp === BigInt(0) && args.expiryTimestamp === BigInt(0))
  ) {
    return nowSeconds;
  }

  return args.startTimestamp;
}

const EARN_AUTODEPOSIT_BATCH_IMMEDIATE_START_BUFFER_SECONDS = BigInt(30);

function resolveEarnAutodepositBatchStartTimestamp(args: {
  refreshImmediateStartTimestamp?: boolean;
  startTimestamp?: bigint;
}): bigint | undefined {
  if (args.refreshImmediateStartTimestamp === true) {
    return args.startTimestamp;
  }
  if (args.startTimestamp !== undefined) {
    return args.startTimestamp;
  }

  return (
    BigInt(Math.floor(Date.now() / 1000)) +
    EARN_AUTODEPOSIT_BATCH_IMMEDIATE_START_BUFFER_SECONDS
  );
}

function createSubscriptionRevokeDelegationInstruction(args: {
  authority: PublicKey;
  delegation: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [
      { pubkey: args.authority, isSigner: true, isWritable: true },
      { pubkey: args.delegation, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(subscriptionRevokeDelegationData()),
  });
}

function createSubscriptionTransferRecurringInstruction(args: {
  delegation: PublicKey;
  subscriptionAuthority: PublicKey;
  delegatorAta: PublicKey;
  receiverAta: PublicKey;
  mint: PublicKey;
  delegatee: PublicKey;
  amountRaw: bigint;
  delegator: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [
      { pubkey: args.delegation, isSigner: false, isWritable: true },
      {
        pubkey: args.subscriptionAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: args.delegatorAta, isSigner: false, isWritable: true },
      { pubkey: args.receiverAta, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: args.delegatee, isSigner: true, isWritable: false },
      {
        pubkey: deriveSubscriptionEventAuthority(),
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SUBSCRIPTIONS_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(
      subscriptionTransferRecurringData({
        amountRaw: args.amountRaw,
        delegator: args.delegator,
        mint: args.mint,
      })
    ),
  });
}

function readSubscriptionAuthorityInitId(
  account: AccountInfo<Buffer | Uint8Array>
): bigint {
  const offset = 98;
  const bytes = account.data.subarray(offset, offset + 8);
  if (bytes.length !== 8) {
    throw new Error("Subscription authority init id is missing.");
  }
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getBigInt64(0, true);
}

function normalizeAutodepositU64(value: bigint, name: string): bigint {
  const max = (BigInt(1) << BigInt(64)) - BigInt(1);
  if (value < BigInt(0) || value > max) {
    throw new Error(`${name} must be a u64.`);
  }
  return value;
}

function toGeneratedPolicyPeriod(
  period: SmartAccountSpendingLimitPeriod
): generated.PeriodV2 {
  switch (period) {
    case "one_time":
      return { __kind: "OneTime" };
    case "day":
      return { __kind: "Daily" };
    case "week":
      return { __kind: "Weekly" };
    case "month":
      return { __kind: "Monthly" };
    case "custom":
      throw new Error("Custom spending-limit periods require a duration.");
  }
}

function toSpendingLimitPolicyPeriod(period: generated.PeriodV2): {
  period: SmartAccountSpendingLimitPeriod;
  periodSeconds: number | null;
} {
  const daySeconds = 24 * 60 * 60;

  switch (period.__kind) {
    case "OneTime":
      return { period: "one_time", periodSeconds: null };
    case "Daily":
      return { period: "day", periodSeconds: daySeconds };
    case "Weekly":
      return { period: "week", periodSeconds: 7 * daySeconds };
    case "Monthly":
      return { period: "month", periodSeconds: 30 * daySeconds };
    case "Custom": {
      const seconds = Number(toBigInt(period.fields[0]));

      if (seconds === daySeconds) {
        return { period: "day", periodSeconds: seconds };
      }

      if (seconds === 7 * daySeconds) {
        return { period: "week", periodSeconds: seconds };
      }

      if (seconds === 30 * daySeconds) {
        return { period: "month", periodSeconds: seconds };
      }

      return {
        period: "custom",
        periodSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      };
    }
  }
}

function toBn(value: bigint): BN {
  return new BN(value.toString());
}

function toNullableExpiration(expiration: bigint): number | null {
  const maxI64 = BigInt("9223372036854775807");

  if (expiration >= maxI64) {
    return null;
  }

  const value = Number(expiration);
  return Number.isFinite(value) ? value : null;
}

function resolveSpendingLimitAsset(args: {
  mint: string;
  assetIndex: Map<string, PortfolioPosition>;
}) {
  if (args.mint === SOL_SPENDING_LIMIT_MINT) {
    const nativeSolPosition =
      args.assetIndex.get(SOL_SPENDING_LIMIT_MINT) ??
      args.assetIndex.get(NATIVE_SOL_MINT);

    return {
      decimals: 9,
      priceUsd: nativeSolPosition?.priceUsd ?? null,
      symbol: "SOL",
    };
  }

  const position = args.assetIndex.get(args.mint);

  return {
    decimals: position?.asset.decimals ?? 0,
    priceUsd: position?.priceUsd ?? null,
    symbol: position?.asset.symbol ?? "TOKEN",
  };
}

function toUsdValue(args: {
  amountRaw: bigint;
  decimals: number;
  priceUsd: number | null;
}): number | null {
  const amount = tokenAmountToNumber(args.amountRaw, args.decimals);

  if (
    amount === null ||
    typeof args.priceUsd !== "number" ||
    !Number.isFinite(args.priceUsd)
  ) {
    return null;
  }

  return amount * args.priceUsd;
}

function toNullableTimestamp(
  timestamp: Parameters<typeof toBigInt>[0] | null
): number | null {
  if (timestamp == null) {
    return null;
  }

  const value = Number(toBigInt(timestamp));
  return Number.isFinite(value) ? value : null;
}

function toProposalStatusTimestamp(status: {
  __kind: string;
  timestamp?: Parameters<typeof toBigInt>[0];
}): number | null {
  if (!("timestamp" in status)) {
    return null;
  }

  return toNullableTimestamp(status.timestamp ?? null);
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

function resolveNextPolicySeed(settings: {
  policySeed: Parameters<typeof toBigInt>[0] | null;
}) {
  const currentPolicySeed =
    settings.policySeed == null ? BigInt(0) : toBigInt(settings.policySeed);
  const nextPolicySeed = currentPolicySeed + BigInt(1);

  if (nextPolicySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Policy seed is too large for this client.");
  }

  return {
    bigint: nextPolicySeed,
    number: Number(nextPolicySeed),
  };
}

function createPolicySigner(signer: PublicKey): SmartAccountSigner {
  return {
    key: signer,
    permissions: {
      mask: Permission.Initiate | Permission.Vote | Permission.Execute,
    },
  };
}

function toPermissionFlags(
  permissions: SmartAccountSignerPermission[]
): Permission[] {
  const flags: Permission[] = [];
  if (permissions.includes("initiate")) {
    flags.push(Permission.Initiate);
  }
  if (permissions.includes("vote")) {
    flags.push(Permission.Vote);
  }
  if (permissions.includes("execute")) {
    flags.push(Permission.Execute);
  }
  return flags;
}

function withPolicySignerPermissions(
  signers: SmartAccountSigner[],
  signer: PublicKey,
  permissions: SmartAccountSignerPermission[]
): SmartAccountSigner[] {
  const flags = toPermissionFlags(permissions);
  if (flags.length === 0) {
    throw new Error("Signer must keep at least one permission.");
  }
  const newMask = flags.reduce<number>((acc, flag) => acc | flag, 0);

  const existingSigner = signers.find((entry) => entry.key.equals(signer));
  if (existingSigner) {
    const mergedMask = existingSigner.permissions.mask | newMask;
    if (mergedMask === existingSigner.permissions.mask) {
      throw new Error("Signer already has the requested permissions.");
    }

    return [
      { ...existingSigner, permissions: { mask: mergedMask } },
      ...signers.filter((entry) => !entry.key.equals(signer)),
    ];
  }

  return [
    { key: signer, permissions: Permissions.fromPermissions(flags) },
    ...signers.filter((entry) => !entry.key.equals(signer)),
  ];
}

function withoutPolicySigner(
  signers: SmartAccountSigner[],
  signer: PublicKey
): SmartAccountSigner[] {
  const nextSigners = signers.filter((entry) => !entry.key.equals(signer));

  if (nextSigners.length === signers.length) {
    throw new Error("Signer is not attached to this policy.");
  }

  return nextSigners;
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

async function fetchSignerLamports(args: {
  connection: Connection;
  signers: SmartAccountSignerSnapshot[];
}): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  const uniqueAddresses = [
    ...new Set(args.signers.map((signer) => signer.address)),
  ];
  const chunkSize = 100;

  for (let index = 0; index < uniqueAddresses.length; index += chunkSize) {
    const addressChunk = uniqueAddresses.slice(index, index + chunkSize);
    const publicKeys = addressChunk.map((address) => new PublicKey(address));
    const accountInfos = await args.connection.getMultipleAccountsInfo(
      publicKeys,
      "confirmed"
    );

    addressChunk.forEach((address, addressIndex) => {
      balances.set(address, accountInfos[addressIndex]?.lamports ?? 0);
    });
  }

  return balances;
}

function withSignerLamports(
  signers: SmartAccountSignerSnapshot[],
  lamportsByAddress: Map<string, number>
): SmartAccountSignerSnapshot[] {
  return signers.map((signer) => ({
    ...signer,
    lamports: lamportsByAddress.get(signer.address) ?? signer.lamports ?? 0,
  }));
}

type SpendingLimitPolicyCreationPayload = Extract<
  generated.PolicyCreationPayload,
  { __kind: "SpendingLimit" }
>["fields"][0];

function toPolicyExpiration(
  expiration: number | null | undefined,
  fallback: SpendingLimitPolicyCreationPayload["timeConstraints"]["expiration"]
): SpendingLimitPolicyCreationPayload["timeConstraints"]["expiration"] {
  if (expiration === undefined) {
    return fallback;
  }

  return expiration === null ? null : new BN(expiration.toString());
}

function resolveUpdatedMaxPerUse(args: {
  amount: bigint;
  base?: SpendingLimitPolicyCreationPayload;
}): SpendingLimitPolicyCreationPayload["quantityConstraints"]["maxPerUse"] {
  if (!args.base) {
    return toBn(args.amount);
  }

  const existingMaxPerPeriod = toBigInt(
    args.base.quantityConstraints.maxPerPeriod
  );
  const existingMaxPerUse = toBigInt(args.base.quantityConstraints.maxPerUse);

  if (
    existingMaxPerUse === existingMaxPerPeriod ||
    existingMaxPerUse > args.amount
  ) {
    return toBn(args.amount);
  }

  return args.base.quantityConstraints.maxPerUse;
}

function resolveUpdatedUsageState(args: {
  amount: bigint;
  base?: SpendingLimitPolicyCreationPayload;
}): SpendingLimitPolicyCreationPayload["usageState"] {
  if (!args.base?.usageState) {
    return null;
  }

  const existingRemaining = toBigInt(args.base.usageState.remainingInPeriod);

  return {
    lastReset: args.base.usageState.lastReset,
    remainingInPeriod:
      existingRemaining > args.amount
        ? toBn(args.amount)
        : args.base.usageState.remainingInPeriod,
  };
}

function createSpendingLimitPolicyCreationPayload(args: {
  accountIndex?: number;
  amount: bigint;
  base?: SpendingLimitPolicyCreationPayload;
  destinations?: PublicKey[];
  expiration?: number | null;
  mint?: PublicKey;
  period?: SmartAccountSpendingLimitPeriod;
}): generated.PolicyCreationPayload {
  const period =
    args.period === undefined
      ? args.base?.timeConstraints.period ?? toGeneratedPolicyPeriod("month")
      : toGeneratedPolicyPeriod(args.period);

  return {
    __kind: "SpendingLimit",
    fields: [
      {
        mint: args.mint ?? args.base?.mint ?? PublicKey.default,
        sourceAccountIndex:
          args.accountIndex ?? args.base?.sourceAccountIndex ?? 0,
        destinations: args.destinations ?? args.base?.destinations ?? [],
        timeConstraints: {
          start: args.base?.timeConstraints.start ?? 0,
          expiration: toPolicyExpiration(
            args.expiration,
            args.base?.timeConstraints.expiration ?? null
          ),
          period,
          accumulateUnused:
            args.base?.timeConstraints.accumulateUnused ?? false,
        },
        quantityConstraints: {
          maxPerPeriod: toBn(args.amount),
          maxPerUse: resolveUpdatedMaxPerUse({
            amount: args.amount,
            base: args.base,
          }),
          enforceExactQuantity:
            args.base?.quantityConstraints.enforceExactQuantity ?? false,
        },
        usageState: resolveUpdatedUsageState({
          amount: args.amount,
          base: args.base,
        }),
      },
    ],
  };
}

function toSpendingLimitPolicyCreationBase(
  policy: Policy
): SpendingLimitPolicyCreationPayload {
  if (policy.policyState.__kind !== "SpendingLimit") {
    throw new Error("Existing policy is not a spending-limit policy.");
  }

  const spendingLimitPolicy = policy.policyState.fields[0];
  const spendingLimit = spendingLimitPolicy.spendingLimit;

  return {
    mint: spendingLimit.mint,
    sourceAccountIndex: spendingLimitPolicy.sourceAccountIndex,
    destinations: spendingLimitPolicy.destinations,
    timeConstraints: spendingLimit.timeConstraints,
    quantityConstraints: spendingLimit.quantityConstraints,
    usageState: spendingLimit.usage,
  };
}

function toSpendingLimitPolicySnapshot(args: {
  address: PublicKey;
  assetIndex: Map<string, PortfolioPosition>;
  now: number;
  policy: Policy;
}): SmartAccountSpendingLimitSnapshot | null {
  if (args.policy.policyState.__kind !== "SpendingLimit") {
    return null;
  }

  const spendingLimitPolicy = args.policy.policyState.fields[0];
  const spendingLimit = spendingLimitPolicy.spendingLimit;
  const amount = toBigInt(spendingLimit.quantityConstraints.maxPerPeriod);
  const maxPerUse = toBigInt(spendingLimit.quantityConstraints.maxPerUse);
  const remainingAmount = toBigInt(spendingLimit.usage.remainingInPeriod);
  const lastReset = Number(toBigInt(spendingLimit.usage.lastReset));
  const expiration = toNullableTimestamp(
    spendingLimit.timeConstraints.expiration
  );
  const periodDetails = toSpendingLimitPolicyPeriod(
    spendingLimit.timeConstraints.period
  );
  const effectiveRemainingAmount = getEffectiveSpendingLimitRemainingAmount({
    accumulateUnused: spendingLimit.timeConstraints.accumulateUnused,
    amount,
    lastReset,
    now: args.now,
    period: periodDetails.period,
    periodSeconds: periodDetails.periodSeconds,
    remainingAmount,
  });
  const mint = spendingLimit.mint.toBase58();
  const asset = resolveSpendingLimitAsset({
    mint,
    assetIndex: args.assetIndex,
  });

  return {
    address: args.address.toBase58(),
    settingsPda: args.policy.settings.toBase58(),
    seed: toBigInt(args.policy.seed).toString(),
    accountIndex: spendingLimitPolicy.sourceAccountIndex,
    mint,
    symbol: asset.symbol,
    decimals: asset.decimals,
    amountRaw: amount.toString(),
    remainingAmountRaw: remainingAmount.toString(),
    effectiveRemainingAmountRaw: effectiveRemainingAmount.toString(),
    maxPerUseRaw: maxPerUse.toString(),
    amountUi: formatTokenAmount(amount, asset.decimals),
    remainingAmountUi: formatTokenAmount(
      effectiveRemainingAmount,
      asset.decimals
    ),
    amountUsd: toUsdValue({
      amountRaw: amount,
      decimals: asset.decimals,
      priceUsd: asset.priceUsd,
    }),
    remainingAmountUsd: toUsdValue({
      amountRaw: effectiveRemainingAmount,
      decimals: asset.decimals,
      priceUsd: asset.priceUsd,
    }),
    period: periodDetails.period,
    periodSeconds: periodDetails.periodSeconds,
    periodLabel: toSpendingLimitPeriodLabel(
      periodDetails.period,
      periodDetails.periodSeconds
    ),
    accumulateUnused: spendingLimit.timeConstraints.accumulateUnused,
    lastReset,
    nextReset: getSpendingLimitNextReset({
      lastReset,
      now: args.now,
      period: periodDetails.period,
      periodSeconds: periodDetails.periodSeconds,
    }),
    expiration,
    isExpired: expiration !== null && expiration <= args.now,
    signers: args.policy.signers.map((signer) => signer.key.toBase58()),
    destinations: spendingLimitPolicy.destinations.map((destination) =>
      destination.toBase58()
    ),
  };
}

function getSettingsTransactionExecutionAccounts(args: {
  settingsPda: PublicKey;
  settingsTransaction: SettingsTransaction;
  programId: PublicKey;
}): {
  spendingLimits: PublicKey[];
  policies: PublicKey[];
} {
  const spendingLimits: PublicKey[] = [];
  const policies: PublicKey[] = [];

  for (const action of args.settingsTransaction.actions) {
    switch (action.__kind) {
      case "AddSpendingLimit":
        spendingLimits.push(
          pda.getSpendingLimitPda({
            programId: args.programId,
            settingsPda: args.settingsPda,
            seed: action.seed,
          })[0]
        );
        break;
      case "RemoveSpendingLimit":
        spendingLimits.push(action.spendingLimit);
        break;
      case "PolicyCreate":
        policies.push(
          pda.getPolicyPda({
            programId: args.programId,
            settingsPda: args.settingsPda,
            policySeed: toBigInt(action.seed) as unknown as number,
          })[0]
        );
        break;
      case "PolicyUpdate":
      case "PolicyRemove":
        policies.push(action.policy);
        break;
    }
  }

  return {
    spendingLimits: dedupePublicKeys(spendingLimits),
    policies: dedupePublicKeys(policies),
  };
}

export type SmartAccountVaultsClient = ReturnType<
  typeof createSmartAccountVaultsClient
>;

type DeserializedPolicyAccount = ReturnType<typeof deserializePolicyAccount>;

function toPolicySnapshot(
  entry: DeserializedPolicyAccount
): SmartAccountPolicySnapshot {
  const seed = toBigInt(entry.policy.seed).toString();
  const signers = entry.policy.signers.map((signer) =>
    toSignerSnapshot({
      signer,
      scope: "policy",
      consensusPda: entry.address,
      threshold: entry.policy.threshold,
      timeLock: entry.policy.timeLock,
      policyPda: entry.address,
      policySeed: seed,
    })
  );
  const rawPolicyState = entry.policy.policyState;
  const policyState = rawPolicyState.__kind ?? "unknown";
  const accountIndex =
    rawPolicyState.__kind === "SpendingLimit"
      ? rawPolicyState.fields[0].sourceAccountIndex
      : rawPolicyState.__kind === "ProgramInteraction"
      ? rawPolicyState.fields[0].accountIndex
      : null;
  const mint =
    rawPolicyState.__kind === "SpendingLimit"
      ? rawPolicyState.fields[0].spendingLimit.mint.toBase58()
      : null;

  return {
    address: entry.address.toBase58(),
    settingsPda: entry.policy.settings.toBase58(),
    seed,
    threshold: entry.policy.threshold,
    timeLock: entry.policy.timeLock,
    transactionIndex: toBigInt(entry.policy.transactionIndex).toString(),
    staleTransactionIndex: toBigInt(
      entry.policy.staleTransactionIndex
    ).toString(),
    state: policyState,
    accountIndex,
    mint,
    signers,
  };
}

function attachOverviewDecorations(args: {
  vaults: SmartAccountVaultSnapshot[];
  signers: SmartAccountSignerSnapshot[];
  policies: SmartAccountPolicySnapshot[];
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
}) {
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

export function createSmartAccountVaultsClient(
  config: SmartAccountVaultsClientConfig
) {
  const smartAccountsClient: LoyalSmartAccountsClient =
    createLoyalSmartAccountsClient({
      connection: config.connection,
      programId: config.programId,
      defaultCommitment: "confirmed",
    });
  const walletDataClient = config.walletDataClient;

  async function fetchVault(args: {
    settingsPda: PublicKey;
    accountIndex?: number;
    activityLimit?: number;
    lamports?: number;
  }): Promise<SmartAccountVaultSnapshot> {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const vaultAddress = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const dataClient = requireWalletDataClient(walletDataClient);
    const [lamports, portfolio, activity] = await Promise.all([
      args.lamports ?? config.connection.getBalance(vaultAddress, "confirmed"),
      dataClient.getPortfolio(vaultAddress),
      args.activityLimit === 0
        ? Promise.resolve(createEmptyActivityPage())
        : dataClient.getActivity(vaultAddress, {
            limit: args.activityLimit ?? 25,
          }),
    ]);

    return {
      accountIndex,
      address: vaultAddress.toBase58(),
      lamports,
      portfolio,
      activity,
      signers: [],
      spendingLimits: [],
    };
  }

  async function listVaults(args: {
    settingsPda: PublicKey;
    accountUtilization?: number;
    activityLimit?: number;
  }): Promise<SmartAccountVaultSnapshot[]> {
    const settings =
      args.accountUtilization === undefined
        ? await smartAccountsClient.smartAccounts.queries.fetchSettings(
            args.settingsPda
          )
        : null;
    const highestAccountIndex =
      args.accountUtilization ?? settings?.accountUtilization ?? 0;
    const accountIndexes = Array.from(
      { length: Math.max(highestAccountIndex + 1, 1) },
      (_, index) => index
    );
    const vaultAddresses = accountIndexes.map(
      (accountIndex) =>
        pda.getSmartAccountPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.settingsPda,
          accountIndex,
        })[0]
    );
    const accountInfos = await config.connection.getMultipleAccountsInfo(
      vaultAddresses,
      "confirmed"
    );

    return Promise.all(
      accountIndexes.map((accountIndex, index) =>
        fetchVault({
          settingsPda: args.settingsPda,
          accountIndex,
          activityLimit: args.activityLimit,
          lamports: accountInfos[index]?.lamports ?? 0,
        })
      )
    );
  }

  async function listVaultBaseSnapshots(args: {
    settingsPda: PublicKey;
    accountUtilization: number;
  }): Promise<SmartAccountVaultBaseSnapshot[]> {
    const accountIndexes = Array.from(
      { length: Math.max(args.accountUtilization + 1, 1) },
      (_, index) => index
    );

    return accountIndexes.map((accountIndex) => ({
      accountIndex,
      address: pda
        .getSmartAccountPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.settingsPda,
          accountIndex,
        })[0]
        .toBase58(),
    }));
  }

  async function fetchPolicyAccounts(args: {
    settingsPda: PublicKey;
  }): Promise<DeserializedPolicyAccount[]> {
    const policyAccounts = await config.connection.getProgramAccounts(
      smartAccountsClient.programId,
      {
        commitment: "confirmed",
        filters: createPolicyFilters(args.settingsPda),
      }
    );

    return policyAccounts.map((account) => deserializePolicyAccount(account));
  }

  async function listPolicies(args: {
    settingsPda: PublicKey;
  }): Promise<SmartAccountPolicySnapshot[]> {
    const policyAccounts = await fetchPolicyAccounts(args);

    return policyAccounts
      .map((entry) => toPolicySnapshot(entry))
      .sort((left, right) => (BigInt(left.seed) > BigInt(right.seed) ? 1 : -1));
  }

  async function listSpendingLimitPolicies(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    now?: number;
  }): Promise<SmartAccountSpendingLimitSnapshot[]> {
    const policyAccounts = await fetchPolicyAccounts(args);
    const assetIndex = args.assetIndex ?? new Map<string, PortfolioPosition>();
    const now = args.now ?? Math.floor(Date.now() / 1000);

    return policyAccounts
      .map((entry) =>
        toSpendingLimitPolicySnapshot({
          address: entry.address,
          assetIndex,
          now,
          policy: entry.policy,
        })
      )
      .filter(
        (entry): entry is SmartAccountSpendingLimitSnapshot => entry !== null
      )
      .sort((left, right) => left.address.localeCompare(right.address));
  }

  async function fetchDerivedProposalAccounts(args: {
    consensusPda: PublicKey;
    fromTransactionIndex: bigint;
    toTransactionIndex: bigint;
    settingsPda: PublicKey;
  }): Promise<{
    proposalAccounts: { pubkey: PublicKey; account: AccountInfo<Buffer> }[];
    transactionAccounts: { pubkey: PublicKey; account: AccountInfo<Buffer> }[];
    settingsTransactionAccounts: {
      pubkey: PublicKey;
      account: AccountInfo<Buffer>;
    }[];
  }> {
    const fromTransactionIndex =
      args.fromTransactionIndex < BigInt(1)
        ? BigInt(1)
        : args.fromTransactionIndex;

    if (args.toTransactionIndex < fromTransactionIndex) {
      console.info("[smart-account-vaults] proposals.derived-skip-empty", {
        settingsPda: args.settingsPda.toBase58(),
        consensusPda: args.consensusPda.toBase58(),
        fromTransactionIndex: fromTransactionIndex.toString(),
        toTransactionIndex: args.toTransactionIndex.toString(),
      });
      return {
        proposalAccounts: [],
        transactionAccounts: [],
        settingsTransactionAccounts: [],
      };
    }

    const transactionIndexes: bigint[] = [];
    for (
      let transactionIndex = fromTransactionIndex;
      transactionIndex <= args.toTransactionIndex;
      transactionIndex += BigInt(1)
    ) {
      transactionIndexes.push(transactionIndex);
    }

    const proposalPdas = transactionIndexes.map(
      (transactionIndex) =>
        pda.getProposalPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.consensusPda,
          transactionIndex,
        })[0]
    );
    const transactionPdas = transactionIndexes.map(
      (transactionIndex) =>
        pda.getTransactionPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.consensusPda,
          transactionIndex,
        })[0]
    );
    const [proposalInfos, transactionInfos] = await Promise.all([
      logTimedReadStep(
        "proposals.derived-proposal-accounts",
        {
          settingsPda: args.settingsPda.toBase58(),
          consensusPda: args.consensusPda.toBase58(),
          fromTransactionIndex: fromTransactionIndex.toString(),
          toTransactionIndex: args.toTransactionIndex.toString(),
          accountCount: proposalPdas.length,
        },
        () =>
          config.connection.getMultipleAccountsInfo(proposalPdas, "confirmed"),
        (result) => ({
          foundCount: result.filter((account) => account !== null).length,
        })
      ),
      logTimedReadStep(
        "proposals.derived-transaction-accounts",
        {
          settingsPda: args.settingsPda.toBase58(),
          consensusPda: args.consensusPda.toBase58(),
          fromTransactionIndex: fromTransactionIndex.toString(),
          toTransactionIndex: args.toTransactionIndex.toString(),
          accountCount: transactionPdas.length,
        },
        () =>
          config.connection.getMultipleAccountsInfo(
            transactionPdas,
            "confirmed"
          ),
        (result) => ({
          foundCount: result.filter((account) => account !== null).length,
        })
      ),
    ]);
    const proposalAccounts = proposalInfos.flatMap((account, index) =>
      account && accountMatchesDiscriminator(account, proposalDiscriminator)
        ? [{ pubkey: proposalPdas[index]!, account }]
        : []
    );
    const transactionAccounts: {
      pubkey: PublicKey;
      account: AccountInfo<Buffer>;
    }[] = [];
    const settingsTransactionAccounts: {
      pubkey: PublicKey;
      account: AccountInfo<Buffer>;
    }[] = [];

    transactionInfos.forEach((account, index) => {
      if (!account) {
        return;
      }

      if (accountMatchesDiscriminator(account, transactionDiscriminator)) {
        transactionAccounts.push({ pubkey: transactionPdas[index]!, account });
        return;
      }

      if (
        accountMatchesDiscriminator(account, settingsTransactionDiscriminator)
      ) {
        settingsTransactionAccounts.push({
          pubkey: transactionPdas[index]!,
          account,
        });
      }
    });

    console.info("[smart-account-vaults] proposals.derived-done", {
      settingsPda: args.settingsPda.toBase58(),
      consensusPda: args.consensusPda.toBase58(),
      transactionIndexCount: transactionIndexes.length,
      proposalAccountCount: proposalAccounts.length,
      transactionAccountCount: transactionAccounts.length,
      settingsTransactionAccountCount: settingsTransactionAccounts.length,
    });

    return {
      proposalAccounts,
      transactionAccounts,
      settingsTransactionAccounts,
    };
  }

  async function listProposals(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    policies?:
      | SmartAccountPolicySnapshot[]
      | Promise<SmartAccountPolicySnapshot[]>;
    rootOnly?: boolean;
  }): Promise<SmartAccountProposalSnapshot[]> {
    const settingsPdaText = args.settingsPda.toBase58();
    const startedAt = nowMs();
    console.info("[smart-account-vaults] proposals.start", {
      settingsPda: settingsPdaText,
      hasPoliciesInput: Boolean(args.policies),
      policiesInputCount: Array.isArray(args.policies)
        ? args.policies.length
        : null,
    });
    const [settings, policies] = await Promise.all([
      logTimedReadStep(
        "proposals.settings-fetch",
        { settingsPda: settingsPdaText },
        () =>
          smartAccountsClient.smartAccounts.queries.fetchSettings(
            args.settingsPda
          ),
        (result) => ({
          transactionIndex: toBigInt(result.transactionIndex).toString(),
          staleTransactionIndex: toBigInt(
            result.staleTransactionIndex
          ).toString(),
        })
      ),
      args.rootOnly
        ? Promise.resolve([])
        : args.policies
        ? Promise.resolve(args.policies)
        : logTimedReadStep(
            "proposals.policy-scan",
            { settingsPda: settingsPdaText },
            () => listPolicies(args),
            (result) => ({ policyCount: result.length })
          ),
    ]);
    console.info("[smart-account-vaults] proposals.policy-consensus", {
      settingsPda: settingsPdaText,
      policyCount: policies.length,
    });
    const rootDerivedAccounts = await fetchDerivedProposalAccounts({
      settingsPda: args.settingsPda,
      consensusPda: args.settingsPda,
      fromTransactionIndex:
        toBigInt(settings.staleTransactionIndex) + BigInt(1),
      toTransactionIndex: toBigInt(settings.transactionIndex),
    });
    const policyDerivedAccountGroups = await Promise.all(
      policies.map((policy) =>
        fetchDerivedProposalAccounts({
          settingsPda: args.settingsPda,
          consensusPda: new PublicKey(policy.address),
          fromTransactionIndex:
            BigInt(policy.staleTransactionIndex) + BigInt(1),
          toTransactionIndex: BigInt(policy.transactionIndex),
        })
      )
    );
    const proposalAccounts = [
      rootDerivedAccounts.proposalAccounts,
      ...policyDerivedAccountGroups.map((group) => group.proposalAccounts),
    ].flat();
    const transactionAccounts = [
      rootDerivedAccounts.transactionAccounts,
      ...policyDerivedAccountGroups.map((group) => group.transactionAccounts),
    ].flat();
    const settingsTransactionAccounts = [
      rootDerivedAccounts.settingsTransactionAccounts,
      ...policyDerivedAccountGroups.map(
        (group) => group.settingsTransactionAccounts
      ),
    ].flat();
    const transactionsByKey = new Map(
      transactionAccounts.map((account) => {
        const deserialized = deserializeTransactionAccount(account);
        const transactionIndex = toBigInt(
          deserialized.transaction.index
        ).toString();
        return [
          toConsensusTransactionKey({
            consensusPda: deserialized.transaction.consensusAccount,
            transactionIndex,
          }),
          deserialized,
        ];
      })
    );
    const settingsTransactionsByKey = new Map(
      settingsTransactionAccounts.map((account) => {
        const deserialized = deserializeSettingsTransactionAccount(account);
        const transactionIndex = toBigInt(
          deserialized.settingsTransaction.index
        ).toString();
        return [
          toConsensusTransactionKey({
            consensusPda: deserialized.settingsTransaction.settings,
            transactionIndex,
          }),
          deserialized,
        ];
      })
    );
    const policiesByAddress = new Map(
      policies.map((policy) => [policy.address, policy])
    );
    const assetIndex = args.assetIndex ?? new Map<string, PortfolioPosition>();

    const proposals = proposalAccounts
      .map((account) => deserializeProposalAccount(account))
      .map((entry) => {
        const transactionIndex = toBigInt(
          entry.proposal.transactionIndex
        ).toString();
        const consensusPda = entry.proposal.settings;
        const transactionKey = toConsensusTransactionKey({
          consensusPda,
          transactionIndex,
        });
        const transaction = transactionsByKey.get(transactionKey) ?? null;
        const settingsTransaction =
          settingsTransactionsByKey.get(transactionKey) ?? null;
        let payloadType: SmartAccountProposalPayloadType = "unknown";
        let transactionAddress: string | null = null;
        let creator: string | null = null;
        let payloadSummary: {
          summary: SmartAccountProposalSummary;
          accountIndex: number | null;
          decodedInstructions: ReturnType<typeof decodeSolanaInstruction>[];
        } = {
          accountIndex: null,
          decodedInstructions: [],
          summary: summarizeUnknownInstruction({
            programId: null,
            instructionCount: 0,
          }),
        };

        if (transaction) {
          payloadType =
            transaction.transaction.payload.__kind === "PolicyPayload"
              ? "policy_transaction"
              : "transaction";
          transactionAddress = transaction.address.toBase58();
          creator = transaction.transaction.creator.toBase58();
          payloadSummary = summarizeTransactionPayload({
            payload: transaction.transaction.payload,
            assetIndex,
            policy: policiesByAddress.get(consensusPda.toBase58()) ?? null,
          });
        } else if (settingsTransaction) {
          payloadType = "settings_transaction";
          transactionAddress = settingsTransaction.address.toBase58();
          creator = settingsTransaction.settingsTransaction.creator.toBase58();
          payloadSummary = {
            accountIndex: null,
            decodedInstructions: [],
            summary: summarizeSettingsTransaction(
              settingsTransaction.settingsTransaction
            ),
          };
        }

        return {
          proposalAddress: entry.address.toBase58(),
          transactionAddress,
          consensusAddress: consensusPda.toBase58(),
          transactionIndex,
          statusTimestamp: toProposalStatusTimestamp(entry.proposal.status),
          payloadType,
          status: toProposalStatus(entry.proposal.status.__kind),
          approvals: entry.proposal.approved.map((address) =>
            address.toBase58()
          ),
          rejections: entry.proposal.rejected.map((address) =>
            address.toBase58()
          ),
          cancellations: entry.proposal.cancelled.map((address) =>
            address.toBase58()
          ),
          creator,
          accountIndex: payloadSummary.accountIndex,
          summary: payloadSummary.summary,
          decodedInstructions: payloadSummary.decodedInstructions,
        } satisfies SmartAccountProposalSnapshot;
      })
      .sort(compareProposalSnapshotsByRecency);

    console.info("[smart-account-vaults] proposals.done", {
      settingsPda: settingsPdaText,
      policyCount: policies.length,
      proposalAccountCount: proposalAccounts.length,
      transactionAccountCount: transactionAccounts.length,
      settingsTransactionAccountCount: settingsTransactionAccounts.length,
      returnedProposalCount: proposals.length,
      durationMs: Number((nowMs() - startedAt).toFixed(2)),
    });

    return proposals;
  }

  async function fetchOverviewBase(args: {
    settingsPda: PublicKey;
  }): Promise<SmartAccountOverviewBase> {
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const vaults = await listVaultBaseSnapshots({
      settingsPda: args.settingsPda,
      accountUtilization: settings.accountUtilization,
    });
    const signers = settings.signers.map((signer) =>
      toSignerSnapshot({
        signer,
        scope: "settings",
        consensusPda: args.settingsPda,
        threshold: settings.threshold,
        timeLock: settings.timeLock,
      })
    );

    return {
      programId: smartAccountsClient.programId.toBase58(),
      settingsPda: args.settingsPda.toBase58(),
      threshold: settings.threshold,
      timeLock: settings.timeLock,
      transactionIndex: toBigInt(settings.transactionIndex).toString(),
      staleTransactionIndex: toBigInt(
        settings.staleTransactionIndex
      ).toString(),
      canonicalVaultAddress:
        vaults[0]?.address ??
        pda
          .getSmartAccountPda({
            programId: smartAccountsClient.programId,
            settingsPda: args.settingsPda,
            accountIndex: 0,
          })[0]
          .toBase58(),
      accountUtilization: settings.accountUtilization,
      signers,
      vaults,
      fetchedAt: Date.now(),
    };
  }

  async function fetchVaultSnapshots(args: {
    settingsPda: PublicKey;
    accountUtilization?: number;
    activityLimit?: number;
  }): Promise<SmartAccountVaultSnapshot[]> {
    return listVaults({
      settingsPda: args.settingsPda,
      accountUtilization: args.accountUtilization,
      activityLimit: args.activityLimit ?? 0,
    });
  }

  async function fetchPolicyOverview(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    rootSigners?: SmartAccountSignerSnapshot[];
    settings?: {
      signers: SmartAccountSigner[];
      threshold: number;
      timeLock: number;
      transactionIndex?: bigint;
    };
  }): Promise<SmartAccountPolicyOverview> {
    const settingsPdaText = args.settingsPda.toBase58();
    const startedAt = nowMs();
    console.info("[smart-account-vaults] policies.start", {
      settingsPda: settingsPdaText,
      hasRootSignersInput: Boolean(args.rootSigners),
      rootSignersInputCount: args.rootSigners?.length ?? null,
    });
    try {
      const settings =
        args.settings ??
        (args.rootSigners
          ? null
          : await logTimedReadStep(
              "policies.settings-fetch",
              { settingsPda: settingsPdaText },
              () =>
                smartAccountsClient.smartAccounts.queries.fetchSettings(
                  args.settingsPda
                ),
              (result) => ({
                signerCount: result.signers.length,
                threshold: result.threshold,
                transactionIndex: toBigInt(result.transactionIndex).toString(),
              })
            ));
      const settingsTransactionIndex =
        settings?.transactionIndex === undefined
          ? undefined
          : typeof settings.transactionIndex === "bigint"
          ? settings.transactionIndex
          : toBigInt(settings.transactionIndex);
      const shouldScanPolicies =
        settingsTransactionIndex === undefined ||
        settingsTransactionIndex > BigInt(0);
      const policyAccounts = shouldScanPolicies
        ? await logTimedReadStep(
            "policies.policy-account-scan",
            { settingsPda: settingsPdaText },
            () => fetchPolicyAccounts({ settingsPda: args.settingsPda }),
            (result) => ({ accountCount: result.length })
          )
        : [];

      if (!shouldScanPolicies) {
        console.info("[smart-account-vaults] policies.policy-account-skip", {
          settingsPda: settingsPdaText,
          transactionIndex: settingsTransactionIndex?.toString() ?? null,
          reason: "no-settings-transactions",
        });
      }
      const rootSigners =
        args.rootSigners ??
        (settings?.signers ?? []).map((signer) =>
          toSignerSnapshot({
            signer,
            scope: "settings",
            consensusPda: args.settingsPda,
            threshold: settings?.threshold ?? 0,
            timeLock: settings?.timeLock ?? 0,
          })
        );
      const policies = policyAccounts
        .map((entry) => toPolicySnapshot(entry))
        .sort((left, right) =>
          BigInt(left.seed) > BigInt(right.seed) ? 1 : -1
        );
      const assetIndex =
        args.assetIndex ?? new Map<string, PortfolioPosition>();
      const now = Math.floor(Date.now() / 1000);
      const spendingLimits = policyAccounts
        .map((entry) =>
          toSpendingLimitPolicySnapshot({
            address: entry.address,
            assetIndex,
            now,
            policy: entry.policy,
          })
        )
        .filter(
          (entry): entry is SmartAccountSpendingLimitSnapshot => entry !== null
        )
        .sort((left, right) => left.address.localeCompare(right.address));
      const signerLamportInputs = [
        ...rootSigners,
        ...policies.flatMap((policy) => policy.signers),
      ];
      const shouldFetchSignerLamports =
        policies.length > 0 && signerLamportInputs.length > 0;
      const signerLamports = !shouldFetchSignerLamports
        ? new Map<string, number>()
        : await logTimedReadStep(
            "policies.signer-lamports",
            {
              settingsPda: settingsPdaText,
              signerCount: signerLamportInputs.length,
              uniqueSignerCount: new Set(
                signerLamportInputs.map((signer) => signer.address)
              ).size,
            },
            () =>
              fetchSignerLamports({
                connection: config.connection,
                signers: signerLamportInputs,
              }),
            (result) => ({ balanceCount: result.size })
          );
      if (!shouldFetchSignerLamports) {
        console.info("[smart-account-vaults] policies.signer-lamports-skip", {
          settingsPda: settingsPdaText,
          policyCount: policies.length,
          signerCount: signerLamportInputs.length,
        });
      }
      const signers = shouldFetchSignerLamports
        ? withSignerLamports(rootSigners, signerLamports)
        : rootSigners;
      const policiesWithSignerLamports = policies.map((policy) => ({
        ...policy,
        signers: withSignerLamports(policy.signers, signerLamports),
      }));

      return {
        signers,
        policies: policiesWithSignerLamports,
        spendingLimits,
      };
    } finally {
      console.info("[smart-account-vaults] policies.done", {
        settingsPda: settingsPdaText,
        durationMs: Number((nowMs() - startedAt).toFixed(2)),
      });
    }
  }

  async function fetchProposalSnapshots(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
    policies?:
      | SmartAccountPolicySnapshot[]
      | Promise<SmartAccountPolicySnapshot[]>;
    rootOnly?: boolean;
  }): Promise<SmartAccountProposalSnapshot[]> {
    return listProposals(args);
  }

  async function fetchOverview(args: {
    settingsPda: PublicKey;
    activityLimit?: number;
  }): Promise<SmartAccountOverview> {
    const base = await fetchOverviewBase({ settingsPda: args.settingsPda });
    const vaults = await fetchVaultSnapshots({
      settingsPda: args.settingsPda,
      accountUtilization: base.accountUtilization,
      activityLimit: args.activityLimit,
    });
    const assetIndex = toAssetIndex(vaults);
    const policyOverview = await fetchPolicyOverview({
      settingsPda: args.settingsPda,
      assetIndex,
      rootSigners: base.signers,
    });
    const vaultsWithSigners = attachOverviewDecorations({
      vaults,
      signers: policyOverview.signers,
      policies: policyOverview.policies,
      spendingLimits: policyOverview.spendingLimits,
    });
    const proposals = await fetchProposalSnapshots({
      settingsPda: args.settingsPda,
      assetIndex,
      policies: policyOverview.policies,
    });
    const {
      accountUtilization: _accountUtilization,
      vaults: _baseVaults,
      ...baseOverview
    } = base;

    return {
      ...baseOverview,
      signers: policyOverview.signers,
      policies: policyOverview.policies,
      spendingLimits: policyOverview.spendingLimits,
      vaults: vaultsWithSigners,
      proposals,
      fetchedAt: Date.now(),
    };
  }

  async function prepareSolTransferProposal(
    args: SmartAccountTransferProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultSolTransferMessage({
      connection: config.connection,
      vaultPda,
      destination: args.destination,
      amountLamports: args.amountLamports,
    });
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposeSolTransfer",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function prepareSplTransferProposal(
    args: SmartAccountTokenTransferProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultSplTransferMessage({
      connection: config.connection,
      vaultPda,
      mint: args.mint,
      destinationOwner: args.destinationOwner,
      amount: args.amount,
      decimals: args.decimals,
      destinationTokenAccount: args.destinationTokenAccount,
      tokenProgramId: args.tokenProgramId,
      createDestinationAta: args.createDestinationAta,
    });
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposeSplTransfer",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function prepareCustomInstructionProposal(
    args: SmartAccountCustomInstructionProposalInput
  ) {
    if (args.instructions.length === 0) {
      throw new Error(
        "Custom instruction proposal requires at least one instruction."
      );
    }

    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultCustomInstructionMessage({
      connection: config.connection,
      vaultPda,
      instructions: args.instructions,
    });
    const addressLookupTableAccounts = dedupeLookupTableAccounts(
      args.addressLookupTableAccounts ?? []
    );
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        addressLookupTableAccounts,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposeCustomInstructions",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function preparePolicyCustomInstructionProposal(
    args: SmartAccountPolicyCustomInstructionProposalInput
  ) {
    if (args.instructions.length === 0) {
      throw new Error(
        "Policy custom instruction proposal requires at least one instruction."
      );
    }

    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const policy = await smartAccountsClient.policies.queries.fetchPolicy(
      args.policyPda
    );
    const settingsPda = policy.settings;
    const transactionIndex = toBigInt(policy.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultCustomInstructionMessage({
      connection: config.connection,
      vaultPda,
      instructions: args.instructions,
    });
    const addressLookupTableAccounts = dedupeLookupTableAccounts(
      args.addressLookupTableAccounts ?? []
    );
    const { transactionMessageBytes } =
      transactionMessageToMultisigTransactionMessageBytes({
        message: transactionMessage,
        addressLookupTableAccounts,
        smartAccountPda: vaultPda,
      });
    const instructionConstraintIndices =
      args.instructionConstraintIndices ??
      new Uint8Array(args.instructions.map(() => 0));
    if (instructionConstraintIndices.length !== args.instructions.length) {
      throw new Error(
        "instructionConstraintIndices length must match instructions length."
      );
    }
    const policyPayload: generated.PolicyPayload = {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices,
          transactionPayload: {
            __kind: "AsyncTransaction",
            fields: [
              {
                accountIndex,
                ephemeralSigners: 0,
                transactionMessage: transactionMessageBytes,
                memo: args.memo ?? null,
              },
            ],
          },
        },
      ],
    };
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.policies.prepare.createTransaction({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        policy: args.policyPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        policyPayload,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.policyPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposePolicyCustomInstructions",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function prepareSettingsChange(args: {
    actions: SettingsAction[];
    creator: PublicKey;
    feePayer: PublicKey;
    memo?: string;
    operation: string;
    policies: PublicKey[];
    settingsPda: PublicKey;
    spendingLimits: PublicKey[];
  }): Promise<SmartAccountPreparedSettingsChange> {
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);

    if (settings.threshold <= 1) {
      return {
        transactionIndex,
        prepared:
          await smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
            {
              feePayer: args.feePayer,
              settingsPda: args.settingsPda,
              signers: [args.creator],
              actions: args.actions,
              memo: args.memo,
              remainingAccounts: toWritableAccountMetas([
                ...args.spendingLimits,
                ...args.policies,
              ]),
            } as never
          ),
      };
    }

    const preparedOperations = await Promise.all([
      smartAccountsClient.features.smartAccounts.prepare.createSettingsTransaction(
        {
          feePayer: args.feePayer,
          rentPayer: args.feePayer,
          settingsPda: args.settingsPda,
          transactionIndex,
          creator: args.creator,
          actions: args.actions,
          memo: args.memo,
        } as never
      ),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
      smartAccountsClient.features.proposals.prepare.approve({
        feePayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        signer: args.creator,
      } as never),
    ]);

    return {
      transactionIndex,
      prepared: mergePreparedOperations({
        operation: args.operation,
        payer: args.feePayer,
        programId: smartAccountsClient.programId,
        operations: preparedOperations,
      }),
    };
  }

  async function listRawPolicies(args: { settingsPda: PublicKey }) {
    const policyAccounts = await config.connection.getProgramAccounts(
      smartAccountsClient.programId,
      {
        commitment: "confirmed",
        filters: createPolicyFilters(args.settingsPda),
      }
    );

    return policyAccounts
      .map((account) => deserializePolicyAccount(account))
      .filter((entry) => entry.policy.settings.equals(args.settingsPda))
      .sort((left, right) =>
        toBigInt(left.policy.seed) > toBigInt(right.policy.seed) ? 1 : -1
      );
  }

  type ResolvedEarnYieldRoutingPolicy = {
    account: PublicKey;
    finalizeOperation?: PreparedLoyalSmartAccountsOperation<string>;
    operation?: PreparedLoyalSmartAccountsOperation<string>;
    persistence?: ReturnType<typeof createYieldRoutePolicyPlan>["persistence"];
    nativeSolRentCandidates?: NativeSolRentCandidate[];
    seed: bigint;
    setupAccount?: PublicKey;
    setupOperation?: PreparedLoyalSmartAccountsOperation<string>;
    setupPersistence?: ReturnType<
      typeof createYieldRouteSetupPolicyPlan
    >["persistence"];
    setupSeed?: bigint;
  };

  async function createEarnYieldRoutingPolicyOperation(args: {
    cluster: LoyalCluster;
    feePayer: PublicKey;
    policySeed: bigint;
    policySigner: PublicKey;
    settingsPda: PublicKey;
    signer: PublicKey;
  }): Promise<{
    finalizeOperation?: PreparedLoyalSmartAccountsOperation<string>;
    operation: PreparedLoyalSmartAccountsOperation<string>;
    persistence: ReturnType<typeof createYieldRoutePolicyPlan>["persistence"];
    policyAccount: PublicKey;
    setupOperation: PreparedLoyalSmartAccountsOperation<string>;
    setupPersistence: ReturnType<
      typeof createYieldRouteSetupPolicyPlan
    >["persistence"];
    setupPolicyAccount: PublicKey;
    setupPolicySeed: bigint;
    nativeSolRentCandidates: NativeSolRentCandidate[];
  }> {
    const vault = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const plan = createYieldRoutePolicyPlan({
      cluster: args.cluster,
      policySeed: args.policySeed,
      risk: EARN_RISK_PROFILE,
      squads: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        authority: args.signer,
        delegatedSigner: args.policySigner,
        settings: args.settingsPda,
        vault,
      },
      swapLanes: [],
    });
    const setupPolicySeed = args.policySeed + BigInt(1);
    const setupPlan = createYieldRouteSetupPolicyPlan({
      cluster: args.cluster,
      policySeed: setupPolicySeed,
      risk: EARN_RISK_PROFILE,
      squads: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        authority: args.signer,
        delegatedSigner: args.policySigner,
        settings: args.settingsPda,
        vault,
      },
    });
    const policyAccount = pda.getPolicyPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      policySeed: Number(args.policySeed),
    })[0];
    const setupPolicyAccount = pda.getPolicyPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      policySeed: Number(setupPolicySeed),
    })[0];
    const earnTarget = resolveKaminoEarnTarget(args.cluster);
    const earnUniverse = earnPolicyUniverseFromPlan(plan);
    const routePolicyPayload =
      createEarnProgramInteractionPolicyCreationPayload({
        target: earnTarget,
        universe: earnUniverse,
        vaultPda: vault,
      });
    const setupPolicyPayload = createEarnInitObligationPolicyCreationPayload({
      target: earnTarget,
      universe: earnUniverse,
      vaultPda: vault,
    });
    const createPolicyOperation = async (policyArgs: {
      policyAccount: PublicKey;
      policySeed: bigint;
      policyStage: EarnPolicyCreateSimulationDiagnosticsMetadata["policyStage"];
      payload: generated.PolicyCreationPayload;
    }) => {
      const operation =
        await smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
          {
            feePayer: args.feePayer,
            settingsPda: args.settingsPda,
            signers: [args.signer],
            actions: [
              {
                __kind: "PolicyCreate",
                seed: toBn(policyArgs.policySeed),
                policyCreationPayload: policyArgs.payload,
                signers: [createPolicySigner(args.policySigner)],
                threshold: 1,
                timeLock: 0,
                startTimestamp: null,
                expirationArgs: null,
              },
            ],
            remainingAccounts: [
              {
                pubkey: policyArgs.policyAccount,
                isWritable: true,
                isSigner: false,
              },
            ],
          } as never
        );

      return withEarnPolicyCreateSimulationDiagnostics(operation, {
        policyAccount: policyArgs.policyAccount,
        policySeed: policyArgs.policySeed,
        policyStage: policyArgs.policyStage,
        programId: smartAccountsClient.programId,
        settingsPda: args.settingsPda,
      });
    };

    const operation = await createPolicyOperation({
      policyAccount,
      policySeed: args.policySeed,
      policyStage: "route",
      payload: routePolicyPayload,
    });
    const operationLength = preparedPacketLength(operation);
    if (
      operationLength !== null &&
      operationLength > EARN_POLICY_PACKET_DATA_SIZE
    ) {
      throw new Error(
        "Earn route policy setup exceeds the Solana transaction size limit."
      );
    }

    const setupOperation = await createPolicyOperation({
      policyAccount: setupPolicyAccount,
      policySeed: setupPolicySeed,
      policyStage: "setup",
      payload: setupPolicyPayload,
    });
    const setupOperationLength = preparedPacketLength(setupOperation);
    if (
      setupOperationLength !== null &&
      setupOperationLength > EARN_POLICY_PACKET_DATA_SIZE
    ) {
      throw new Error(
        "Earn init-obligation policy setup exceeds the Solana transaction size limit."
      );
    }

    return {
      finalizeOperation: setupOperation,
      operation,
      persistence: plan.persistence,
      policyAccount,
      setupOperation,
      setupPersistence: setupPlan.persistence,
      setupPolicyAccount,
      setupPolicySeed,
      nativeSolRentCandidates: [
        {
          account: policyAccount,
          exists: false,
          kind: "policy_rent",
          label: "Earn route policy account rent",
          space: policyRentSpace({
            feePayer: args.feePayer,
            policyPayload: routePolicyPayload,
            policySeed: args.policySeed,
            policySigner: args.policySigner,
            programId: smartAccountsClient.programId,
            settingsPda: args.settingsPda,
          }),
          stage: "policy",
        },
        {
          account: setupPolicyAccount,
          exists: false,
          kind: "policy_rent",
          label: "Earn setup policy account rent",
          space: policyRentSpace({
            feePayer: args.feePayer,
            policyPayload: setupPolicyPayload,
            policySeed: setupPolicySeed,
            policySigner: args.policySigner,
            programId: smartAccountsClient.programId,
            settingsPda: args.settingsPda,
          }),
          stage: "policy-finalize",
        },
      ],
    };
  }

  async function resolveEarnYieldRoutingPolicyForCreation(args: {
    cluster: LoyalCluster;
    feePayer: PublicKey;
    policySigner: PublicKey;
    settingsPda: PublicKey;
    signer: PublicKey;
  }): Promise<ResolvedEarnYieldRoutingPolicy> {
    if (typeof config.connection.getAccountInfo !== "function") {
      throw new Error(
        "Cannot create an Earn policy without fetching the next Squads policy seed."
      );
    }
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const nextPolicySeed = resolveNextPolicySeed(settings);
    const {
      finalizeOperation,
      operation,
      persistence,
      policyAccount,
      nativeSolRentCandidates,
      setupOperation,
      setupPersistence,
      setupPolicyAccount,
      setupPolicySeed,
    } = await createEarnYieldRoutingPolicyOperation({
      cluster: args.cluster,
      feePayer: args.feePayer,
      policySeed: nextPolicySeed.bigint,
      policySigner: args.policySigner,
      settingsPda: args.settingsPda,
      signer: args.signer,
    });

    return {
      account: policyAccount,
      finalizeOperation,
      operation,
      persistence,
      nativeSolRentCandidates,
      seed: nextPolicySeed.bigint,
      setupAccount: setupPolicyAccount,
      setupOperation,
      setupPersistence,
      setupSeed: setupPolicySeed,
    };
  }

  async function resolveEarnYieldRoutingSetupPolicyForCreation(args: {
    cluster: LoyalCluster;
    feePayer: PublicKey;
    policySeed: bigint;
    policySigner: PublicKey;
    settingsPda: PublicKey;
    signer: PublicKey;
  }): Promise<ResolvedEarnYieldRoutingPolicy> {
    const {
      setupOperation,
      setupPersistence,
      setupPolicyAccount,
      setupPolicySeed,
      nativeSolRentCandidates,
    } = await createEarnYieldRoutingPolicyOperation({
      cluster: args.cluster,
      feePayer: args.feePayer,
      policySeed: args.policySeed,
      policySigner: args.policySigner,
      settingsPda: args.settingsPda,
      signer: args.signer,
    });

    return {
      account: pda.getPolicyPda({
        programId: smartAccountsClient.programId,
        settingsPda: args.settingsPda,
        policySeed: Number(args.policySeed),
      })[0],
      finalizeOperation: setupOperation,
      nativeSolRentCandidates: nativeSolRentCandidates.filter((candidate) =>
        candidate.account.equals(setupPolicyAccount)
      ),
      seed: args.policySeed,
      setupAccount: setupPolicyAccount,
      setupOperation,
      setupPersistence,
      setupSeed: setupPolicySeed,
    };
  }

  async function resolveEarnYieldRoutingPolicyForExecution(args: {
    settingsPda: PublicKey;
  }): Promise<ResolvedEarnYieldRoutingPolicy> {
    if (typeof config.connection.getProgramAccounts !== "function") {
      throw new Error(
        "Cannot discover an Earn policy without scanning smart-account policies."
      );
    }

    const policies = await listRawPolicies({ settingsPda: args.settingsPda });
    const earnPolicy = policies
      .filter((entry) => {
        const state = entry.policy.policyState;
        return (
          state.__kind === "ProgramInteraction" &&
          state.fields[0].accountIndex === EARN_DEPOSIT_VAULT_INDEX
        );
      })
      .sort((left, right) =>
        toBigInt(left.policy.seed) > toBigInt(right.policy.seed) ? -1 : 1
      )[0];

    if (!earnPolicy) {
      throw new Error("Earn yield-routing policy is not initialized.");
    }

    return {
      account: earnPolicy.address,
      seed: toBigInt(earnPolicy.policy.seed),
    };
  }

  // A prior first-deposit attempt can land the policy-create stages and then
  // fail before confirm records them, leaving valid policies on-chain that the
  // read-model doesn't know about. Blindly re-creating burns policy rent on
  // every retry, so scan the settings' policies for a reusable route+setup
  // pair (route policy at seed N, init-obligation setup twin at N+1, both
  // carrying the current policy signer) before creating a fresh pair.
  async function discoverEarnYieldRoutingPolicyPairOnChain(args: {
    cluster: LoyalCluster;
    feePayer: PublicKey;
    policySigner: PublicKey;
    settingsPda: PublicKey;
    signer: PublicKey;
  }): Promise<ResolvedEarnYieldRoutingPolicy | null> {
    if (typeof config.connection.getProgramAccounts !== "function") {
      return null;
    }

    let policies: Awaited<ReturnType<typeof listRawPolicies>>;
    try {
      policies = await listRawPolicies({ settingsPda: args.settingsPda });
    } catch {
      // Discovery is best-effort; creation remains the fallback.
      return null;
    }

    // Earn interaction policies for the deposit vault, keyed by constraint
    // count: the route policy carries withdraw+deposit (2), its setup twin
    // carries only init-obligation (1). Anything else returns null.
    const earnInteractionConstraintCount = (
      entry: (typeof policies)[number]
    ): number | null => {
      const state = entry.policy.policyState;
      if (
        state.__kind !== "ProgramInteraction" ||
        state.fields[0].accountIndex !== EARN_DEPOSIT_VAULT_INDEX ||
        !entry.policy.signers.some((signer) =>
          signer.key.equals(args.policySigner)
        )
      ) {
        return null;
      }
      return state.fields[0].instructionsConstraints.length;
    };

    const bySeed = new Map(
      policies.map((entry) => [toBigInt(entry.policy.seed), entry] as const)
    );
    const routes = policies
      .filter((entry) => earnInteractionConstraintCount(entry) === 2)
      .sort((left, right) =>
        toBigInt(left.policy.seed) > toBigInt(right.policy.seed) ? -1 : 1
      );

    for (const route of routes) {
      const routeSeed = toBigInt(route.policy.seed);
      const setupEntry = bySeed.get(routeSeed + BigInt(1));
      if (setupEntry && earnInteractionConstraintCount(setupEntry) === 1) {
        return {
          account: route.address,
          seed: routeSeed,
          setupAccount: setupEntry.address,
          setupSeed: routeSeed + BigInt(1),
        };
      }
      if (!setupEntry) {
        // The route landed but its setup twin didn't — prepare only the
        // setup stage against the existing route seed.
        return resolveEarnYieldRoutingSetupPolicyForCreation({
          cluster: args.cluster,
          feePayer: args.feePayer,
          policySeed: routeSeed,
          policySigner: args.policySigner,
          settingsPda: args.settingsPda,
          signer: args.signer,
        });
      }
      // Seed+1 holds an incompatible policy; try an older route candidate.
    }

    return null;
  }

  async function resolveAgentPolicy(args: SmartAccountAddSignerProposalInput) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);

    if (args.policyPda) {
      const policy = await smartAccountsClient.policies.queries.fetchPolicy(
        args.policyPda
      );
      if (!policy.settings.equals(args.settingsPda)) {
        throw new Error("Agent policy belongs to another vault.");
      }
      if (policy.policyState.__kind !== "SpendingLimit") {
        throw new Error("Agent policy must be a spending-limit policy.");
      }
      if (policy.policyState.fields[0].sourceAccountIndex !== accountIndex) {
        throw new Error("Agent policy targets another vault account.");
      }

      return {
        address: args.policyPda,
        policy,
      };
    }

    // Default behavior: each signer gets its own SpendingLimit policy so
    // spending limits are independent per signer. Callers that want to
    // append a signer to an existing policy must pass `policyPda` explicitly.
    return null;
  }

  async function resolveAgentPolicyForRemoval(
    args: SmartAccountRemoveSignerProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);

    if (args.policyPda) {
      const policy = await smartAccountsClient.policies.queries.fetchPolicy(
        args.policyPda
      );
      if (!policy.settings.equals(args.settingsPda)) {
        throw new Error("Agent policy belongs to another vault.");
      }
      if (policy.policyState.__kind !== "SpendingLimit") {
        throw new Error("Agent policy must be a spending-limit policy.");
      }
      if (policy.policyState.fields[0].sourceAccountIndex !== accountIndex) {
        throw new Error("Agent policy targets another vault account.");
      }
      if (!policy.signers.some((signer) => signer.key.equals(args.signer))) {
        throw new Error("Signer is not attached to this policy.");
      }

      return {
        address: args.policyPda,
        policy,
      };
    }

    const policies = await listRawPolicies({ settingsPda: args.settingsPda });
    const candidates = policies.filter(
      (entry) =>
        entry.policy.policyState.__kind === "SpendingLimit" &&
        entry.policy.policyState.fields[0].sourceAccountIndex ===
          accountIndex &&
        entry.policy.signers.some((signer) => signer.key.equals(args.signer))
    );

    if (candidates.length === 0) {
      throw new Error("Signer is not connected to this vault.");
    }

    return candidates[0];
  }

  async function prepareAddInitiateSigner(
    args: SmartAccountAddSignerProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const requestedPermissions = args.permissions ?? ["initiate"];
    const policyEntry = await resolveAgentPolicy(args);

    if (policyEntry) {
      const policyCreationBase = toSpendingLimitPolicyCreationBase(
        policyEntry.policy
      );

      return prepareSettingsChange({
        actions: [
          {
            __kind: "PolicyUpdate",
            policy: policyEntry.address,
            signers: withPolicySignerPermissions(
              policyEntry.policy.signers,
              args.signer,
              requestedPermissions
            ),
            threshold: policyEntry.policy.threshold || 1,
            timeLock: policyEntry.policy.timeLock,
            policyUpdatePayload: createSpendingLimitPolicyCreationPayload({
              amount: toBigInt(
                policyCreationBase.quantityConstraints.maxPerPeriod
              ),
              base: policyCreationBase,
            }),
            expirationArgs: null,
          },
        ],
        creator: args.creator,
        feePayer: args.feePayer,
        memo: args.memo,
        operation: "addInitiatePolicySigner",
        policies: [policyEntry.address],
        settingsPda: args.settingsPda,
        spendingLimits: [],
      });
    }

    // No SpendingLimit policy exists for this vault yet (fresh vault). Bundle a
    // PolicyCreate with the new signer so they can be authorized before the
    // owner configures actual spend limits. Defaults to a zero-amount monthly
    // SOL policy that the owner can edit later via the spending-limit flow.
    const flags = toPermissionFlags(requestedPermissions);
    if (flags.length === 0) {
      throw new Error("Signer must have at least one permission.");
    }
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const policyCreationPayload = createSpendingLimitPolicyCreationPayload({
      accountIndex,
      amount: BigInt(0),
    });
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const nextPolicySeed = resolveNextPolicySeed(settings);
    const newPolicyPda = pda.getPolicyPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      policySeed: nextPolicySeed.number,
    })[0];

    return prepareSettingsChange({
      actions: [
        {
          __kind: "PolicyCreate",
          seed: toBn(nextPolicySeed.bigint),
          policyCreationPayload,
          signers: [
            {
              key: args.signer,
              permissions: Permissions.fromPermissions(flags),
            },
          ],
          threshold: 1,
          timeLock: 0,
          startTimestamp: null,
          expirationArgs: null,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "createSpendingLimitPolicyForSigner",
      policies: [newPolicyPda],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareUpdatePolicySignerPermissions(
    args: SmartAccountUpdateSignerPermissionsInput & {
      policyPda?: PublicKey | null;
      accountIndex?: number;
    }
  ): Promise<SmartAccountPreparedSettingsChange> {
    const flags: Permission[] = [];
    if (args.permissions.includes("initiate")) {
      flags.push(Permission.Initiate);
    }
    if (args.permissions.includes("vote")) {
      flags.push(Permission.Vote);
    }
    if (args.permissions.includes("execute")) {
      flags.push(Permission.Execute);
    }

    if (flags.length === 0) {
      throw new Error("Signer must keep at least one permission.");
    }

    const policyEntry = await resolveAgentPolicyForRemoval({
      settingsPda: args.settingsPda,
      creator: args.creator,
      feePayer: args.feePayer,
      signer: args.signer,
      policyPda: args.policyPda ?? null,
      accountIndex: args.accountIndex,
      memo: args.memo,
    });

    const nextPermissions = Permissions.fromPermissions(flags);
    const nextSigners = policyEntry.policy.signers.map((entry) =>
      entry.key.equals(args.signer)
        ? { ...entry, permissions: nextPermissions }
        : entry
    );

    const policyCreationBase = toSpendingLimitPolicyCreationBase(
      policyEntry.policy
    );

    return prepareSettingsChange({
      actions: [
        {
          __kind: "PolicyUpdate",
          policy: policyEntry.address,
          signers: nextSigners,
          threshold: policyEntry.policy.threshold || 1,
          timeLock: policyEntry.policy.timeLock,
          policyUpdatePayload: createSpendingLimitPolicyCreationPayload({
            amount: toBigInt(
              policyCreationBase.quantityConstraints.maxPerPeriod
            ),
            base: policyCreationBase,
          }),
          expirationArgs: null,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "updatePolicySignerPermissions",
      policies: [policyEntry.address],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareUpdateSignerPermissions(
    args: SmartAccountUpdateSignerPermissionsInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const flags: Permission[] = [];
    if (args.permissions.includes("initiate")) {
      flags.push(Permission.Initiate);
    }
    if (args.permissions.includes("vote")) {
      flags.push(Permission.Vote);
    }
    if (args.permissions.includes("execute")) {
      flags.push(Permission.Execute);
    }

    if (flags.length === 0) {
      throw new Error("Signer must keep at least one permission.");
    }

    return prepareSettingsChange({
      actions: [
        { __kind: "RemoveSigner", oldSigner: args.signer },
        {
          __kind: "AddSigner",
          newSigner: {
            key: args.signer,
            permissions: Permissions.fromPermissions(flags),
          },
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "updateSignerPermissions",
      policies: [],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareAddRootSigner(
    args: SmartAccountAddRootSignerInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const permissions = args.permissions ?? ["initiate", "vote", "execute"];
    const flags = toPermissionFlags(permissions);
    if (flags.length === 0) {
      throw new Error(
        "Root Settings signer must have at least one permission."
      );
    }

    return prepareSettingsChange({
      actions: [
        {
          __kind: "AddSigner",
          newSigner: {
            key: args.signer,
            permissions: Permissions.fromPermissions(flags),
          },
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "addRootSettingsSigner",
      policies: [],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareRemoveRootSigner(
    args: SmartAccountRemoveRootSignerInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    return prepareSettingsChange({
      actions: [
        {
          __kind: "RemoveSigner",
          oldSigner: args.signer,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "removeRootSettingsSigner",
      policies: [],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareRemoveInitiateSigner(
    args: SmartAccountRemoveSignerProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const policyEntry = await resolveAgentPolicyForRemoval(args);
    const nextSigners = withoutPolicySigner(
      policyEntry.policy.signers,
      args.signer
    );

    if (nextSigners.length === 0) {
      return prepareSettingsChange({
        actions: [
          {
            __kind: "PolicyRemove",
            policy: policyEntry.address,
          },
        ],
        creator: args.creator,
        feePayer: args.feePayer,
        memo: args.memo,
        operation: "removeInitiatePolicySigner",
        policies: [policyEntry.address],
        settingsPda: args.settingsPda,
        spendingLimits: [],
      });
    }

    const policyCreationBase = toSpendingLimitPolicyCreationBase(
      policyEntry.policy
    );

    return prepareSettingsChange({
      actions: [
        {
          __kind: "PolicyUpdate",
          policy: policyEntry.address,
          signers: nextSigners,
          threshold: Math.max(
            1,
            Math.min(policyEntry.policy.threshold || 1, nextSigners.length)
          ),
          timeLock: policyEntry.policy.timeLock,
          policyUpdatePayload: createSpendingLimitPolicyCreationPayload({
            amount: toBigInt(
              policyCreationBase.quantityConstraints.maxPerPeriod
            ),
            base: policyCreationBase,
          }),
          expirationArgs: null,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "removeInitiatePolicySigner",
      policies: [policyEntry.address],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareSetSpendingLimitPolicy(
    args: SmartAccountSetSpendingLimitProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const existingPolicy = args.existingSpendingLimitPolicy
      ? await smartAccountsClient.policies.queries.fetchPolicy(
          args.existingSpendingLimitPolicy
        )
      : null;
    const actions: SettingsAction[] = [];
    const policies: PublicKey[] = [];

    if (existingPolicy && args.existingSpendingLimitPolicy) {
      if (existingPolicy.policyState.__kind !== "SpendingLimit") {
        throw new Error("Existing policy is not a spending-limit policy.");
      }

      if (!existingPolicy.settings.equals(args.settingsPda)) {
        throw new Error(
          "Existing spending-limit policy belongs to another vault."
        );
      }

      const policyUpdatePayload = createSpendingLimitPolicyCreationPayload({
        accountIndex: args.accountIndex,
        amount: args.amount,
        base: toSpendingLimitPolicyCreationBase(existingPolicy),
        destinations: args.destinations,
        expiration: args.expiration,
        mint: args.mint,
        period: args.period,
      });

      actions.push({
        __kind: "PolicyUpdate",
        policy: args.existingSpendingLimitPolicy,
        signers: existingPolicy.signers.length
          ? existingPolicy.signers
          : [createPolicySigner(args.signer)],
        threshold: existingPolicy.threshold || 1,
        timeLock: existingPolicy.timeLock,
        policyUpdatePayload,
        expirationArgs: null,
      });
      policies.push(args.existingSpendingLimitPolicy);
    } else {
      const policyCreationPayload = createSpendingLimitPolicyCreationPayload({
        accountIndex: args.accountIndex,
        amount: args.amount,
        destinations: args.destinations,
        expiration: args.expiration,
        mint: args.mint,
        period: args.period,
      });
      const settings =
        await smartAccountsClient.smartAccounts.queries.fetchSettings(
          args.settingsPda
        );
      const nextPolicySeed = resolveNextPolicySeed(settings);
      const newPolicyPda = pda.getPolicyPda({
        programId: smartAccountsClient.programId,
        settingsPda: args.settingsPda,
        policySeed: nextPolicySeed.number,
      })[0];

      actions.push({
        __kind: "PolicyCreate",
        seed: toBn(nextPolicySeed.bigint),
        policyCreationPayload,
        signers: [createPolicySigner(args.signer)],
        threshold: 1,
        timeLock: 0,
        startTimestamp: null,
        expirationArgs: null,
      });
      policies.push(newPolicyPda);
    }

    return prepareSettingsChange({
      actions,
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: existingPolicy
        ? "updateSpendingLimitPolicy"
        : "createSpendingLimitPolicy",
      policies,
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareRemoveSpendingLimitPolicy(
    args: SmartAccountRemoveSpendingLimitProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    return prepareSettingsChange({
      actions: [
        {
          __kind: "PolicyRemove",
          policy: args.spendingLimitPolicy,
        },
      ],
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "removeSpendingLimitPolicy",
      policies: [args.spendingLimitPolicy],
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareEarnUsdcDeposit(
    args: SmartAccountEarnUsdcDepositInput
  ): Promise<SmartAccountPreparedEarnUsdcDeposit> {
    if (args.amountRaw <= BigInt(0)) {
      throw new Error("Earn deposit amount must be greater than 0.");
    }

    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const earnTarget = resolveKaminoEarnTarget(cluster, args.target);
    const earnUniverse = resolveEarnPolicyUniverse(cluster);
    const serializedEarnUniverse = serializeEarnPolicyUniverse(earnUniverse);
    const usdcMint = earnTarget.liquidityMint;
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const targetObligation = deriveKaminoVanillaObligation(
      vaultPda,
      earnTarget.market,
      earnTarget.lendProgramId
    );
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const vaultCollateralAta = earnTarget.reserveCollateralMint
      ? getAssociatedTokenAddressSync(
          earnTarget.reserveCollateralMint,
          vaultPda,
          true,
          TOKEN_PROGRAM_ID
        )
      : null;
    const shouldInitializeYieldRoutingPolicy =
      args.initializeYieldRoutingPolicy ?? true;
    if (typeof config.connection.getTokenAccountBalance === "function") {
      try {
        const walletUsdcBalance =
          await config.connection.getTokenAccountBalance(
            walletUsdcAta,
            "confirmed"
          );
        if (BigInt(walletUsdcBalance.value.amount) < args.amountRaw) {
          throw new Error(
            "Main wallet does not have enough USDC for this Earn deposit."
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message ===
            "Main wallet does not have enough USDC for this Earn deposit."
        ) {
          throw error;
        }
        if (
          error instanceof Error &&
          error.message.toLowerCase().includes("could not find account")
        ) {
          throw new Error(
            "Main wallet does not have enough USDC for this Earn deposit."
          );
        }
        throw error;
      }
    }
    const earnPolicy = shouldInitializeYieldRoutingPolicy
      ? (await discoverEarnYieldRoutingPolicyPairOnChain({
          cluster,
          feePayer: args.feePayer,
          policySigner: args.policySigner,
          settingsPda: args.settingsPda,
          signer: args.walletAddress,
        })) ??
        (await resolveEarnYieldRoutingPolicyForCreation({
          cluster,
          feePayer: args.feePayer,
          policySigner: args.policySigner,
          settingsPda: args.settingsPda,
          signer: args.walletAddress,
        }))
      : args.yieldRoutingPolicy
      ? args.yieldRoutingPolicy.setupPolicy
        ? {
            account: args.yieldRoutingPolicy.account,
            seed: args.yieldRoutingPolicy.seed,
            setupAccount: args.yieldRoutingPolicy.setupPolicy.account,
            setupSeed: args.yieldRoutingPolicy.setupPolicy.seed,
          }
        : args.yieldRoutingPolicy.prepareSetupPolicy
        ? await resolveEarnYieldRoutingSetupPolicyForCreation({
            cluster,
            feePayer: args.feePayer,
            policySeed: args.yieldRoutingPolicy.seed,
            policySigner: args.policySigner,
            settingsPda: args.settingsPda,
            signer: args.walletAddress,
          })
        : {
            account: args.yieldRoutingPolicy.account,
            seed: args.yieldRoutingPolicy.seed,
          }
      : await resolveEarnYieldRoutingPolicyForExecution({
          settingsPda: args.settingsPda,
        });
    // "create" only when route-policy creation ops are actually prepared —
    // discovery can satisfy an initialize request by reusing an on-chain pair,
    // and confirm requires policy-creation signatures whenever it sees
    // "create", which reuse flows never produce.
    const policyInitialization = earnPolicy.operation ? "create" : "reuse";
    const policyPersistence = earnPolicy.persistence ?? serializedEarnUniverse;
    const policyAccount = earnPolicy.account;
    const setupPolicyAccount = earnPolicy.setupAccount ?? null;
    const setupPolicySeed = earnPolicy.setupSeed ?? null;
    let kaminoDepositBundle =
      cluster === LoyalCluster.Devnet
        ? (() => {
            const instruction = createLocalKaminoDepositInstruction({
              amountRaw: args.amountRaw,
              target: earnTarget,
              vaultPda,
              vaultUsdcAta,
              vaultCollateralAta: vaultCollateralAta!,
            });
            return {
              instruction,
              instructions: [instruction],
              matchingInstructions: [instruction],
            };
          })()
        : await fetchKaminoDepositInstruction({
            amountRaw: args.amountRaw,
            depositDiscriminator: earnTarget.depositDiscriminator,
            lendProgramId: earnTarget.lendProgramId,
            market: earnTarget.market,
            reserve: earnTarget.reserve,
            wallet: vaultPda,
          });
    let targetReserveAccounts: KaminoReserveTokenAccounts | null = null;
    const fetchTargetReserveAccounts =
      async (): Promise<KaminoReserveTokenAccounts> => {
        if (targetReserveAccounts) {
          return targetReserveAccounts;
        }

        const reserveAccount = await config.connection.getAccountInfo(
          earnTarget.reserve,
          "confirmed"
        );
        if (!reserveAccount) {
          throw new Error("Selected Kamino reserve account was not found.");
        }

        targetReserveAccounts = parseKaminoReserveTokenAccounts(
          reserveAccount.data
        );
        assertKaminoAccountEquals({
          actual: targetReserveAccounts.reserveLiquidityMint,
          expected: usdcMint,
          label: "liquidity mint",
        });

        return targetReserveAccounts;
      };
    if (cluster !== LoyalCluster.Devnet) {
      const usesCurrentDepositAccountOrder =
        kaminoDepositBundle.instruction.keys[2]?.pubkey.equals(
          earnTarget.market
        ) ?? false;
      const executionReserve = usesCurrentDepositAccountOrder
        ? kaminoDepositBundle.instruction.keys[4]?.pubkey ?? null
        : null;
      if (executionReserve && !executionReserve.equals(earnTarget.reserve)) {
        const reserveAccounts = await fetchTargetReserveAccounts();
        const localDepositInstruction = createLocalKaminoDepositInstruction({
          amountRaw: args.amountRaw,
          obligation: targetObligation,
          reserveAccounts,
          target: {
            ...earnTarget,
            reserveCollateralMint: reserveAccounts.reserveCollateralMint,
            reserveLiquiditySupply: reserveAccounts.reserveLiquiditySupply,
          },
          vaultCollateralAta: getAssociatedTokenAddressSync(
            reserveAccounts.reserveCollateralMint,
            vaultPda,
            true,
            TOKEN_PROGRAM_ID
          ),
          vaultPda,
          vaultUsdcAta,
        });
        const refreshPrefix = kaminoDepositBundle.instructions.filter(
          (instruction) =>
            !instruction.data
              .subarray(0, earnTarget.depositDiscriminator.length)
              .equals(Buffer.from(earnTarget.depositDiscriminator))
        );
        kaminoDepositBundle = {
          instruction: localDepositInstruction,
          instructions: [...refreshPrefix, localDepositInstruction],
          matchingInstructions: [localDepositInstruction],
        };
      }

      if (typeof config.connection.getAccountInfo === "function") {
        const reserveAccounts = await fetchTargetReserveAccounts();
        if (!reserveAccounts.farmCollateral.equals(PublicKey.default)) {
          const obligationFarmUserState = deriveKaminoFarmUserStatePda({
            farmState: reserveAccounts.farmCollateral,
            owner: targetObligation,
          });
          const obligationFarmAccount = await config.connection.getAccountInfo(
            obligationFarmUserState,
            "confirmed"
          );
          const alreadyIncludesFarmInit = kaminoDepositBundle.instructions.some(
            (instruction) =>
              instructionDataStartsWith(
                instruction.data,
                KAMINO_INIT_OBLIGATION_FARMS_FOR_RESERVE_DISCRIMINATOR
              )
          );
          if (!obligationFarmAccount && !alreadyIncludesFarmInit) {
            const farmInitInstruction =
              createLocalKaminoInitObligationFarmsForReserveInstruction({
                obligation: targetObligation,
                reserveAccounts,
                target: earnTarget,
                vaultPda,
              });
            if (farmInitInstruction) {
              kaminoDepositBundle = {
                ...kaminoDepositBundle,
                instructions: insertKaminoSetupInstructionBeforeExecution({
                  instructions: kaminoDepositBundle.instructions,
                  setupInstruction: farmInitInstruction,
                }),
              };
            }
          }
        }
      }
    }
    const inferredVaultCollateralAccounts =
      vaultCollateralAta && earnTarget.reserveCollateralMint
        ? {
            reserveCollateralMint: earnTarget.reserveCollateralMint,
            vaultCollateralAta,
          }
        : inferKaminoDepositCollateralAccounts({
            instruction: kaminoDepositBundle.instruction,
            vaultPda,
            vaultUsdcAta,
          });
    const compiledKaminoPayload = instructionsToSynchronousTransactionDetailsV2(
      {
        vaultPda,
        members: [args.walletAddress],
        transaction_instructions: kaminoDepositBundle.instructions,
      }
    );
    const kaminoSetupInstructionCount = kaminoDepositBundle.instructions.filter(
      (instruction) =>
        instructionStartsWithAnyDiscriminator(
          instruction,
          KAMINO_SETUP_INSTRUCTION_DISCRIMINATORS
        )
    ).length;
    const requiresKaminoSetupRent = kaminoSetupInstructionCount > 0;
    const vaultLamports =
      requiresKaminoSetupRent &&
      typeof config.connection.getBalance === "function"
        ? await config.connection.getBalance(vaultPda, "confirmed")
        : KAMINO_EARN_SETUP_RENT_BUFFER_LAMPORTS;
    const setupRentTopUpLamports = requiresKaminoSetupRent
      ? Math.max(0, KAMINO_EARN_SETUP_RENT_BUFFER_LAMPORTS - vaultLamports)
      : 0;
    const setupRentTopUpInstruction =
      setupRentTopUpLamports > 0
        ? SystemProgram.transfer({
            fromPubkey: args.feePayer,
            toPubkey: vaultPda,
            lamports: setupRentTopUpLamports,
          })
        : null;
    // Ride the vault SOL top-up in the policy-finalize stage when one exists:
    // it lands before the deposit and has packet headroom, while the
    // first-deposit tx sits near the 1232-byte packet limit — and clients may
    // prepend a priority-fee instruction (~44 bytes) on top of what we prepare
    // here, so every stage should keep that margin free. The ATA creates stay
    // in the deposit tx, where their accounts are already referenced and cost
    // only a few bytes.
    const policyInitializationOperation = earnPolicy.operation ?? null;
    const policyFinalizeOperation = earnPolicy.finalizeOperation
      ? {
          ...earnPolicy.finalizeOperation,
          instructions: [
            ...earnPolicy.finalizeOperation.instructions,
            ...(setupRentTopUpInstruction ? [setupRentTopUpInstruction] : []),
          ],
        }
      : null;
    const depositExecution =
      await smartAccountsClient.features.execution.prepare.executeTransactionSyncV2(
        {
          feePayer: args.feePayer,
          settingsPda: args.settingsPda,
          accountIndex: EARN_DEPOSIT_VAULT_INDEX,
          numSigners: 1,
          instructions: compiledKaminoPayload.instructions,
          instruction_accounts: compiledKaminoPayload.accounts,
        } as never
      );
    const policyOperations = [depositExecution];
    // Stray-approval heal: a pre-fix autodeposit delete left the unlimited
    // SPL delegate that InitAuthority approved on the wallet's USDC ATA. When
    // the caller vouches there is no live autodeposit (DB-side gate), ride an
    // SPL revoke in the deposit tx — but only when the delegate on chain is
    // still our subscription authority, so a foreign approval is untouched.
    let strayDelegateRevokeInstruction: TransactionInstruction | null = null;
    if (args.revokeStrayUsdcDelegate === true) {
      const subscriptionAuthority = deriveSubscriptionAuthority(
        args.walletAddress,
        usdcMint
      );
      const walletUsdcAtaInfo = await config.connection.getAccountInfo(
        walletUsdcAta
      );
      if (
        walletUsdcAtaInfo &&
        walletUsdcAtaInfo.data.length >= AccountLayout.span
      ) {
        const decoded = AccountLayout.decode(walletUsdcAtaInfo.data);
        if (
          decoded.delegateOption === 1 &&
          new PublicKey(decoded.delegate).equals(subscriptionAuthority)
        ) {
          strayDelegateRevokeInstruction = createRevokeInstruction(
            walletUsdcAta,
            args.walletAddress
          );
        }
      }
    }
    const depositInstructions = [
      createAssociatedTokenAccountIdempotentInstruction(
        args.feePayer,
        vaultUsdcAta,
        vaultPda,
        usdcMint,
        TOKEN_PROGRAM_ID
      ),
      // The Kamino deposit CPI receives reserve collateral (cTokens) into the
      // vault's collateral ATA, so it must exist and be Token-owned before the
      // smart-account program validates the interaction. Create it idempotently.
      ...(inferredVaultCollateralAccounts
        ? [
            createAssociatedTokenAccountIdempotentInstruction(
              args.feePayer,
              inferredVaultCollateralAccounts.vaultCollateralAta,
              vaultPda,
              inferredVaultCollateralAccounts.reserveCollateralMint,
              TOKEN_PROGRAM_ID
            ),
          ]
        : []),
      ...(setupRentTopUpInstruction && !policyFinalizeOperation
        ? [setupRentTopUpInstruction]
        : []),
      createTransferCheckedInstruction(
        walletUsdcAta,
        usdcMint,
        vaultUsdcAta,
        args.walletAddress,
        args.amountRaw,
        EARN_DEPOSIT_USDC_DECIMALS,
        [],
        TOKEN_PROGRAM_ID
      ),
      ...policyOperations.flatMap((operation) => operation.instructions),
    ];
    const freezeDeposit = (instructions: TransactionInstruction[]) =>
      freezePreparedOperation({
        operation: "earnUsdcDeposit",
        payer: args.feePayer,
        programId: smartAccountsClient.programId,
        requiresConfirmation: true,
        instructions,
        lookupTableAccounts: dedupeLookupTableAccounts(
          policyOperations.flatMap(
            (operation) => operation.lookupTableAccounts ?? []
          )
        ),
      });
    let prepared = freezeDeposit(
      strayDelegateRevokeInstruction
        ? [...depositInstructions, strayDelegateRevokeInstruction]
        : depositInstructions
    );
    let preparedLength = preparedPacketLength(prepared);
    if (
      strayDelegateRevokeInstruction &&
      (preparedLength === null ||
        preparedLength > EARN_POLICY_PACKET_DATA_SIZE)
    ) {
      // The heal rider must never sink a deposit: drop it when the tx is at
      // the packet ceiling — a later deposit or delete re-heals the wallet.
      prepared = freezeDeposit(depositInstructions);
      preparedLength = preparedPacketLength(prepared);
    }
    if (
      preparedLength === null ||
      preparedLength > EARN_POLICY_PACKET_DATA_SIZE
    ) {
      throw new Error(
        "Earn deposit transaction is too large to fit in a Solana packet. Split Kamino setup from the deposit and try again."
      );
    }
    for (const stageOperation of [
      policyInitializationOperation,
      policyFinalizeOperation,
    ]) {
      if (!stageOperation) {
        continue;
      }
      const stageLength = preparedPacketLength(stageOperation);
      if (stageLength === null || stageLength > EARN_POLICY_PACKET_DATA_SIZE) {
        throw new Error(
          "Earn policy setup transaction is too large to fit in a Solana packet."
        );
      }
    }
    const nativeSolRequirement = await estimateNativeSolRequirement({
      connection: config.connection,
      fixedItems:
        setupRentTopUpLamports > 0
          ? [
              {
                account: vaultPda.toBase58(),
                kind: "kamino_setup_top_up",
                label: "Kamino setup account rent top-up",
                lamports: setupRentTopUpLamports,
                stage: "deposit",
              },
            ]
          : [],
      payer: args.feePayer,
      prepared: [
        ...(policyInitializationOperation
          ? [policyInitializationOperation]
          : []),
        ...(policyFinalizeOperation ? [policyFinalizeOperation] : []),
        prepared,
      ],
      rentCandidates: [
        ...(earnPolicy.nativeSolRentCandidates ?? []),
        {
          account: vaultUsdcAta,
          kind: "token_account_rent",
          label: "Earn vault USDC token account rent",
          space: AccountLayout.span,
          stage: "deposit",
        },
        ...(inferredVaultCollateralAccounts
          ? [
              {
                account: inferredVaultCollateralAccounts.vaultCollateralAta,
                kind: "token_account_rent" as const,
                label: "Earn vault collateral token account rent",
                space: AccountLayout.span,
                stage: "deposit",
              },
            ]
          : []),
      ],
    });

    return {
      kaminoSetupAccountCount: kaminoSetupInstructionCount,
      kaminoSetupRentLamports: setupRentTopUpLamports.toString(),
      kaminoSetupRequired: requiresKaminoSetupRent,
      nativeSolRequirement,
      policyFinalizePrepared: policyFinalizeOperation,
      policySetupPrepared: policyInitializationOperation,
      prepared,
      policy: {
        account: policyAccount,
        id: earnPolicy.seed,
        seed: earnPolicy.seed,
        sameMintInstructionConstraintIndexes:
          EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES,
      },
      ...(setupPolicyAccount && setupPolicySeed
        ? {
            setupPolicy: {
              account: setupPolicyAccount,
              id: setupPolicySeed,
              initObligationInstructionConstraintIndex: 0,
              seed: setupPolicySeed,
            },
          }
        : {}),
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        collateralAta:
          inferredVaultCollateralAccounts?.vaultCollateralAta ?? null,
        pubkey: vaultPda,
        usdcAta: vaultUsdcAta,
      },
      targetReserve: {
        reserve: earnTarget.reserve,
        market: earnTarget.market,
        liquidityMint: usdcMint,
        obligation: targetObligation,
        supplyApyBps: earnTarget.supplyApyBps,
      },
      persistence: {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        delegatedSigner: args.policySigner.toBase58(),
        settings: args.settingsPda.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyId: earnPolicy.seed.toString(),
        policyAccount: policyAccount.toBase58(),
        policySeed: earnPolicy.seed.toString(),
        ...(setupPolicyAccount && setupPolicySeed
          ? {
              setupPolicyId: setupPolicySeed.toString(),
              setupPolicyAccount: setupPolicyAccount.toBase58(),
              setupPolicySeed: setupPolicySeed.toString(),
            }
          : {}),
        targetReserve: earnTarget.reserve.toBase58(),
        market: earnTarget.market.toBase58(),
        liquidityMint: usdcMint.toBase58(),
        depositMint: usdcMint.toBase58(),
        principalAmountRaw: args.amountRaw.toString(),
        policyInitialization,
        targetSupplyApyBps: earnTarget.supplyApyBps?.toString() ?? null,
        ...policyPersistence,
      },
    };
  }

  async function prepareEarnUsdcYieldRoutingPolicy(
    args: SmartAccountEarnUsdcYieldRoutingPolicyInput
  ): Promise<SmartAccountPreparedEarnUsdcYieldRoutingPolicy> {
    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const earnTarget = resolveKaminoEarnTarget(cluster, args.target);
    const usdcMint = earnTarget.liquidityMint;
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const targetObligation = deriveKaminoVanillaObligation(
      vaultPda,
      earnTarget.market,
      earnTarget.lendProgramId
    );
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const nextPolicySeed = resolveNextPolicySeed(settings);
    const {
      finalizeOperation: finalizePrepared,
      operation: prepared,
      persistence,
      policyAccount,
      setupPolicyAccount,
      setupPolicySeed,
    } = await createEarnYieldRoutingPolicyOperation({
      cluster,
      feePayer: args.feePayer,
      policySeed: nextPolicySeed.bigint,
      policySigner: args.signer,
      settingsPda: args.settingsPda,
      signer: args.walletAddress,
    });

    return {
      finalizePrepared,
      prepared,
      policy: {
        account: policyAccount,
        id: nextPolicySeed.bigint,
        seed: nextPolicySeed.bigint,
      },
      setupPolicy: {
        account: setupPolicyAccount,
        id: setupPolicySeed,
        initObligationInstructionConstraintIndex: 0,
        seed: setupPolicySeed,
      },
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
      },
      targetReserve: {
        reserve: earnTarget.reserve,
        market: earnTarget.market,
        liquidityMint: usdcMint,
        obligation: targetObligation,
      },
      persistence: {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        delegatedSigner: args.signer.toBase58(),
        settings: args.settingsPda.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyId: nextPolicySeed.bigint.toString(),
        policyAccount: policyAccount.toBase58(),
        policySeed: nextPolicySeed.bigint.toString(),
        setupPolicyId: setupPolicySeed.toString(),
        setupPolicyAccount: setupPolicyAccount.toBase58(),
        setupPolicySeed: setupPolicySeed.toString(),
        targetReserve: earnTarget.reserve.toBase58(),
        market: earnTarget.market.toBase58(),
        liquidityMint: usdcMint.toBase58(),
        ...persistence,
      },
    };
  }

  async function prepareEarnUsdcWithdraw(
    args: SmartAccountEarnUsdcWithdrawInput
  ): Promise<SmartAccountPreparedEarnUsdcWithdraw> {
    if (args.amountRaw <= BigInt(0)) {
      throw new Error("Earn withdraw amount must be greater than 0.");
    }

    if (args.mode !== "partial" && args.mode !== "full") {
      throw new Error("Earn withdraw mode must be partial or full.");
    }

    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const earnTarget = resolveKaminoEarnTarget(cluster, args.target);
    const usdcMint = earnTarget.liquidityMint;
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const targetObligation = deriveKaminoVanillaObligation(
      vaultPda,
      earnTarget.market,
      earnTarget.lendProgramId
    );
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const earnPolicy = args.yieldRoutingPolicy
      ? {
          account: args.yieldRoutingPolicy.account,
          seed: args.yieldRoutingPolicy.seed,
          setupAccount: args.yieldRoutingPolicy.setupPolicy?.account,
          setupSeed: args.yieldRoutingPolicy.setupPolicy?.seed,
        }
      : await resolveEarnYieldRoutingPolicyForExecution({
          settingsPda: args.settingsPda,
        });
    const policyAccount = earnPolicy.account;
    const setupPolicyAccount = earnPolicy.setupAccount ?? null;
    const setupPolicySeed = earnPolicy.setupSeed ?? null;
    const isFinalExit =
      args.mode === "full" && args.closePoliciesOnFullWithdrawal !== false;
    const sourceMetadata = args.source
      ? {
          sourceAmountRaw: args.source.amountRaw.toString(),
          sourceId: args.source.id,
          sourceMetadata: {
            ...(args.source.type === "idle"
              ? {
                  mint: args.source.mint.toBase58(),
                  tokenAccount: args.source.tokenAccount.toBase58(),
                }
              : {
                  liquidityMint: args.source.liquidityMint.toBase58(),
                  market: args.source.market.toBase58(),
                  reserve: args.source.reserve.toBase58(),
                }),
          },
          sourceMint:
            args.source.type === "idle"
              ? args.source.mint.toBase58()
              : args.source.liquidityMint.toBase58(),
          sourceTokenAccount:
            args.source.type === "idle"
              ? args.source.tokenAccount.toBase58()
              : undefined,
          sourceType: args.source.type,
        }
      : undefined;
    const autodepositCloseOperation =
      isFinalExit && args.autodepositClose
        ? await prepareEarnUsdcAutodepositClose({
            cluster,
            feePayer: args.feePayer,
            memo: args.memo,
            policy: args.autodepositClose.policy,
            policySigner: args.policySigner,
            recurringDelegation: args.autodepositClose.recurringDelegation,
            settingsPda: args.settingsPda,
            signer: args.walletAddress,
            walletAddress: args.walletAddress,
          })
        : null;

    if (args.source?.type === "idle") {
      const transferAmountRaw = args.amountRaw;
      const transferInstruction = makeSignerWritable(
        createTransferCheckedInstruction(
          vaultUsdcAta,
          usdcMint,
          walletUsdcAta,
          vaultPda,
          transferAmountRaw,
          EARN_DEPOSIT_USDC_DECIMALS,
          [],
          TOKEN_PROGRAM_ID
        ),
        vaultPda
      );
      const cleanupInstructions = isFinalExit
        ? createEarnFullWithdrawCleanupInstructions({
            vaultPda,
            vaultSweepLamports: await getVaultSweepLamportsOrZero(
              config.connection,
              vaultPda
            ),
            vaultUsdcAta,
            walletAddress: args.walletAddress,
          })
        : [];
      const compiledPackedPayload =
        instructionsToSynchronousTransactionDetailsV2({
          vaultPda,
          members: [args.walletAddress],
          transaction_instructions: [
            transferInstruction,
            ...cleanupInstructions,
          ],
        });
      const packedExecution =
        await smartAccountsClient.features.execution.prepare.executeTransactionSyncV2(
          {
            feePayer: args.feePayer,
            settingsPda: args.settingsPda,
            accountIndex: EARN_DEPOSIT_VAULT_INDEX,
            numSigners: 1,
            instructions: compiledPackedPayload.instructions,
            instruction_accounts: compiledPackedPayload.accounts,
            memo: args.memo,
          } as never
        );
      const policyCloseOperation = isFinalExit
        ? await prepareCloseLiveYieldRoutingPoliciesSync({
            settingsPda: args.settingsPda,
            feePayer: args.feePayer,
            signers: [args.walletAddress],
            policies: [
              policyAccount,
              ...(setupPolicyAccount ? [setupPolicyAccount] : []),
            ],
            memo: args.memo,
          })
        : null;
      const operations = [
        packedExecution,
        ...(policyCloseOperation ? [policyCloseOperation] : []),
      ];
      const prepared = freezePreparedOperation({
        operation: "earnUsdcWithdraw",
        payer: args.feePayer,
        programId: smartAccountsClient.programId,
        requiresConfirmation: true,
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(
            args.feePayer,
            walletUsdcAta,
            args.walletAddress,
            usdcMint,
            TOKEN_PROGRAM_ID
          ),
          ...operations.flatMap((operation) => operation.instructions),
        ],
        lookupTableAccounts: dedupeLookupTableAccounts(
          operations.flatMap((operation) => operation.lookupTableAccounts ?? [])
        ),
      });
      const persistence = {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        delegatedSigner: args.policySigner.toBase58(),
        settings: args.settingsPda.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyId: earnPolicy.seed.toString(),
        policyAccount: policyAccount.toBase58(),
        policySeed: earnPolicy.seed.toString(),
        ...(setupPolicyAccount && setupPolicySeed
          ? {
              setupPolicyId: setupPolicySeed.toString(),
              setupPolicyAccount: setupPolicyAccount.toBase58(),
              setupPolicySeed: setupPolicySeed.toString(),
            }
          : {}),
        targetReserve: earnTarget.reserve.toBase58(),
        market: earnTarget.market.toBase58(),
        liquidityMint: usdcMint.toBase58(),
        withdrawnAmountRaw: transferAmountRaw.toString(),
        mode: args.mode,
        walletTransferAmountRaw: transferAmountRaw.toString(),
        vaultUsdcRemainderRaw: "0",
        vaultCollateralCleanupIncluded: false,
        autodepositClose: autodepositCloseOperation?.persistence ?? null,
        ...(sourceMetadata ?? {}),
      };
      const withdrawStep = {
        accountingReserve: {
          liquidityMint: usdcMint,
          market: earnTarget.market,
          obligation: targetObligation,
          reserve: earnTarget.reserve,
        },
        amountRaw: transferAmountRaw,
        collateralAta: getAssociatedTokenAddressSync(
          earnTarget.reserveCollateralMint ?? usdcMint,
          vaultPda,
          true,
          TOKEN_PROGRAM_ID
        ),
        executionReserve: {
          liquidityMint: usdcMint,
          market: earnTarget.market,
          reserve: earnTarget.reserve,
        },
        mode: args.mode,
        prepared,
        reserveWithdrawals: [],
        stepCount: 1,
        stepIndex: 0,
        persistence: {
          ...persistence,
          autodepositClose: autodepositCloseOperation?.persistence ?? null,
          isFinalStep: true,
          stepCount: 1,
          stepIndex: 0,
        },
      };

      return {
        autodepositClosePrepared: autodepositCloseOperation,
        prepared,
        withdrawSteps: [withdrawStep],
        mode: args.mode,
        amountRaw: args.amountRaw,
        policy: {
          account: policyAccount,
          id: earnPolicy.seed,
          seed: earnPolicy.seed,
          withdrawInstructionConstraintIndex: 0,
          sameMintInstructionConstraintIndexes:
            EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES,
        },
        ...(setupPolicyAccount && setupPolicySeed
          ? {
              setupPolicy: {
                account: setupPolicyAccount,
                id: setupPolicySeed,
                seed: setupPolicySeed,
              },
            }
          : {}),
        vault: {
          accountIndex: EARN_DEPOSIT_VAULT_INDEX,
          pubkey: vaultPda,
          usdcAta: vaultUsdcAta,
          collateralAta: withdrawStep.collateralAta,
        },
        targetReserve: {
          reserve: earnTarget.reserve,
          market: earnTarget.market,
          liquidityMint: usdcMint,
          obligation: targetObligation,
        },
        persistence,
      };
    }
    const safeMarkets = new Set(
      getRiskBasketMarketsForCluster(cluster, EARN_RISK_PROFILE).map((market) =>
        market.toBase58()
      )
    );
    const requestedTargets =
      args.mode === "full" && args.fullWithdrawalTargets?.length
        ? args.fullWithdrawalTargets
        : args.source?.type === "reserve"
        ? [
            {
              liquidityMint: args.source.liquidityMint,
              market: args.source.market,
              reserve: args.source.reserve,
              amountRaw: args.amountRaw,
            },
          ]
        : [
            {
              liquidityMint: earnTarget.liquidityMint,
              market: earnTarget.market,
              reserve: earnTarget.reserve,
              reserveCollateralMint: earnTarget.reserveCollateralMint,
              reserveLiquiditySupply: earnTarget.reserveLiquiditySupply,
              supplyApyBps: earnTarget.supplyApyBps,
              amountRaw: args.amountRaw,
            },
          ];
    const withdrawPlans = requestedTargets.map((targetInput) => {
      const target = resolveKaminoEarnTarget(cluster, targetInput);
      const localCollateralAta = target.reserveCollateralMint
        ? getAssociatedTokenAddressSync(
            target.reserveCollateralMint,
            vaultPda,
            true,
            TOKEN_PROGRAM_ID
          )
        : null;
      const reconciledCollateralAta =
        "vaultCollateralAta" in targetInput
          ? targetInput.vaultCollateralAta ?? null
          : null;

      assertKaminoAccountEquals({
        actual: target.liquidityMint,
        expected: usdcMint,
        label: "liquidity mint",
      });

      return {
        amountRaw: targetInput.amountRaw ?? args.amountRaw,
        localCollateralAta: reconciledCollateralAta ?? localCollateralAta,
        obligation: deriveKaminoVanillaObligation(
          vaultPda,
          target.market,
          target.lendProgramId
        ),
        target,
      };
    });

    const MAX_EARN_WITHDRAW_RESERVES_PER_APPROVAL = 2;

    type ProvisionalReserveWithdrawal = {
      accountingReserve: SmartAccountPreparedEarnUsdcWithdrawStep["accountingReserve"];
      amountRaw: bigint;
      collateralAta: PublicKey;
      executionReserve: SmartAccountPreparedEarnUsdcWithdrawStep["executionReserve"];
      expectedRedeemedAmountRaw: bigint;
      instruction: TransactionInstruction;
      instructions: TransactionInstruction[];
      kaminoWithdrawAmountRaw: bigint;
    };

    type ProvisionalWithdrawBatch = Omit<
      SmartAccountPreparedEarnUsdcWithdrawStep,
      "stepCount" | "stepIndex"
    > & {
      vaultCollateralCleanupIncluded: boolean;
      vaultUsdcRemainderRaw: bigint;
      walletTransferAmountRaw: bigint;
    };

    const readWithdrawInstructionAmountRaw = (
      instruction: TransactionInstruction,
      fallback: bigint
    ) =>
      instruction.data.length >= 16
        ? readUint64LE(instruction.data, 8)
        : fallback;

    const chunkReserveWithdrawals = (
      withdrawals: ProvisionalReserveWithdrawal[]
    ): ProvisionalReserveWithdrawal[][] => {
      const batches: ProvisionalReserveWithdrawal[][] = [];
      for (
        let index = 0;
        index < withdrawals.length;
        index += MAX_EARN_WITHDRAW_RESERVES_PER_APPROVAL
      ) {
        batches.push(
          withdrawals.slice(
            index,
            index + MAX_EARN_WITHDRAW_RESERVES_PER_APPROVAL
          )
        );
      }
      return batches;
    };

    const collectReserveWithdrawalsForPlan = async (plan: {
      amountRaw: bigint;
      localCollateralAta: PublicKey | null;
      obligation: PublicKey;
      target: KaminoEarnTarget;
    }): Promise<ProvisionalReserveWithdrawal[]> => {
      const partialWithdrawAmounts =
        args.mode === "full"
          ? null
          : await resolveEarnPartialWithdrawAmounts({
              connection: config.connection,
              requestedWithdrawAmountRaw: plan.amountRaw,
              reserve: plan.target.reserve,
            });
      let expectedRedeemedAmountRaw =
        partialWithdrawAmounts?.expectedRedeemedAmountRaw ?? plan.amountRaw;
      let kaminoWithdrawAmountRaw =
        partialWithdrawAmounts?.kaminoWithdrawAmountRaw ?? plan.amountRaw;
      let reserveSnapshot: KaminoReserveSnapshot | null =
        partialWithdrawAmounts?.snapshot ?? null;
      let vaultCollateralAta = plan.localCollateralAta;
      let kaminoWithdrawBundle =
        cluster === LoyalCluster.Devnet
          ? (() => {
              if (!vaultCollateralAta) {
                throw new Error(
                  "Kamino vault collateral token account is unavailable."
                );
              }
              const instruction = createLocalKaminoWithdrawInstruction({
                amountRaw: kaminoWithdrawAmountRaw,
                target: plan.target,
                vaultPda,
                vaultUsdcAta,
                vaultCollateralAta,
              });
              return {
                instruction,
                instructions: [instruction],
                matchingInstructions: [instruction],
              };
            })()
          : await fetchKaminoWithdrawInstruction({
              amountRaw: kaminoWithdrawAmountRaw,
              lendProgramId: plan.target.lendProgramId,
              market: plan.target.market,
              reserve: plan.target.reserve,
              withdrawDiscriminator: plan.target.withdrawDiscriminator,
              wallet: vaultPda,
            });
      let validatedWithdrawAccounts = validateKaminoWithdrawInstruction({
        instruction: kaminoWithdrawBundle.instruction,
        lendProgramId: plan.target.lendProgramId,
        liquidityMint: usdcMint,
        market: plan.target.market,
        safeMarkets,
        vaultPda,
        vaultUsdcAta,
        withdrawDiscriminator: plan.target.withdrawDiscriminator,
      });
      if (
        !validatedWithdrawAccounts.executionReserve.equals(plan.target.reserve)
      ) {
        const reserveAccount = await config.connection.getAccountInfo(
          plan.target.reserve,
          "confirmed"
        );
        if (!reserveAccount) {
          throw new Error("Selected Kamino reserve account was not found.");
        }
        const reserveAccounts = parseKaminoReserveTokenAccounts(
          reserveAccount.data
        );
        assertKaminoAccountEquals({
          actual: reserveAccounts.reserveLiquidityMint,
          expected: usdcMint,
          label: "liquidity mint",
        });
        const selectedVaultCollateralAta = getAssociatedTokenAddressSync(
          reserveAccounts.reserveCollateralMint,
          vaultPda,
          true,
          TOKEN_PROGRAM_ID
        );
        const selectedWithdrawInstruction =
          createLocalKaminoWithdrawInstruction({
            amountRaw: kaminoWithdrawAmountRaw,
            obligation: plan.obligation,
            reserveAccounts,
            target: {
              ...plan.target,
              reserveCollateralMint: reserveAccounts.reserveCollateralMint,
              reserveLiquiditySupply: reserveAccounts.reserveLiquiditySupply,
            },
            vaultCollateralAta: selectedVaultCollateralAta,
            vaultPda,
            vaultUsdcAta,
          });
        const refreshPrefix = kaminoWithdrawBundle.instructions.filter(
          (instruction) =>
            !instruction.data
              .subarray(0, plan.target.withdrawDiscriminator.length)
              .equals(Buffer.from(plan.target.withdrawDiscriminator))
        );
        kaminoWithdrawBundle = {
          instruction: selectedWithdrawInstruction,
          instructions: [...refreshPrefix, selectedWithdrawInstruction],
          matchingInstructions: [selectedWithdrawInstruction],
        };
        validatedWithdrawAccounts = validateKaminoWithdrawInstruction({
          instruction: kaminoWithdrawBundle.instruction,
          lendProgramId: plan.target.lendProgramId,
          liquidityMint: usdcMint,
          market: plan.target.market,
          safeMarkets,
          vaultPda,
          vaultUsdcAta,
          withdrawDiscriminator: plan.target.withdrawDiscriminator,
        });
      }
      if (
        !validatedWithdrawAccounts.usesCurrentWithdrawAccountOrder &&
        plan.localCollateralAta &&
        !validatedWithdrawAccounts.vaultCollateralAta.equals(
          plan.localCollateralAta
        )
      ) {
        const [returnedIsVaultOwned, reconciledIsVaultOwned, reserveAccount] =
          await Promise.all([
            isTokenAccountOwnedBy({
              account: validatedWithdrawAccounts.vaultCollateralAta,
              connection: config.connection,
              owner: vaultPda,
            }),
            isTokenAccountOwnedBy({
              account: plan.localCollateralAta,
              connection: config.connection,
              owner: vaultPda,
            }),
            config.connection.getAccountInfo(
              validatedWithdrawAccounts.executionReserve,
              "confirmed"
            ),
          ]);

        if (!returnedIsVaultOwned && reconciledIsVaultOwned) {
          if (!reserveAccount) {
            throw new Error("Selected Kamino reserve account was not found.");
          }
          const reserveAccounts = parseKaminoReserveTokenAccounts(
            reserveAccount.data
          );
          const reconciledWithdrawInstruction =
            createLocalKaminoWithdrawInstruction({
              amountRaw: kaminoWithdrawAmountRaw,
              obligation: plan.obligation,
              reserveAccounts,
              target: {
                ...plan.target,
                reserve: validatedWithdrawAccounts.executionReserve,
                reserveCollateralMint: reserveAccounts.reserveCollateralMint,
                reserveLiquiditySupply: reserveAccounts.reserveLiquiditySupply,
              },
              vaultCollateralAta: plan.localCollateralAta,
              vaultPda,
              vaultUsdcAta,
            });
          const refreshPrefix = kaminoWithdrawBundle.instructions.filter(
            (instruction) =>
              !instruction.data
                .subarray(0, plan.target.withdrawDiscriminator.length)
                .equals(Buffer.from(plan.target.withdrawDiscriminator))
          );
          kaminoWithdrawBundle = {
            instruction: reconciledWithdrawInstruction,
            instructions: [...refreshPrefix, reconciledWithdrawInstruction],
            matchingInstructions: [reconciledWithdrawInstruction],
          };
          validatedWithdrawAccounts = validateKaminoWithdrawInstruction({
            instruction: kaminoWithdrawBundle.instruction,
            lendProgramId: plan.target.lendProgramId,
            liquidityMint: usdcMint,
            market: plan.target.market,
            safeMarkets,
            vaultPda,
            vaultUsdcAta,
            withdrawDiscriminator: plan.target.withdrawDiscriminator,
          });
        }
      }
      vaultCollateralAta = validatedWithdrawAccounts.vaultCollateralAta;
      if (plan.target.reserveCollateralMint) {
        assertKaminoAccountEquals({
          actual: validatedWithdrawAccounts.reserveCollateralMint,
          expected: plan.target.reserveCollateralMint,
          label: "reserve collateral mint",
        });
      }

      const fullWithdrawAmounts = await (async () => {
        if (args.mode !== "full") {
          return {
            expectedRedeemedAmountRaw,
            kaminoWithdrawAmountRaw,
            snapshot: reserveSnapshot,
          };
        }
        const canResolveFromVaultCollateralAta =
          vaultCollateralAta &&
          (await isTokenAccountOwnedBy({
            account: vaultCollateralAta,
            connection: config.connection,
            owner: vaultPda,
          }));
        if (!canResolveFromVaultCollateralAta) {
          return {
            expectedRedeemedAmountRaw,
            kaminoWithdrawAmountRaw,
            snapshot: reserveSnapshot,
          };
        }

        return resolveEarnFullWithdrawAmounts({
          connection: config.connection,
          requestedWithdrawAmountRaw: plan.amountRaw,
          reserve: plan.target.reserve,
          vaultCollateralAta,
        });
      })();

      if (args.mode === "full") {
        expectedRedeemedAmountRaw =
          fullWithdrawAmounts.expectedRedeemedAmountRaw;
        kaminoWithdrawAmountRaw = fullWithdrawAmounts.kaminoWithdrawAmountRaw;
        reserveSnapshot = fullWithdrawAmounts.snapshot;
        if (
          kaminoWithdrawAmountRaw !== plan.amountRaw &&
          cluster !== LoyalCluster.Devnet
        ) {
          kaminoWithdrawBundle = await fetchKaminoWithdrawInstruction({
            amountRaw: kaminoWithdrawAmountRaw,
            lendProgramId: plan.target.lendProgramId,
            market: plan.target.market,
            reserve: plan.target.reserve,
            withdrawDiscriminator: plan.target.withdrawDiscriminator,
            wallet: vaultPda,
          });
          validatedWithdrawAccounts = validateKaminoWithdrawInstruction({
            instruction: kaminoWithdrawBundle.instruction,
            lendProgramId: plan.target.lendProgramId,
            liquidityMint: usdcMint,
            market: plan.target.market,
            safeMarkets,
            vaultPda,
            vaultUsdcAta,
            withdrawDiscriminator: plan.target.withdrawDiscriminator,
          });
          assertKaminoAccountEquals({
            actual: validatedWithdrawAccounts.vaultCollateralAta,
            expected: vaultCollateralAta,
            label: "vault collateral account",
          });
          if (plan.target.reserveCollateralMint) {
            assertKaminoAccountEquals({
              actual: validatedWithdrawAccounts.reserveCollateralMint,
              expected: plan.target.reserveCollateralMint,
              label: "reserve collateral mint",
            });
          }
        }
      } else {
        reserveSnapshot = partialWithdrawAmounts?.snapshot ?? reserveSnapshot;
      }

      if (!vaultCollateralAta) {
        throw new Error(
          "Kamino vault collateral token account is unavailable."
        );
      }
      const matchingWithdrawInstructions =
        kaminoWithdrawBundle.matchingInstructions.length > 0
          ? kaminoWithdrawBundle.matchingInstructions
          : [kaminoWithdrawBundle.instruction];
      const singleWithdrawPrefixInstructions =
        matchingWithdrawInstructions.length === 1
          ? kaminoWithdrawBundle.instructions
          : null;
      const reserveWithdrawals: ProvisionalReserveWithdrawal[] = [];

      for (const withdrawInstruction of matchingWithdrawInstructions) {
        const instructionValidation = validateKaminoWithdrawInstruction({
          instruction: withdrawInstruction,
          lendProgramId: plan.target.lendProgramId,
          liquidityMint: usdcMint,
          market: plan.target.market,
          safeMarkets,
          vaultPda,
          vaultUsdcAta,
          withdrawDiscriminator: plan.target.withdrawDiscriminator,
        });
        const stepKaminoWithdrawAmountRaw = readWithdrawInstructionAmountRaw(
          withdrawInstruction,
          kaminoWithdrawAmountRaw
        );
        const stepExpectedRedeemedAmountRaw =
          calculateRedeemableAmountOrFallback({
            fallbackAmountRaw: expectedRedeemedAmountRaw,
            kaminoWithdrawAmountRaw: stepKaminoWithdrawAmountRaw,
            snapshot: reserveSnapshot,
          });

        reserveWithdrawals.push({
          accountingReserve: {
            liquidityMint: usdcMint,
            market: plan.target.market,
            obligation: plan.obligation,
            reserve: plan.target.reserve,
          },
          amountRaw: plan.amountRaw,
          collateralAta: instructionValidation.vaultCollateralAta,
          executionReserve: {
            liquidityMint: usdcMint,
            market: instructionValidation.executionMarket,
            reserve: instructionValidation.executionReserve,
          },
          expectedRedeemedAmountRaw: stepExpectedRedeemedAmountRaw,
          instruction: withdrawInstruction,
          instructions: singleWithdrawPrefixInstructions ?? [
            withdrawInstruction,
          ],
          kaminoWithdrawAmountRaw: stepKaminoWithdrawAmountRaw,
        });
      }

      return reserveWithdrawals;
    };

    const fullWithdrawVaultUsdcRemainderRaw = isFinalExit
      ? await getTokenAccountAmountOrZero(config.connection, vaultUsdcAta)
      : BigInt(0);
    const fullWithdrawVaultSweepLamports = isFinalExit
      ? await getVaultSweepLamportsOrZero(config.connection, vaultPda)
      : BigInt(0);

    const reserveWithdrawals = (
      await Promise.all(
        withdrawPlans.map((plan) => collectReserveWithdrawalsForPlan(plan))
      )
    ).flat();
    if (reserveWithdrawals.length === 0) {
      throw new Error("Kamino did not return any Earn withdraw steps.");
    }

    const reserveWithdrawalBatches =
      chunkReserveWithdrawals(reserveWithdrawals);
    const finalBatchIndex = reserveWithdrawalBatches.length - 1;

    const buildWithdrawBatch = async (
      batch: ProvisionalReserveWithdrawal[],
      batchIndex: number
    ): Promise<ProvisionalWithdrawBatch> => {
      const firstWithdrawal = batch[0]!;
      const isFinalBatch = batchIndex === finalBatchIndex;
      const batchAmountRaw = batch.reduce(
        (total, withdrawal) => total + withdrawal.amountRaw,
        BigInt(0)
      );
      const batchKaminoWithdrawAmountRaw = batch.reduce(
        (total, withdrawal) => total + withdrawal.kaminoWithdrawAmountRaw,
        BigInt(0)
      );
      const batchExpectedRedeemedAmountRaw = batch.reduce(
        (total, withdrawal) => total + withdrawal.expectedRedeemedAmountRaw,
        BigInt(0)
      );
      const batchVaultUsdcRemainderRaw =
        isFinalExit && isFinalBatch
          ? fullWithdrawVaultUsdcRemainderRaw
          : BigInt(0);
      const compiledWithdrawPrefix =
        instructionsToSynchronousTransactionDetailsV2({
          vaultPda,
          members: [args.walletAddress],
          transaction_instructions: batch.flatMap(
            (withdrawal) => withdrawal.instructions
          ),
        });
      const withdrawPrefixExecution =
        await smartAccountsClient.features.execution.prepare.executeTransactionSyncV2(
          {
            feePayer: args.feePayer,
            settingsPda: args.settingsPda,
            accountIndex: EARN_DEPOSIT_VAULT_INDEX,
            numSigners: 1,
            instructions: compiledWithdrawPrefix.instructions,
            instruction_accounts: compiledWithdrawPrefix.accounts,
            memo: args.memo,
          } as never
        );
      const currentVaultUsdcAmountRaw =
        isFinalExit && isFinalBatch
          ? fullWithdrawVaultUsdcRemainderRaw
          : await getTokenAccountAmountOrZero(config.connection, vaultUsdcAta);
      const {
        amountRaw: simulatedVaultUsdcAmountRaw,
        lamportAccountLamports: simulatedVaultLamports,
      } = await simulatePreparedTokenAccountAmount({
        connection: config.connection,
        lamportAccount: isFinalExit && isFinalBatch ? vaultPda : undefined,
        prepared: freezePreparedOperation({
          operation: "earnUsdcWithdrawPrefixSimulation",
          payer: args.feePayer,
          programId: smartAccountsClient.programId,
          requiresConfirmation: false,
          instructions: [
            createAssociatedTokenAccountIdempotentInstruction(
              args.feePayer,
              walletUsdcAta,
              args.walletAddress,
              usdcMint,
              TOKEN_PROGRAM_ID
            ),
            ...withdrawPrefixExecution.instructions,
          ],
          lookupTableAccounts: dedupeLookupTableAccounts(
            withdrawPrefixExecution.lookupTableAccounts ?? []
          ),
        }),
        tokenAccount: vaultUsdcAta,
      });
      // Sweep what the vault will hold AFTER the withdraw prefix runs: klend's
      // v2 full withdraw closes the emptied obligation and refunds its rent
      // (~0.024 SOL) to the vault inside this same transaction, so the
      // simulated post-state is the correct amount — the prepare-time balance
      // is only a fallback. With 3+ reserves the earlier batches' obligation
      // refunds land after this simulation and stay as vault dust for the
      // cleanup flow; the sweep can only undershoot, never overdraw.
      const vaultSweepLamports =
        isFinalExit && isFinalBatch
          ? simulatedVaultLamports ?? fullWithdrawVaultSweepLamports
          : BigInt(0);
      const simulatedRedeemedOnlyAmountRaw = resolveSimulatedRedeemedAmountRaw({
        currentVaultUsdcAmountRaw,
        simulatedVaultUsdcAmountRaw,
      });
      const redeemedTransferAmountRaw =
        simulatedRedeemedOnlyAmountRaw > BigInt(0)
          ? simulatedRedeemedOnlyAmountRaw
          : batchExpectedRedeemedAmountRaw;
      const walletTransferAmountRaw =
        args.mode !== "full"
          ? redeemedTransferAmountRaw
          : isFinalBatch
          ? batchVaultUsdcRemainderRaw + redeemedTransferAmountRaw
          : redeemedTransferAmountRaw;
      const closeableCollateralAtas =
        isFinalExit && isFinalBatch
          ? (
              await Promise.all(
                reserveWithdrawals.map(async (withdrawal) =>
                  (await isTokenAccountOwnedBy({
                    account: withdrawal.collateralAta,
                    connection: config.connection,
                    owner: vaultPda,
                  }))
                    ? withdrawal.collateralAta
                    : null
                )
              )
            ).filter((account): account is PublicKey => account !== null)
          : [];
      const uniqueCloseableCollateralAtas = Array.from(
        new Map(
          closeableCollateralAtas.map((account) => [
            account.toBase58(),
            account,
          ])
        ).values()
      );
      const transferInstruction = makeSignerWritable(
        createTransferCheckedInstruction(
          vaultUsdcAta,
          usdcMint,
          walletUsdcAta,
          vaultPda,
          walletTransferAmountRaw,
          EARN_DEPOSIT_USDC_DECIMALS,
          [],
          TOKEN_PROGRAM_ID
        ),
        vaultPda
      );
      const cleanupInstructions =
        isFinalExit && isFinalBatch
          ? createEarnFullWithdrawCleanupInstructions({
              vaultCollateralAtas: uniqueCloseableCollateralAtas,
              vaultPda,
              vaultSweepLamports,
              vaultUsdcAta,
              walletAddress: args.walletAddress,
            })
          : [];
      const compiledPackedPayload =
        instructionsToSynchronousTransactionDetailsV2({
          vaultPda,
          members: [args.walletAddress],
          transaction_instructions: [
            ...batch.flatMap((withdrawal) => withdrawal.instructions),
            transferInstruction,
            ...cleanupInstructions,
          ],
        });
      const packedExecution =
        await smartAccountsClient.features.execution.prepare.executeTransactionSyncV2(
          {
            feePayer: args.feePayer,
            settingsPda: args.settingsPda,
            accountIndex: EARN_DEPOSIT_VAULT_INDEX,
            numSigners: 1,
            instructions: compiledPackedPayload.instructions,
            instruction_accounts: compiledPackedPayload.accounts,
            memo: args.memo,
          } as never
        );
      const policyCloseOperation =
        isFinalExit && isFinalBatch
          ? await prepareCloseLiveYieldRoutingPoliciesSync({
              settingsPda: args.settingsPda,
              feePayer: args.feePayer,
              signers: [args.walletAddress],
              policies: [
                policyAccount,
                ...(setupPolicyAccount ? [setupPolicyAccount] : []),
              ],
              memo: args.memo,
            })
          : null;
      const operations = [
        packedExecution,
        ...(policyCloseOperation ? [policyCloseOperation] : []),
      ];
      const prepared = freezePreparedOperation({
        operation: "earnUsdcWithdraw",
        payer: args.feePayer,
        programId: smartAccountsClient.programId,
        requiresConfirmation: true,
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(
            args.feePayer,
            walletUsdcAta,
            args.walletAddress,
            usdcMint,
            TOKEN_PROGRAM_ID
          ),
          ...operations.flatMap((operation) => operation.instructions),
        ],
        lookupTableAccounts: dedupeLookupTableAccounts(
          operations.flatMap((operation) => operation.lookupTableAccounts ?? [])
        ),
      });
      const reserveWithdrawalMetadata = batch.map((withdrawal) => ({
        accountingReserve: withdrawal.accountingReserve.reserve.toBase58(),
        collateralAta: withdrawal.collateralAta.toBase58(),
        executionMarket: withdrawal.executionReserve.market.toBase58(),
        executionReserve: withdrawal.executionReserve.reserve.toBase58(),
        kaminoWithdrawAmountRaw: withdrawal.kaminoWithdrawAmountRaw.toString(),
        liquidityMint: withdrawal.accountingReserve.liquidityMint.toBase58(),
        market: withdrawal.accountingReserve.market.toBase58(),
        reserve: withdrawal.accountingReserve.reserve.toBase58(),
        withdrawnAmountRaw: withdrawal.expectedRedeemedAmountRaw.toString(),
      }));
      const mode = args.mode === "full" && isFinalBatch ? "full" : "partial";

      return {
        accountingReserve: firstWithdrawal.accountingReserve,
        amountRaw: batchAmountRaw,
        collateralAta: firstWithdrawal.collateralAta,
        executionReserve: firstWithdrawal.executionReserve,
        mode,
        persistence: {
          cluster,
          walletAddress: args.walletAddress.toBase58(),
          delegatedSigner: args.policySigner.toBase58(),
          settings: args.settingsPda.toBase58(),
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          vaultPubkey: vaultPda.toBase58(),
          policyId: earnPolicy.seed.toString(),
          policyAccount: policyAccount.toBase58(),
          policySeed: earnPolicy.seed.toString(),
          ...(setupPolicyAccount && setupPolicySeed
            ? {
                setupPolicyId: setupPolicySeed.toString(),
                setupPolicyAccount: setupPolicyAccount.toBase58(),
                setupPolicySeed: setupPolicySeed.toString(),
              }
            : {}),
          accountingReserve:
            firstWithdrawal.accountingReserve.reserve.toBase58(),
          executionReserve: firstWithdrawal.executionReserve.reserve.toBase58(),
          targetReserve: firstWithdrawal.accountingReserve.reserve.toBase58(),
          market: firstWithdrawal.accountingReserve.market.toBase58(),
          liquidityMint:
            firstWithdrawal.accountingReserve.liquidityMint.toBase58(),
          withdrawnAmountRaw: walletTransferAmountRaw.toString(),
          mode,
          ...(sourceMetadata ?? {}),
          kaminoWithdrawAmountRaw: batchKaminoWithdrawAmountRaw.toString(),
          reserveWithdrawals: reserveWithdrawalMetadata,
          vaultCollateralCleanupIncluded:
            args.mode === "full" &&
            isFinalBatch &&
            uniqueCloseableCollateralAtas.length > 0,
          vaultUsdcRemainderRaw: batchVaultUsdcRemainderRaw.toString(),
          walletTransferAmountRaw: walletTransferAmountRaw.toString(),
        },
        prepared,
        reserveWithdrawals: reserveWithdrawalMetadata,
        vaultCollateralCleanupIncluded:
          args.mode === "full" &&
          isFinalBatch &&
          uniqueCloseableCollateralAtas.length > 0,
        vaultUsdcRemainderRaw: batchVaultUsdcRemainderRaw,
        walletTransferAmountRaw,
      };
    };

    const provisionalBatches = await Promise.all(
      reserveWithdrawalBatches.map((batch, index) =>
        buildWithdrawBatch(batch, index)
      )
    );
    const withdrawSteps = provisionalBatches.map((step, index) => {
      const isFinalStep = index === provisionalBatches.length - 1;
      return {
        accountingReserve: step.accountingReserve,
        amountRaw: step.amountRaw,
        collateralAta: step.collateralAta,
        executionReserve: step.executionReserve,
        mode: step.mode,
        prepared: step.prepared,
        reserveWithdrawals: step.reserveWithdrawals,
        stepCount: provisionalBatches.length,
        stepIndex: index,
        persistence: {
          ...step.persistence,
          autodepositClose: isFinalStep
            ? autodepositCloseOperation?.persistence ?? null
            : null,
          isFinalStep,
          mode: step.mode,
          stepCount: provisionalBatches.length,
          stepIndex: index,
        },
      };
    });
    const firstWithdrawStep = withdrawSteps[0]!;
    const finalWithdrawStep = withdrawSteps[withdrawSteps.length - 1]!;
    const resolvedVaultCollateralAta = firstWithdrawStep.collateralAta;
    const prepared = firstWithdrawStep.prepared;
    const topLevelAccountingReserve = firstWithdrawStep.accountingReserve;

    return {
      autodepositClosePrepared: autodepositCloseOperation,
      prepared,
      withdrawSteps,
      mode: args.mode,
      amountRaw: args.amountRaw,
      policy: {
        account: policyAccount,
        id: earnPolicy.seed,
        seed: earnPolicy.seed,
        withdrawInstructionConstraintIndex: 0,
        sameMintInstructionConstraintIndexes:
          EARN_SAME_MINT_INSTRUCTION_CONSTRAINT_INDEXES,
      },
      ...(setupPolicyAccount && setupPolicySeed
        ? {
            setupPolicy: {
              account: setupPolicyAccount,
              id: setupPolicySeed,
              seed: setupPolicySeed,
            },
          }
        : {}),
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
        usdcAta: vaultUsdcAta,
        collateralAta: resolvedVaultCollateralAta,
      },
      targetReserve: {
        reserve: topLevelAccountingReserve.reserve,
        market: topLevelAccountingReserve.market,
        liquidityMint: usdcMint,
        obligation: topLevelAccountingReserve.obligation,
      },
      persistence: {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        delegatedSigner: args.policySigner.toBase58(),
        settings: args.settingsPda.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyId: earnPolicy.seed.toString(),
        policyAccount: policyAccount.toBase58(),
        policySeed: earnPolicy.seed.toString(),
        ...(setupPolicyAccount && setupPolicySeed
          ? {
              setupPolicyId: setupPolicySeed.toString(),
              setupPolicyAccount: setupPolicyAccount.toBase58(),
              setupPolicySeed: setupPolicySeed.toString(),
            }
          : {}),
        targetReserve: topLevelAccountingReserve.reserve.toBase58(),
        market: topLevelAccountingReserve.market.toBase58(),
        liquidityMint: usdcMint.toBase58(),
        withdrawnAmountRaw: finalWithdrawStep.persistence.withdrawnAmountRaw,
        mode: args.mode,
        stepCount: withdrawSteps.length,
        ...(sourceMetadata ?? {}),
        kaminoWithdrawAmountRaw:
          finalWithdrawStep.persistence.kaminoWithdrawAmountRaw,
        reserveWithdrawals: finalWithdrawStep.persistence.reserveWithdrawals,
        vaultCollateralCleanupIncluded:
          finalWithdrawStep.persistence.vaultCollateralCleanupIncluded,
        vaultUsdcRemainderRaw:
          finalWithdrawStep.persistence.vaultUsdcRemainderRaw,
        walletTransferAmountRaw:
          finalWithdrawStep.persistence.walletTransferAmountRaw,
        ...(args.mode === "full"
          ? {
              autodepositClose: autodepositCloseOperation?.persistence ?? null,
            }
          : {}),
      },
    };
  }

  async function prepareEarnUsdcCleanup(
    args: SmartAccountEarnUsdcCleanupInput
  ): Promise<SmartAccountPreparedEarnUsdcCleanup> {
    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const usdcMint = getStablecoinMintForCluster(cluster, Stablecoin.USDC);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const idleAmountRaw = args.idleAmountRaw ?? BigInt(0);
    const tokenInstructions: TransactionInstruction[] = [];

    if (idleAmountRaw > BigInt(0)) {
      tokenInstructions.push(
        makeSignerWritable(
          createTransferCheckedInstruction(
            vaultUsdcAta,
            usdcMint,
            walletUsdcAta,
            vaultPda,
            idleAmountRaw,
            EARN_DEPOSIT_USDC_DECIMALS,
            [],
            TOKEN_PROGRAM_ID
          ),
          vaultPda
        )
      );
    }

    const closeableCollateralAtas: PublicKey[] = [];
    for (const collateralAta of args.closeVaultCollateralAtas ?? []) {
      if (
        await isTokenAccountOwnedBy({
          account: collateralAta,
          connection: config.connection,
          owner: vaultPda,
        })
      ) {
        closeableCollateralAtas.push(collateralAta);
      }
    }

    for (const collateralAta of closeableCollateralAtas) {
      tokenInstructions.push(
        makeSignerWritable(
          createCloseAccountInstruction(
            collateralAta,
            args.walletAddress,
            vaultPda,
            [],
            TOKEN_PROGRAM_ID
          ),
          vaultPda
        )
      );
    }

    const shouldCloseVaultUsdcAta = await isTokenAccountOwnedBy({
      account: vaultUsdcAta,
      connection: config.connection,
      owner: vaultPda,
    });
    if (shouldCloseVaultUsdcAta) {
      tokenInstructions.push(
        makeSignerWritable(
          createCloseAccountInstruction(
            vaultUsdcAta,
            args.walletAddress,
            vaultPda,
            [],
            TOKEN_PROGRAM_ID
          ),
          vaultPda
        )
      );
    }

    // Same final-exit refund as the full-withdraw path: return the unspent
    // Kamino setup buffer sitting on the vault PDA (see
    // createEarnFullWithdrawCleanupInstructions for why the obligation and
    // farms rents cannot be reclaimed).
    const vaultSweepLamports = await getVaultSweepLamportsOrZero(
      config.connection,
      vaultPda
    );
    if (vaultSweepLamports > BigInt(0)) {
      tokenInstructions.push(
        SystemProgram.transfer({
          fromPubkey: vaultPda,
          toPubkey: args.walletAddress,
          lamports: vaultSweepLamports,
        })
      );
    }

    const tokenOperation =
      tokenInstructions.length > 0
        ? await (async () => {
            const compiledPackedPayload =
              instructionsToSynchronousTransactionDetailsV2({
                vaultPda,
                members: [args.walletAddress],
                transaction_instructions: tokenInstructions,
              });
            return smartAccountsClient.features.execution.prepare.executeTransactionSyncV2(
              {
                feePayer: args.feePayer,
                settingsPda: args.settingsPda,
                accountIndex: EARN_DEPOSIT_VAULT_INDEX,
                numSigners: 1,
                instructions: compiledPackedPayload.instructions,
                instruction_accounts: compiledPackedPayload.accounts,
                memo: args.memo,
              } as never
            );
          })()
        : null;
    const policyAccounts = [
      args.yieldRoutingPolicy.account,
      ...(args.yieldRoutingPolicy.setupPolicy?.account
        ? [args.yieldRoutingPolicy.setupPolicy.account]
        : []),
    ];
    const policyCloseOperation = await prepareCloseLiveYieldRoutingPoliciesSync(
      {
        settingsPda: args.settingsPda,
        feePayer: args.feePayer,
        signers: [args.walletAddress],
        policies: policyAccounts,
        memo: args.memo,
      }
    );
    const autodepositClosePrepared = args.autodepositClose
      ? await prepareEarnUsdcAutodepositClose({
          cluster,
          feePayer: args.feePayer,
          memo: args.memo,
          policy: args.autodepositClose.policy,
          policySigner: args.policySigner,
          recurringDelegation: args.autodepositClose.recurringDelegation,
          settingsPda: args.settingsPda,
          signer: args.walletAddress,
          walletAddress: args.walletAddress,
        })
      : null;
    const operations = [
      ...(tokenOperation ? [tokenOperation] : []),
      ...(policyCloseOperation ? [policyCloseOperation] : []),
    ];
    if (operations.length === 0) {
      throw new Error(
        "Nothing to clean up: yield routing policies are already closed."
      );
    }
    const prepared = freezePreparedOperation({
      operation: "earnUsdcCleanup",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      requiresConfirmation: true,
      instructions: [
        ...(idleAmountRaw > BigInt(0)
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                args.feePayer,
                walletUsdcAta,
                args.walletAddress,
                usdcMint,
                TOKEN_PROGRAM_ID
              ),
            ]
          : []),
        ...operations.flatMap((operation) => operation.instructions),
      ],
      lookupTableAccounts: dedupeLookupTableAccounts(
        operations.flatMap((operation) => operation.lookupTableAccounts ?? [])
      ),
    });
    const setupPolicy = args.yieldRoutingPolicy.setupPolicy ?? null;

    return {
      autodepositClosePrepared,
      prepared,
      persistence: {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        delegatedSigner: args.policySigner.toBase58(),
        settings: args.settingsPda.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyId: args.yieldRoutingPolicy.seed.toString(),
        policyAccount: args.yieldRoutingPolicy.account.toBase58(),
        policySeed: args.yieldRoutingPolicy.seed.toString(),
        ...(setupPolicy
          ? {
              setupPolicyId: setupPolicy.seed.toString(),
              setupPolicyAccount: setupPolicy.account.toBase58(),
              setupPolicySeed: setupPolicy.seed.toString(),
            }
          : {}),
        idleTransferAmountRaw: idleAmountRaw.toString(),
        closedVaultUsdcAta: shouldCloseVaultUsdcAta,
        closedCollateralAtas: closeableCollateralAtas.map((account) =>
          account.toBase58()
        ),
        autodepositClose: autodepositClosePrepared?.persistence ?? null,
      },
      policy: {
        account: args.yieldRoutingPolicy.account,
        id: args.yieldRoutingPolicy.seed,
        seed: args.yieldRoutingPolicy.seed,
      },
      ...(setupPolicy
        ? {
            setupPolicy: {
              account: setupPolicy.account,
              id: setupPolicy.seed,
              seed: setupPolicy.seed,
            },
          }
        : {}),
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
        usdcAta: vaultUsdcAta,
      },
    };
  }

  // Chain-first inventory of everything refundable on the Earn vault itself:
  // the vault PDA's SOL and the rent locked in its token accounts. The
  // policy-refund scan uses this to surface "account" refunds for wallets
  // whose Earn position is closed — route-policy DB rows may be long gone, so
  // nothing here reads a database. Feature-checked like the other vault reads:
  // injected connections without the RPC methods just report an empty vault.
  async function fetchEarnVaultRefundSnapshot(args: {
    cluster?: LoyalCluster;
    settingsPda: PublicKey;
  }): Promise<SmartAccountEarnVaultRefundSnapshot> {
    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const usdcMint = getStablecoinMintForCluster(cluster, Stablecoin.USDC);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );

    const getTokenAccountsByOwner = (
      config.connection as {
        getTokenAccountsByOwner?: Connection["getTokenAccountsByOwner"];
      }
    ).getTokenAccountsByOwner;
    const [lamports, tokenAccountsResponse] = await Promise.all([
      getVaultSweepLamportsOrZero(config.connection, vaultPda),
      typeof getTokenAccountsByOwner === "function"
        ? getTokenAccountsByOwner.call(
            config.connection,
            vaultPda,
            { programId: TOKEN_PROGRAM_ID },
            "confirmed"
          )
        : Promise.resolve(null),
    ]);

    const tokenAccounts = (tokenAccountsResponse?.value ?? [])
      .map(({ account, pubkey }) => {
        const decoded = AccountLayout.decode(account.data);
        const mint = new PublicKey(decoded.mint);
        return {
          address: pubkey,
          amountRaw: BigInt(decoded.amount.toString()),
          isUsdc: mint.equals(usdcMint),
          lamports: account.lamports,
          mint,
        };
      })
      .sort((left, right) =>
        left.address.toBase58().localeCompare(right.address.toBase58())
      );

    return { lamports, tokenAccounts, vaultPda, vaultUsdcAta };
  }

  // Refund the rent still parked on the Earn vault after the position is
  // closed: withdraw any idle USDC to the wallet, close the vault's token
  // accounts (USDC ATA + stale collateral ATAs), and sweep the vault PDA's
  // SOL. This is the token-side of `prepareEarnUsdcCleanup` without the
  // policy-close half, for wallets whose routing-policy rows are already
  // closed or missing. Refuses to run while any non-USDC token account holds
  // a balance (a live on-chain position) — unwinding that is the withdraw
  // flow's job, never a refund's.
  async function prepareEarnVaultAccountsRefund(
    args: SmartAccountEarnVaultRefundInput
  ): Promise<SmartAccountPreparedEarnVaultRefund> {
    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const usdcMint = getStablecoinMintForCluster(cluster, Stablecoin.USDC);
    const snapshot = await fetchEarnVaultRefundSnapshot({
      cluster,
      settingsPda: args.settingsPda,
    });
    const vaultPda = snapshot.vaultPda;
    const vaultUsdcAta = snapshot.vaultUsdcAta;
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );

    const blockedTokenAccounts = snapshot.tokenAccounts.filter(
      (tokenAccount) =>
        tokenAccount.amountRaw > BigInt(0) &&
        !tokenAccount.address.equals(vaultUsdcAta)
    );
    if (blockedTokenAccounts.length > 0) {
      throw new Error(
        "Earn vault still holds token balances outside its USDC account; withdraw the position before refunding vault accounts."
      );
    }

    const idleUsdcAccount = snapshot.tokenAccounts.find((tokenAccount) =>
      tokenAccount.address.equals(vaultUsdcAta)
    );
    const idleAmountRaw = idleUsdcAccount?.amountRaw ?? BigInt(0);
    const instructions: TransactionInstruction[] = [];

    if (idleAmountRaw > BigInt(0)) {
      instructions.push(
        makeSignerWritable(
          createTransferCheckedInstruction(
            vaultUsdcAta,
            usdcMint,
            walletUsdcAta,
            vaultPda,
            idleAmountRaw,
            EARN_DEPOSIT_USDC_DECIMALS,
            [],
            TOKEN_PROGRAM_ID
          ),
          vaultPda
        )
      );
    }

    const closedTokenAccounts: PublicKey[] = [];
    for (const tokenAccount of snapshot.tokenAccounts) {
      instructions.push(
        makeSignerWritable(
          createCloseAccountInstruction(
            tokenAccount.address,
            args.walletAddress,
            vaultPda,
            [],
            TOKEN_PROGRAM_ID
          ),
          vaultPda
        )
      );
      closedTokenAccounts.push(tokenAccount.address);
    }

    const sweepLamports = snapshot.lamports;
    if (sweepLamports > BigInt(0)) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: vaultPda,
          toPubkey: args.walletAddress,
          lamports: sweepLamports,
        })
      );
    }

    if (instructions.length === 0) {
      throw new Error(
        "Nothing to refund: the Earn vault holds no SOL and no token accounts."
      );
    }

    const compiledPackedPayload = instructionsToSynchronousTransactionDetailsV2(
      {
        vaultPda,
        members: [args.walletAddress],
        transaction_instructions: instructions,
      }
    );
    const operation =
      await smartAccountsClient.features.execution.prepare.executeTransactionSyncV2(
        {
          feePayer: args.feePayer,
          settingsPda: args.settingsPda,
          accountIndex: EARN_DEPOSIT_VAULT_INDEX,
          numSigners: 1,
          instructions: compiledPackedPayload.instructions,
          instruction_accounts: compiledPackedPayload.accounts,
          memo: args.memo,
        } as never
      );
    const prepared = freezePreparedOperation({
      operation: "earnVaultAccountsRefund",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      requiresConfirmation: true,
      instructions: [
        ...(idleAmountRaw > BigInt(0)
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                args.feePayer,
                walletUsdcAta,
                args.walletAddress,
                usdcMint,
                TOKEN_PROGRAM_ID
              ),
            ]
          : []),
        ...operation.instructions,
      ],
      lookupTableAccounts: operation.lookupTableAccounts ?? [],
    });

    return {
      prepared,
      refund: {
        closedTokenAccounts,
        idleUsdcTransferRaw: idleAmountRaw,
        sweepLamports,
      },
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
        usdcAta: vaultUsdcAta,
      },
    };
  }

  async function assertEarnUsdcAutodepositCanonicalArtifacts(
    args: SmartAccountEarnUsdcAutodepositCanonicalArtifactsInput
  ): Promise<void> {
    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const amountRaw = normalizeAutodepositU64(args.amountRaw, "amountRaw");
    const nonce = normalizeAutodepositU64(args.nonce, "nonce");
    if (
      args.policySeed <= BigInt(0) ||
      args.policySeed > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error(
        "Autodeposit policy seed is outside the supported range."
      );
    }

    const usdcMint = getStablecoinMintForCluster(cluster, Stablecoin.USDC);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const expectedPolicy = pda.getPolicyPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      policySeed: Number(args.policySeed),
    })[0];
    if (!args.policy.equals(expectedPolicy)) {
      throw new Error("Autodeposit policy account does not match its seed.");
    }

    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const requirePolicy = args.requirePolicy ?? true;
    if (requirePolicy) {
      const policy = await smartAccountsClient.policies.queries.fetchPolicy(
        args.policy
      );

      if (!policy.settings.equals(args.settingsPda)) {
        throw new Error("Autodeposit policy settings do not match.");
      }
      if (toBigInt(policy.seed) !== args.policySeed) {
        throw new Error("Autodeposit policy seed does not match.");
      }
      if (policy.threshold !== 1) {
        throw new Error("Autodeposit policy threshold is not canonical.");
      }
      if (policy.timeLock !== 0) {
        throw new Error("Autodeposit policy timelock is not canonical.");
      }
      if (policy.signers.length !== 1) {
        throw new Error("Autodeposit policy signer set is not canonical.");
      }

      const [policySigner] = policy.signers;
      if (!policySigner?.key.equals(args.policySigner)) {
        throw new Error("Autodeposit policy signer does not match.");
      }
      for (const permission of [
        Permission.Initiate,
        Permission.Vote,
        Permission.Execute,
      ]) {
        if (!Permissions.has(policySigner.permissions, permission)) {
          throw new Error(
            "Autodeposit policy signer permissions are incomplete."
          );
        }
      }

      const expectedPolicyState = policyCreationPayloadToState(
        createSubscriptionSweepProgramInteractionPolicyCreationPayload({
          delegator: args.walletAddress,
          maxAmountPerPeriodRaw: amountRaw,
          minimumDelegatorBalanceRaw: undefined,
          mint: usdcMint,
          vaultPda,
          vaultUsdcAta,
          walletUsdcAta,
        })
      );
      if (!generatedValuesEqual(policy.policyState, expectedPolicyState)) {
        throw new Error("Autodeposit policy state is not canonical.");
      }
    }

    if (args.requireRecurringDelegation === false) {
      return;
    }

    const subscriptionAuthority = deriveSubscriptionAuthority(
      args.walletAddress,
      usdcMint
    );
    const expectedRecurringDelegation = deriveRecurringDelegation(
      subscriptionAuthority,
      args.walletAddress,
      vaultPda,
      nonce
    );
    if (!args.recurringDelegation.equals(expectedRecurringDelegation)) {
      throw new Error(
        "Autodeposit recurring delegation account does not match its nonce."
      );
    }

    const recurringDelegationAccount = await config.connection.getAccountInfo(
      args.recurringDelegation,
      "confirmed"
    );
    if (!recurringDelegationAccount) {
      throw new Error(
        "Autodeposit recurring delegation account does not exist."
      );
    }
    if (!recurringDelegationAccount.owner.equals(SUBSCRIPTIONS_PROGRAM_ID)) {
      throw new Error("Autodeposit recurring delegation owner is invalid.");
    }
    if (
      recurringDelegationAccount.data.length <
      SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN
    ) {
      throw new Error("Autodeposit recurring delegation data is incomplete.");
    }
    if (
      recurringDelegationAccount.data[
        SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET
      ] !== SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR
    ) {
      throw new Error(
        "Autodeposit recurring delegation discriminator is invalid."
      );
    }

    const recurringDelegationData = recurringDelegationAccount.data;
    const recurringDelegationChecks: [string, PublicKey, PublicKey][] = [
      [
        "delegator",
        readPublicKey(
          recurringDelegationData,
          SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET
        ),
        args.walletAddress,
      ],
      [
        "delegatee",
        readPublicKey(
          recurringDelegationData,
          SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET
        ),
        vaultPda,
      ],
      [
        "authority",
        readPublicKey(
          recurringDelegationData,
          SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET
        ),
        subscriptionAuthority,
      ],
      [
        "mint",
        readPublicKey(
          recurringDelegationData,
          SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET
        ),
        usdcMint,
      ],
    ];

    for (const [label, actual, expected] of recurringDelegationChecks) {
      if (!actual.equals(expected)) {
        throw new Error(
          `Autodeposit recurring delegation ${label} does not match.`
        );
      }
    }

    const amountPerPeriodRaw = readUint64LE(
      recurringDelegationData,
      SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET
    );
    if (amountPerPeriodRaw !== amountRaw) {
      throw new Error(
        "Autodeposit recurring delegation amount does not match."
      );
    }
  }

  const EARN_AUTODEPOSIT_SETUP_ACCOUNT_EVIDENCE_TTL_MS = 5 * 60 * 1000;

  type EarnAutodepositSetupAccountState = {
    delegationAccount: AccountInfo<Buffer> | null;
    policyAccountExists: boolean;
    vaultUsdcAtaExists: boolean | undefined;
  };

  function isFreshAutodepositSetupAccountEvidence(
    evidence: SmartAccountEarnUsdcAutodepositSetupAccountEvidence | undefined
  ): evidence is SmartAccountEarnUsdcAutodepositSetupAccountEvidence {
    return (
      evidence !== undefined &&
      Number.isFinite(evidence.observedAtMs) &&
      evidence.observedAtMs <= Date.now() &&
      Date.now() - evidence.observedAtMs <=
        EARN_AUTODEPOSIT_SETUP_ACCOUNT_EVIDENCE_TTL_MS
    );
  }

  async function prepareEarnUsdcAutodepositSetupStage(
    args: SmartAccountEarnUsdcAutodepositSetupInput,
    options: {
      accountEvidence?: SmartAccountEarnUsdcAutodepositSetupAccountEvidence;
      assumePolicyExists?: boolean;
    } = {}
  ): Promise<SmartAccountPreparedEarnUsdcAutodepositSetup> {
    if (args.amountRaw <= BigInt(0)) {
      throw new Error("Autodeposit amount must be greater than 0.");
    }

    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const usdcMint = getStablecoinMintForCluster(cluster, Stablecoin.USDC);
    const amountPerPeriodRaw = normalizeAutodepositU64(
      args.amountRaw,
      "amountRaw"
    );
    const minimumDelegatorBalanceRaw =
      args.minimumDelegatorBalanceRaw === undefined
        ? undefined
        : normalizeAutodepositU64(
            args.minimumDelegatorBalanceRaw,
            "minimumDelegatorBalanceRaw"
          );
    const periodLengthSeconds = normalizeAutodepositU64(
      args.periodLengthSeconds ?? BigInt(30 * 24 * 60 * 60),
      "periodLengthSeconds"
    );
    const nonce = normalizeAutodepositU64(
      args.nonce ?? BigInt(Math.floor(Date.now() / 1000)),
      "nonce"
    );
    const expiryTimestamp = args.expiryTimestamp ?? BigInt(0);
    const startTimestamp = resolveEarnAutodepositStartTimestamp({
      expiryTimestamp,
      startTimestamp: args.startTimestamp,
    });
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const subscriptionAuthority = deriveSubscriptionAuthority(
      args.walletAddress,
      usdcMint
    );
    const recurringDelegation = deriveRecurringDelegation(
      subscriptionAuthority,
      args.walletAddress,
      vaultPda,
      nonce
    );
    const basePersistence = {
      cluster,
      walletAddress: args.walletAddress.toBase58(),
      delegatedSigner: args.policySigner.toBase58(),
      settings: args.settingsPda.toBase58(),
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: vaultPda.toBase58(),
      subscriptionDelegatee: vaultPda.toBase58(),
      amountPerPeriodRaw: amountPerPeriodRaw.toString(),
      minimumDelegatorBalanceRaw:
        minimumDelegatorBalanceRaw?.toString() ?? null,
      periodLengthSeconds: periodLengthSeconds.toString(),
      nonce: nonce.toString(),
      startTimestamp: startTimestamp.toString(),
      expiryTimestamp: expiryTimestamp.toString(),
      liquidityMint: usdcMint.toBase58(),
      subscriptionAuthority: subscriptionAuthority.toBase58(),
      recurringDelegation: recurringDelegation.toBase58(),
      walletUsdcAta: walletUsdcAta.toBase58(),
      vaultUsdcAta: vaultUsdcAta.toBase58(),
    } as const;
    const requestedPolicySeed =
      args.policySeed !== undefined
        ? normalizeAutodepositU64(args.policySeed, "policySeed")
        : undefined;
    const resolvePolicyAccount = (seed: bigint) => {
      const seedNumber = Number(seed);
      if (!Number.isSafeInteger(seedNumber)) {
        throw new Error(
          "Autodeposit policy seed exceeds JavaScript safe integer range."
        );
      }

      return pda.getPolicyPda({
        programId: smartAccountsClient.programId,
        settingsPda: args.settingsPda,
        policySeed: seedNumber,
      })[0];
    };
    let policySeed = requestedPolicySeed ?? BigInt(1);
    let policyAccount = resolvePolicyAccount(policySeed);
    const accountEvidence = isFreshAutodepositSetupAccountEvidence(
      options.accountEvidence
    )
      ? options.accountEvidence
      : undefined;
    const subscriptionAuthorityAddress = subscriptionAuthority.toBase58();
    const recurringDelegationAddress = recurringDelegation.toBase58();
    const vaultUsdcAtaAddress = vaultUsdcAta.toBase58();
    const baseEvidenceMatches =
      accountEvidence?.subscriptionAuthority === subscriptionAuthorityAddress &&
      accountEvidence.recurringDelegation === recurringDelegationAddress &&
      accountEvidence.vaultUsdcAta === vaultUsdcAtaAddress;
    const createAccountEvidence = (input: {
      policyAccount: PublicKey | null;
      policyExists?: boolean;
      policySeed: bigint | null;
      recurringDelegationExists?: boolean;
      subscriptionAuthorityExists?: boolean;
      subscriptionAuthorityInitId?: bigint | null;
      subscriptionAuthorityOwnerVerified?: boolean;
      vaultUsdcAtaExists?: boolean;
    }): SmartAccountEarnUsdcAutodepositSetupAccountEvidence => ({
      observedAtMs: Date.now(),
      policyAccount: input.policyAccount?.toBase58() ?? null,
      policyExists: input.policyExists,
      policySeed: input.policySeed?.toString() ?? null,
      recurringDelegation: recurringDelegationAddress,
      recurringDelegationExists: input.recurringDelegationExists,
      subscriptionAuthority: subscriptionAuthorityAddress,
      subscriptionAuthorityExists: input.subscriptionAuthorityExists,
      subscriptionAuthorityInitId:
        input.subscriptionAuthorityInitId?.toString() ?? null,
      subscriptionAuthorityOwnerVerified:
        input.subscriptionAuthorityOwnerVerified,
      vaultUsdcAta: vaultUsdcAtaAddress,
      vaultUsdcAtaExists: input.vaultUsdcAtaExists,
    });
    let authorityAccount: AccountInfo<Buffer> | null = null;
    let expectedSubscriptionAuthorityInitId: bigint | null = null;

    if (
      accountEvidence !== undefined &&
      baseEvidenceMatches &&
      accountEvidence.subscriptionAuthorityExists === true &&
      accountEvidence.subscriptionAuthorityOwnerVerified === true &&
      accountEvidence.subscriptionAuthorityInitId !== null &&
      accountEvidence.subscriptionAuthorityInitId !== undefined
    ) {
      try {
        expectedSubscriptionAuthorityInitId = BigInt(
          accountEvidence.subscriptionAuthorityInitId
        );
      } catch {
        expectedSubscriptionAuthorityInitId = null;
      }
    }

    if (expectedSubscriptionAuthorityInitId === null) {
      authorityAccount = await config.connection.getAccountInfo(
        subscriptionAuthority,
        "confirmed"
      );
    }
    // A close revokes the wallet USDC ATA's SPL delegate; an authority account
    // that survives with a missing/foreign delegate can't sweep, so re-run
    // InitAuthority — the program re-approves the delegate and bumps its init
    // id (delegations pin the previous id, so stale ones stay dead).
    let authorityDelegateMissing = false;
    if (authorityAccount && expectedSubscriptionAuthorityInitId === null) {
      const walletUsdcAtaInfo = await config.connection.getAccountInfo(
        walletUsdcAta,
        "confirmed"
      );
      if (
        walletUsdcAtaInfo &&
        walletUsdcAtaInfo.data.length >= AccountLayout.span
      ) {
        const decoded = AccountLayout.decode(walletUsdcAtaInfo.data);
        authorityDelegateMissing =
          decoded.delegateOption !== 1 ||
          !new PublicKey(decoded.delegate).equals(subscriptionAuthority);
      }
    }
    if (
      (!authorityAccount || authorityDelegateMissing) &&
      expectedSubscriptionAuthorityInitId === null
    ) {
      const prepared = freezePreparedOperation({
        operation: "earnUsdcAutodepositInitializeSubscriptionAuthority",
        payer: args.feePayer,
        programId: SUBSCRIPTIONS_PROGRAM_ID,
        requiresConfirmation: true,
        instructions: [
          createSubscriptionInitAuthorityInstruction({
            owner: args.walletAddress,
            subscriptionAuthority,
            tokenMint: usdcMint,
            userAta: walletUsdcAta,
          }),
        ],
        lookupTableAccounts: [],
      });
      const nativeSolRequirement = await estimateNativeSolRequirement({
        checkBalance: false,
        cluster,
        connection: config.connection,
        estimateFees: false,
        payer: args.feePayer,
        preferStaticMainnetRent: true,
        prepared: [prepared],
        rentCandidates: [
          {
            account: subscriptionAuthority,
            // Re-init on an existing authority (delegate re-approve) pays no
            // rent; only a first-time init creates the account.
            exists: authorityAccount !== null,
            kind: "subscription_authority_rent",
            label: "Autodeposit subscription authority rent",
            space: SUBSCRIPTION_AUTHORITY_DATA_LEN,
            stage: "initialize_subscription_authority",
          },
        ],
      });

      return {
        prepared,
        nativeSolRequirement,
        stage: "initialize_subscription_authority",
        accountEvidence: createAccountEvidence({
          policyAccount,
          policySeed,
          subscriptionAuthorityExists: false,
          subscriptionAuthorityInitId: null,
          subscriptionAuthorityOwnerVerified: false,
        }),
        authorityInitializationRequired: true,
        policy: {
          account: policyAccount,
          id: policySeed,
          seed: policySeed,
        },
        vault: {
          accountIndex: EARN_DEPOSIT_VAULT_INDEX,
          pubkey: vaultPda,
          usdcAta: vaultUsdcAta,
        },
        subscription: {
          authority: subscriptionAuthority,
          recurringDelegation,
          amountPerPeriodRaw,
          periodLengthSeconds,
          nonce,
          startTimestamp,
          expiryTimestamp,
        },
        persistence: {
          ...basePersistence,
          policyId: policySeed.toString(),
          policyAccount: policyAccount.toBase58(),
          policySeed: policySeed.toString(),
          subscriptionAuthorityInitialization: "required",
        },
      };
    }

    let nextPolicySeed: bigint | null = null;
    if (!(options.assumePolicyExists && requestedPolicySeed !== undefined)) {
      const settings =
        await smartAccountsClient.smartAccounts.queries.fetchSettings(
          args.settingsPda
        );
      nextPolicySeed = resolveNextPolicySeed(settings).bigint;
      policySeed = requestedPolicySeed ?? nextPolicySeed;
      policyAccount = resolvePolicyAccount(policySeed);
    }

    const readSetupAccountState =
      async (): Promise<EarnAutodepositSetupAccountState> => {
        const policyAccountAddress = policyAccount.toBase58();
        const policyEvidenceMatches =
          accountEvidence !== undefined &&
          baseEvidenceMatches &&
          accountEvidence.policyAccount === policyAccountAddress &&
          accountEvidence.policySeed === policySeed.toString();
        if (
          accountEvidence !== undefined &&
          policyEvidenceMatches &&
          accountEvidence.recurringDelegationExists === false &&
          accountEvidence.vaultUsdcAtaExists !== undefined &&
          (options.assumePolicyExists ||
            accountEvidence.policyExists !== undefined)
        ) {
          return {
            delegationAccount: null,
            policyAccountExists:
              options.assumePolicyExists ||
              accountEvidence.policyExists === true,
            vaultUsdcAtaExists: accountEvidence.vaultUsdcAtaExists,
          };
        }

        const accountInfos = await getAccountInfoMap({
          accounts: [policyAccount, recurringDelegation, vaultUsdcAta],
          connection: config.connection,
        });

        return {
          delegationAccount:
            accountInfos.get(recurringDelegationAddress) ?? null,
          policyAccountExists: Boolean(
            accountInfos.get(policyAccountAddress)
          ),
          vaultUsdcAtaExists: Boolean(accountInfos.get(vaultUsdcAtaAddress)),
        };
      };

    let accountState = await readSetupAccountState();
    if (
      !options.assumePolicyExists &&
      requestedPolicySeed !== undefined &&
      !accountState.policyAccountExists &&
      nextPolicySeed !== null &&
      requestedPolicySeed !== nextPolicySeed
    ) {
      policySeed = nextPolicySeed;
      policyAccount = resolvePolicyAccount(policySeed);
      accountState = await readSetupAccountState();
    }

    if (
      authorityAccount &&
      !authorityAccount.owner.equals(SUBSCRIPTIONS_PROGRAM_ID)
    ) {
      throw new Error(
        "Subscription authority is owned by an unexpected program."
      );
    }

    expectedSubscriptionAuthorityInitId ??=
      authorityAccount === null
        ? null
        : readSubscriptionAuthorityInitId(authorityAccount);
    if (expectedSubscriptionAuthorityInitId === null) {
      throw new Error("Subscription authority init id is unavailable.");
    }
    const policyExistsForPlanning =
      options.assumePolicyExists || accountState.policyAccountExists;

    if (accountState.delegationAccount) {
      if (
        !accountState.delegationAccount.owner.equals(SUBSCRIPTIONS_PROGRAM_ID)
      ) {
        throw new Error(
          "Recurring delegation is owned by an unexpected program."
        );
      }
      if (policyExistsForPlanning) {
        throw new Error(
          "Autodeposit policy and recurring delegation already exist."
        );
      }
    }

    const createDelegationInstruction =
      createSubscriptionCreateRecurringDelegationInstruction({
        amountPerPeriodRaw,
        delegation: recurringDelegation,
        delegatee: vaultPda,
        delegator: args.walletAddress,
        expectedSubscriptionAuthorityInitId,
        expiryTimestamp,
        nonce,
        periodLengthSeconds,
        startTimestamp,
        subscriptionAuthority,
      });
    const autodepositPolicyPayload =
      createSubscriptionSweepProgramInteractionPolicyCreationPayload({
        delegator: args.walletAddress,
        maxAmountPerPeriodRaw: amountPerPeriodRaw,
        // The keep-in-wallet floor is mutable app/orchestrator config. Do not
        // bake it into the immutable policy; post-setup floor edits are DB-only.
        minimumDelegatorBalanceRaw: undefined,
        mint: usdcMint,
        vaultPda,
        vaultUsdcAta,
        walletUsdcAta,
      });
    const policyCreation = policyExistsForPlanning
      ? null
      : await smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
          {
            feePayer: args.feePayer,
            settingsPda: args.settingsPda,
            signers: [args.signer],
            actions: [
              {
                __kind: "PolicyCreate",
                seed: toBn(policySeed),
                policyCreationPayload: autodepositPolicyPayload,
                signers: [createPolicySigner(args.policySigner)],
                threshold: 1,
                timeLock: 0,
                startTimestamp: null,
                expirationArgs: null,
              },
            ],
            memo: args.memo,
            remainingAccounts: [
              { pubkey: policyAccount, isWritable: true, isSigner: false },
            ],
          } as never
        );
    if (policyCreation) {
      const prepared = withEarnPolicyCreateSimulationDiagnostics(
        freezePreparedOperation({
          operation: "earnUsdcAutodepositCreatePolicy",
          payer: args.feePayer,
          programId: smartAccountsClient.programId,
          requiresConfirmation: true,
          instructions: [...policyCreation.instructions],
          lookupTableAccounts: dedupeLookupTableAccounts(
            policyCreation.lookupTableAccounts ?? []
          ),
        }),
        {
          policyAccount,
          policySeed,
          policyStage: "autodeposit",
          programId: smartAccountsClient.programId,
          settingsPda: args.settingsPda,
        }
      );
      const preparedLength = preparedPacketLength(prepared);
      if (
        preparedLength === null ||
        preparedLength > EARN_POLICY_PACKET_DATA_SIZE
      ) {
        throw new Error(
          "Earn Autodeposit policy setup exceeds the Solana transaction size limit."
        );
      }
      const nativeSolRequirement = await estimateNativeSolRequirement({
        checkBalance: false,
        cluster,
        connection: config.connection,
        estimateFees: false,
        payer: args.feePayer,
        preferStaticMainnetRent: true,
        prepared: [prepared],
        rentCandidates: [
          {
            account: policyAccount,
            exists: false,
            kind: "policy_rent",
            label: "Autodeposit policy account rent",
            space: policyRentSpace({
              feePayer: args.feePayer,
              policyPayload: autodepositPolicyPayload,
              policySeed,
              policySigner: args.policySigner,
              programId: smartAccountsClient.programId,
              settingsPda: args.settingsPda,
            }),
            stage: "create_policy",
          },
        ],
      });

      return {
        prepared,
        nativeSolRequirement,
        stage: "create_policy",
        accountEvidence: createAccountEvidence({
          policyAccount,
          policyExists: false,
          policySeed,
          recurringDelegationExists: Boolean(accountState.delegationAccount),
          subscriptionAuthorityExists: true,
          subscriptionAuthorityInitId: expectedSubscriptionAuthorityInitId,
          subscriptionAuthorityOwnerVerified: true,
          vaultUsdcAtaExists: accountState.vaultUsdcAtaExists,
        }),
        authorityInitializationRequired: false,
        policy: {
          account: policyAccount,
          id: policySeed,
          seed: policySeed,
        },
        vault: {
          accountIndex: EARN_DEPOSIT_VAULT_INDEX,
          pubkey: vaultPda,
          usdcAta: vaultUsdcAta,
        },
        subscription: {
          authority: subscriptionAuthority,
          recurringDelegation,
          amountPerPeriodRaw,
          periodLengthSeconds,
          nonce,
          startTimestamp,
          expiryTimestamp,
        },
        persistence: {
          ...basePersistence,
          policyId: policySeed.toString(),
          policyAccount: policyAccount.toBase58(),
          policySeed: policySeed.toString(),
          subscriptionAuthorityInitialization: "exists",
        },
      };
    }

    const prepared = freezePreparedOperation({
      operation: "earnUsdcAutodepositCreateRecurringDelegation",
      payer: args.feePayer,
      programId: SUBSCRIPTIONS_PROGRAM_ID,
      requiresConfirmation: true,
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          args.feePayer,
          vaultUsdcAta,
          vaultPda,
          usdcMint,
          TOKEN_PROGRAM_ID
        ),
        createDelegationInstruction,
      ],
      lookupTableAccounts: [],
    });
    const nativeSolRequirement = await estimateNativeSolRequirement({
      checkBalance: false,
      cluster,
      connection: config.connection,
      estimateFees: false,
      payer: args.feePayer,
      preferStaticMainnetRent: true,
      prepared: [prepared],
      rentCandidates: [
        {
          account: recurringDelegation,
          exists: false,
          kind: "recurring_delegation_rent",
          label: "Autodeposit recurring delegation rent",
          space: SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN,
          stage: "create_recurring_delegation",
        },
        {
          account: vaultUsdcAta,
          exists: accountState.vaultUsdcAtaExists,
          kind: "token_account_rent",
          label: "Earn vault USDC token account rent",
          space: AccountLayout.span,
          stage: "create_recurring_delegation",
        },
      ],
    });

    return {
      prepared,
      nativeSolRequirement,
      stage: "create_recurring_delegation",
      accountEvidence: createAccountEvidence({
        policyAccount,
        policyExists: true,
        policySeed,
        recurringDelegationExists: false,
        subscriptionAuthorityExists: true,
        subscriptionAuthorityInitId: expectedSubscriptionAuthorityInitId,
        subscriptionAuthorityOwnerVerified: true,
        vaultUsdcAtaExists: accountState.vaultUsdcAtaExists,
      }),
      authorityInitializationRequired: false,
      policy: {
        account: policyAccount,
        id: policySeed,
        seed: policySeed,
      },
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
        usdcAta: vaultUsdcAta,
      },
      subscription: {
        authority: subscriptionAuthority,
        recurringDelegation,
        amountPerPeriodRaw,
        periodLengthSeconds,
        nonce,
        startTimestamp,
        expiryTimestamp,
      },
      persistence: {
        ...basePersistence,
        policyId: policySeed.toString(),
        policyAccount: policyAccount.toBase58(),
        policySeed: policySeed.toString(),
        subscriptionAuthorityInitialization: "exists",
      },
    };
  }

  async function prepareEarnUsdcAutodepositSetup(
    args: SmartAccountEarnUsdcAutodepositSetupInput
  ): Promise<SmartAccountPreparedEarnUsdcAutodepositSetup> {
    return prepareEarnUsdcAutodepositSetupStage(args);
  }

  async function prepareEarnUsdcAutodepositSetupBatchFromPrepared(
    args: SmartAccountEarnUsdcAutodepositSetupInput & {
      preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
      refreshImmediateStartTimestamp?: boolean;
    }
  ): Promise<SmartAccountPreparedEarnUsdcAutodepositSetup[]> {
    const firstSetup = args.preparedSetup;
    if (firstSetup.stage !== "create_policy") {
      return [firstSetup];
    }

    const recurringDelegationSetup = await prepareEarnUsdcAutodepositSetupStage(
      {
        ...args,
        expiryTimestamp: firstSetup.subscription.expiryTimestamp,
        nonce: firstSetup.subscription.nonce,
        periodLengthSeconds: firstSetup.subscription.periodLengthSeconds,
        policySeed: firstSetup.policy.seed ?? args.policySeed,
        startTimestamp: resolveEarnAutodepositBatchStartTimestamp(args),
      },
      {
        accountEvidence: firstSetup.accountEvidence,
        assumePolicyExists: true,
      }
    );
    if (recurringDelegationSetup.stage !== "create_recurring_delegation") {
      return [firstSetup];
    }

    return [firstSetup, recurringDelegationSetup];
  }

  async function prepareEarnUsdcAutodepositSetupBatch(
    args: SmartAccountEarnUsdcAutodepositSetupInput
  ): Promise<SmartAccountPreparedEarnUsdcAutodepositSetup[]> {
    const firstSetup = await prepareEarnUsdcAutodepositSetupStage(args);
    return prepareEarnUsdcAutodepositSetupBatchFromPrepared({
      ...args,
      preparedSetup: firstSetup,
    });
  }

  async function prepareEarnUsdcAutodepositClose(
    args: SmartAccountEarnUsdcAutodepositCloseInput
  ): Promise<SmartAccountPreparedEarnUsdcAutodepositClose> {
    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0];
    const closePolicy = await prepareClosePoliciesSync({
      settingsPda: args.settingsPda,
      feePayer: args.feePayer,
      signers: [args.signer],
      policies: [args.policy],
      memo: args.memo,
    });
    // A setup abandoned before its final stage leaves the policy on-chain with
    // the recurring delegation never created; revoking the missing delegation
    // fails simulation ("invalid account owner") and strands the close. Only
    // revoke a delegation that actually exists.
    const delegationAccount = await config.connection.getAccountInfo(
      args.recurringDelegation
    );
    // The subscription program's RevokeDelegation only closes the delegation
    // account — the unlimited SPL delegate that InitAuthority approved on the
    // wallet's USDC ATA stays behind and shows up as a lingering token
    // approval in wallet UIs. Revoke it in the same tx (the wallet signs the
    // close anyway), but only when the delegate is still our subscription
    // authority so a foreign approval is never clobbered. Setup re-approves
    // via InitAuthority re-init when the delegate is missing.
    const usdcMint = getStablecoinMintForCluster(cluster, Stablecoin.USDC);
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const subscriptionAuthority = deriveSubscriptionAuthority(
      args.walletAddress,
      usdcMint
    );
    const walletUsdcAtaInfo = await config.connection.getAccountInfo(
      walletUsdcAta
    );
    let revokeTokenDelegate = false;
    if (
      walletUsdcAtaInfo &&
      walletUsdcAtaInfo.data.length >= AccountLayout.span
    ) {
      const decoded = AccountLayout.decode(walletUsdcAtaInfo.data);
      revokeTokenDelegate =
        decoded.delegateOption === 1 &&
        new PublicKey(decoded.delegate).equals(subscriptionAuthority);
    }
    const prepared = freezePreparedOperation({
      operation: "earnUsdcAutodepositClose",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      requiresConfirmation: true,
      instructions: [
        ...(delegationAccount
          ? [
              createSubscriptionRevokeDelegationInstruction({
                authority: args.walletAddress,
                delegation: args.recurringDelegation,
              }),
            ]
          : []),
        ...closePolicy.instructions,
        ...(revokeTokenDelegate
          ? [createRevokeInstruction(walletUsdcAta, args.walletAddress)]
          : []),
      ],
      lookupTableAccounts: dedupeLookupTableAccounts(
        closePolicy.lookupTableAccounts ?? []
      ),
    });

    return {
      prepared,
      policy: {
        account: args.policy,
      },
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
      },
      subscription: {
        recurringDelegation: args.recurringDelegation,
      },
      persistence: {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        delegatedSigner: args.policySigner.toBase58(),
        settings: args.settingsPda.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyAccount: args.policy.toBase58(),
        recurringDelegation: args.recurringDelegation.toBase58(),
      },
    };
  }

  async function prepareEarnUsdcAutodepositPull(
    args: SmartAccountEarnUsdcAutodepositPullInput
  ): Promise<SmartAccountPreparedEarnUsdcAutodepositPull> {
    if (args.amountRaw <= BigInt(0)) {
      throw new Error("Autodeposit pull amount must be greater than 0.");
    }

    const cluster = args.cluster ?? LoyalCluster.MainnetBeta;
    const usdcMint = getStablecoinMintForCluster(cluster, Stablecoin.USDC);
    const policy = await smartAccountsClient.policies.queries.fetchPolicy(
      args.policy
    );
    if (policy.policyState.__kind !== "ProgramInteraction") {
      throw new Error(
        "Autodeposit pull requires a program-interaction policy."
      );
    }
    const accountIndex = policy.policyState.fields[0].accountIndex;
    if (accountIndex !== EARN_DEPOSIT_VAULT_INDEX) {
      throw new Error("Autodeposit pull policy must target the Earn vault.");
    }

    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: policy.settings,
      accountIndex,
    })[0];
    const walletUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      args.walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const subscriptionAuthority = deriveSubscriptionAuthority(
      args.walletAddress,
      usdcMint
    );
    const transferInstruction = createSubscriptionTransferRecurringInstruction({
      amountRaw: args.amountRaw,
      delegatee: vaultPda,
      delegation: args.recurringDelegation,
      delegator: args.walletAddress,
      delegatorAta: walletUsdcAta,
      mint: usdcMint,
      receiverAta: vaultUsdcAta,
      subscriptionAuthority,
    });
    const compiledPayload = instructionsToSynchronousTransactionDetailsV2({
      vaultPda,
      members: [args.policySigner],
      transaction_instructions: [
        makeSignerWritable(transferInstruction, vaultPda),
      ],
    });
    const policyPayload: generated.PolicyPayload = {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices: new Uint8Array([0]),
          transactionPayload: {
            __kind: "SyncTransaction",
            fields: [
              {
                accountIndex,
                instructions: compiledPayload.instructions,
              },
            ],
          },
        },
      ],
    };
    const prepared =
      await smartAccountsClient.features.execution.prepare.executePolicyPayloadSync(
        {
          feePayer: args.feePayer,
          policy: args.policy,
          accountIndex,
          numSigners: 1,
          policyPayload,
          instruction_accounts: compiledPayload.accounts,
          memo: args.memo,
        } as never
      );

    return {
      prepared,
      policy: {
        account: args.policy,
      },
      vault: {
        accountIndex: EARN_DEPOSIT_VAULT_INDEX,
        pubkey: vaultPda,
        usdcAta: vaultUsdcAta,
      },
      subscription: {
        authority: subscriptionAuthority,
        recurringDelegation: args.recurringDelegation,
      },
      persistence: {
        cluster,
        walletAddress: args.walletAddress.toBase58(),
        delegatedSigner: args.policySigner.toBase58(),
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: vaultPda.toBase58(),
        policyAccount: args.policy.toBase58(),
        recurringDelegation: args.recurringDelegation.toBase58(),
        amountRaw: args.amountRaw.toString(),
        liquidityMint: usdcMint.toBase58(),
        subscriptionAuthority: subscriptionAuthority.toBase58(),
        walletUsdcAta: walletUsdcAta.toBase58(),
        vaultUsdcAta: vaultUsdcAta.toBase58(),
      },
    };
  }

  async function prepareClosePolicies(
    args: SmartAccountClosePoliciesProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const policies = await resolvePoliciesForClose({
      policies: args.policies,
      settingsPda: args.settingsPda,
    });

    return prepareSettingsChange({
      actions: policies.map((policy) => ({
        __kind: "PolicyRemove",
        policy,
      })),
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "closePolicies",
      policies,
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareClosePoliciesSync(
    args: SmartAccountClosePoliciesSyncInput
  ): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    if (args.signers.length === 0) {
      throw new Error("At least one signer is required.");
    }

    const policies = await resolvePoliciesForClose({
      policies: args.policies,
      settingsPda: args.settingsPda,
    });

    return smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
      {
        feePayer: args.feePayer,
        settingsPda: args.settingsPda,
        signers: dedupePublicKeys(args.signers),
        actions: policies.map((policy) => ({
          __kind: "PolicyRemove",
          policy,
        })),
        memo: args.memo,
        remainingAccounts: toWritableAccountMetas(policies),
      } as never
    );
  }

  async function prepareCloseYieldRoutingPolicies(
    args: SmartAccountClosePoliciesProposalInput
  ): Promise<SmartAccountPreparedSettingsChange> {
    const policies = await resolveYieldRoutingPoliciesForClose({
      policies: args.policies,
      settingsPda: args.settingsPda,
    });

    return prepareSettingsChange({
      actions: policies.map((policy) => ({
        __kind: "PolicyRemove",
        policy,
      })),
      creator: args.creator,
      feePayer: args.feePayer,
      memo: args.memo,
      operation: "closeYieldRoutingPolicies",
      policies,
      settingsPda: args.settingsPda,
      spendingLimits: [],
    });
  }

  async function prepareCloseYieldRoutingPoliciesSync(
    args: SmartAccountClosePoliciesSyncInput
  ): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    if (args.signers.length === 0) {
      throw new Error("At least one signer is required.");
    }

    const policies = await resolveYieldRoutingPoliciesForClose({
      policies: args.policies,
      settingsPda: args.settingsPda,
    });

    return smartAccountsClient.features.execution.prepare.executeSettingsTransactionSync(
      {
        feePayer: args.feePayer,
        settingsPda: args.settingsPda,
        signers: dedupePublicKeys(args.signers),
        actions: policies.map((policy) => ({
          __kind: "PolicyRemove",
          policy,
        })),
        memo: args.memo,
        remainingAccounts: toWritableAccountMetas(policies),
      } as never
    );
  }

  // Earn final-exit cleanup must tolerate policies a prior exit already closed
  // on-chain (a stale DB pair can hand out dead accounts): closing nothing is
  // success, not an error. Returns null when no listed policy exists anymore.
  async function prepareCloseLiveYieldRoutingPoliciesSync(
    args: SmartAccountClosePoliciesSyncInput
  ): Promise<PreparedLoyalSmartAccountsOperation<string> | null> {
    const existing = await getExistingAccountSet({
      accounts: args.policies,
      connection: config.connection,
    });
    const livePolicies = args.policies.filter((policy) =>
      existing.has(policy.toBase58())
    );
    if (livePolicies.length === 0) {
      return null;
    }
    return prepareCloseYieldRoutingPoliciesSync({
      ...args,
      policies: livePolicies,
    });
  }

  async function prepareUseSolSpendingLimitPolicy(
    args: SmartAccountUseSpendingLimitInput
  ): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    if (args.amountLamports <= BigInt(0)) {
      throw new Error("Spending-limit transfer amount must be greater than 0.");
    }

    if (args.amountLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        "Spending-limit transfer amount is too large for this client."
      );
    }

    const policy = await smartAccountsClient.policies.queries.fetchPolicy(
      args.spendingLimitPolicy
    );
    const policyState = policy.policyState;

    if (!policy.settings.equals(args.settingsPda)) {
      throw new Error("Spending-limit policy does not belong to this vault.");
    }

    if (
      policyState.__kind !== "SpendingLimit" ||
      !policyState.fields[0].spendingLimit.mint.equals(PublicKey.default)
    ) {
      throw new Error("A SOL spending-limit policy is required for top-up.");
    }

    const accountIndex = policyState.fields[0].sourceAccountIndex;
    const sourceSmartAccountPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const policyPayload: generated.PolicyPayload = {
      __kind: "SpendingLimit",
      fields: [
        {
          amount: toBn(args.amountLamports),
          destination: args.destination,
          decimals: 9,
        },
      ],
    };
    const instructionAccounts: AccountMeta[] = [
      {
        pubkey: args.signer,
        isSigner: true,
        isWritable: false,
      },
    ];

    if (policy.expiration?.__kind === "SettingsState") {
      instructionAccounts.push({
        pubkey: args.settingsPda,
        isSigner: false,
        isWritable: false,
      });
    }

    instructionAccounts.push(
      {
        pubkey: sourceSmartAccountPda,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: args.destination,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      }
    );

    return smartAccountsClient.features.execution.prepare.executePolicyPayloadSync(
      {
        feePayer: args.feePayer,
        policy: args.spendingLimitPolicy,
        accountIndex,
        numSigners: 1,
        policyPayload,
        instruction_accounts: instructionAccounts,
        memo: args.memo,
      } as never
    );
  }

  async function resolveMintTokenProgramId(
    mint: PublicKey
  ): Promise<PublicKey> {
    const mintAccount = await config.connection.getAccountInfo(
      mint,
      "confirmed"
    );

    if (!mintAccount) {
      throw new Error(`Token mint account ${mint.toBase58()} was not found.`);
    }

    if (
      mintAccount.owner.equals(TOKEN_PROGRAM_ID) ||
      mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)
    ) {
      return mintAccount.owner;
    }

    throw new Error(
      `Token mint account ${mint.toBase58()} is not owned by a supported token program.`
    );
  }

  async function getSpendingLimitPolicyExecutionAccounts(args: {
    policy: Policy;
    policyPayload: generated.PolicyPayload & { __kind: "SpendingLimit" };
  }): Promise<{
    accountMetas: AccountMeta[];
    lookupTableAccounts: AddressLookupTableAccount[];
  }> {
    const policyState = args.policy.policyState;

    if (policyState.__kind !== "SpendingLimit") {
      throw new Error(
        "Stored policy transaction is not a spending-limit policy."
      );
    }

    const payload = args.policyPayload.fields[0];
    const spendingLimitPolicy = policyState.fields[0];
    const sourceSmartAccountPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.policy.settings,
      accountIndex: spendingLimitPolicy.sourceAccountIndex,
    })[0];
    const accountMetas: AccountMeta[] = [];

    if (args.policy.expiration?.__kind === "SettingsState") {
      accountMetas.push({
        pubkey: args.policy.settings,
        isSigner: false,
        isWritable: false,
      });
    }

    if (spendingLimitPolicy.spendingLimit.mint.equals(PublicKey.default)) {
      accountMetas.push(
        {
          pubkey: sourceSmartAccountPda,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: payload.destination,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        }
      );

      return {
        accountMetas,
        lookupTableAccounts: [],
      };
    }

    const mint = spendingLimitPolicy.spendingLimit.mint;
    const tokenProgramId = await resolveMintTokenProgramId(mint);
    const sourceTokenAccount = getAssociatedTokenAddressSync(
      mint,
      sourceSmartAccountPda,
      true,
      tokenProgramId
    );
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      mint,
      payload.destination,
      true,
      tokenProgramId
    );

    accountMetas.push(
      {
        pubkey: sourceSmartAccountPda,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: payload.destination,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: mint,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: sourceTokenAccount,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: destinationTokenAccount,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: tokenProgramId,
        isSigner: false,
        isWritable: false,
      }
    );

    return {
      accountMetas,
      lookupTableAccounts: [],
    };
  }

  async function getProgramInteractionPolicyExecutionAccounts(args: {
    policy: Policy;
    policyPayload: generated.PolicyPayload & { __kind: "ProgramInteraction" };
    transactionPda: PublicKey;
  }): Promise<{
    accountMetas: AccountMeta[];
    lookupTableAccounts: AddressLookupTableAccount[];
  }> {
    const transactionPayload = args.policyPayload.fields[0].transactionPayload;

    if (transactionPayload.__kind !== "AsyncTransaction") {
      throw new Error(
        "Only async program-interaction policy transactions can be executed from a stored proposal."
      );
    }

    const details = transactionPayload.fields[0];
    const [message] = transactionMessageBeet.deserialize(
      Buffer.from(details.transactionMessage),
      0
    );
    const sourceSmartAccountPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.policy.settings,
      accountIndex: details.accountIndex,
    })[0];
    const executionAccounts = await accountsForTransactionExecute({
      connection: config.connection,
      message: toGeneratedTransactionMessage(message),
      ephemeralSignerBumps: Array.from(
        { length: details.ephemeralSigners },
        () => 0
      ),
      smartAccountPda: sourceSmartAccountPda,
      transactionPda: args.transactionPda,
      programId: smartAccountsClient.programId,
    });

    if (args.policy.expiration?.__kind === "SettingsState") {
      executionAccounts.accountMetas.unshift({
        pubkey: args.policy.settings,
        isSigner: false,
        isWritable: false,
      });
    }

    return executionAccounts;
  }

  async function resolvePoliciesForClose(args: {
    policies: PublicKey[];
    settingsPda: PublicKey;
  }): Promise<PublicKey[]> {
    const policies = dedupePublicKeys(args.policies);

    if (policies.length === 0) {
      throw new Error("At least one policy is required.");
    }

    const policyAccounts = await Promise.all(
      policies.map((policyPda) =>
        smartAccountsClient.policies.queries.fetchPolicy(policyPda)
      )
    );

    for (const policy of policyAccounts) {
      if (!policy.settings.equals(args.settingsPda)) {
        throw new Error("Policy belongs to another vault.");
      }
    }

    return policies;
  }

  async function resolveYieldRoutingPoliciesForClose(args: {
    policies: PublicKey[];
    settingsPda: PublicKey;
  }): Promise<PublicKey[]> {
    const policies = dedupePublicKeys(args.policies);
    if (policies.length === 0) {
      throw new Error("At least one policy is required.");
    }

    const policyAccounts = await Promise.all(
      policies.map((policyPda) =>
        smartAccountsClient.policies.queries.fetchPolicy(policyPda)
      )
    );

    for (const policy of policyAccounts) {
      if (!policy.settings.equals(args.settingsPda)) {
        throw new Error("Policy belongs to another vault.");
      }
      if (policy.policyState.__kind !== "ProgramInteraction") {
        throw new Error(
          "Yield routing cleanup only accepts program-interaction policies."
        );
      }
    }

    return policies;
  }

  async function getPolicyTransactionExecutionAccounts(args: {
    policy: Policy;
    policyPayload: generated.PolicyPayload;
    transactionPda: PublicKey;
  }): Promise<{
    accountMetas: AccountMeta[];
    lookupTableAccounts: AddressLookupTableAccount[];
  }> {
    if (args.policyPayload.__kind === "SpendingLimit") {
      return getSpendingLimitPolicyExecutionAccounts({
        policy: args.policy,
        policyPayload: args.policyPayload,
      });
    }

    if (args.policyPayload.__kind === "ProgramInteraction") {
      return getProgramInteractionPolicyExecutionAccounts({
        policy: args.policy,
        policyPayload: args.policyPayload,
        transactionPda: args.transactionPda,
      });
    }

    throw new Error(
      `Policy payload ${args.policyPayload.__kind} cannot be executed from the wallet sidebar.`
    );
  }

  function prepareApproveProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
    memo?: string;
  }) {
    return smartAccountsClient.features.proposals.prepare.approve({
      ...args,
      programId: smartAccountsClient.programId,
    } as never);
  }

  function prepareRejectProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
    memo?: string;
  }) {
    return smartAccountsClient.features.proposals.prepare.reject({
      ...args,
      programId: smartAccountsClient.programId,
    } as never);
  }

  function prepareExecuteProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }) {
    return smartAccountsClient.features.execution.prepare.executeTransaction({
      ...args,
      connection: config.connection,
      programId: smartAccountsClient.programId,
    } as never);
  }

  async function prepareExecuteSettingsProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }) {
    const transactionPda = pda.getTransactionPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      transactionIndex: args.transactionIndex,
    })[0];
    const settingsTransaction =
      await smartAccountsClient.execution.queries.fetchSettingsTransaction(
        transactionPda
      );
    const executionAccounts = getSettingsTransactionExecutionAccounts({
      settingsPda: args.settingsPda,
      settingsTransaction,
      programId: smartAccountsClient.programId,
    });

    return smartAccountsClient.features.execution.prepare.executeSettingsTransaction(
      {
        ...args,
        rentPayer: args.feePayer,
        spendingLimits: executionAccounts.spendingLimits.length
          ? executionAccounts.spendingLimits
          : undefined,
        policies: executionAccounts.policies.length
          ? executionAccounts.policies
          : undefined,
        programId: smartAccountsClient.programId,
      } as never
    );
  }

  async function prepareExecutePolicyProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }): Promise<PreparedLoyalSmartAccountsOperation<string>> {
    const transactionPda = pda.getTransactionPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      transactionIndex: args.transactionIndex,
    })[0];
    const transaction =
      await smartAccountsClient.execution.queries.fetchTransaction(
        transactionPda
      );

    if (transaction.payload.__kind !== "PolicyPayload") {
      throw new Error("Stored transaction is not a policy transaction.");
    }

    const policy = await smartAccountsClient.policies.queries.fetchPolicy(
      args.settingsPda
    );
    const policyPayload = (transaction.payload as PolicyPayloadLike).fields[0]
      .payload;
    const executionAccounts = await getPolicyTransactionExecutionAccounts({
      policy,
      policyPayload,
      transactionPda,
    });
    const instruction = buildExecutePolicyTransactionInstruction({
      feePayer: args.feePayer,
      policy: args.settingsPda,
      transactionIndex: args.transactionIndex,
      signer: args.signer,
      anchorRemainingAccounts: executionAccounts.accountMetas,
      programId: smartAccountsClient.programId,
    });

    return freezePreparedOperation({
      operation: "executePolicyTransaction",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      requiresConfirmation: true,
      instructions: [instruction],
      lookupTableAccounts: executionAccounts.lookupTableAccounts,
    });
  }

  return {
    connection: config.connection,
    programId: smartAccountsClient.programId,
    sdk: smartAccountsClient,
    fetchVault,
    listVaults,
    listSpendingLimitPolicies,
    listSpendingLimits: listSpendingLimitPolicies,
    listProposals,
    fetchOverviewBase,
    fetchVaultSnapshots,
    fetchPolicyOverview,
    fetchProposalSnapshots,
    fetchOverview,
    prepareSolTransferProposal,
    prepareSplTransferProposal,
    prepareCustomInstructionProposal,
    preparePolicyCustomInstructionProposal,
    prepareAddInitiateSigner,
    prepareAddRootSigner,
    prepareRemoveInitiateSigner,
    prepareRemoveRootSigner,
    prepareUpdateSignerPermissions,
    prepareUpdatePolicySignerPermissions,
    prepareSetSpendingLimitPolicy,
    prepareSetSpendingLimitProposal: prepareSetSpendingLimitPolicy,
    prepareRemoveSpendingLimitPolicy,
    prepareRemoveSpendingLimitProposal: prepareRemoveSpendingLimitPolicy,
    prepareEarnUsdcYieldRoutingPolicy,
    prepareEarnUsdcDeposit,
    prepareEarnUsdcWithdraw,
    prepareEarnUsdcCleanup,
    fetchEarnVaultRefundSnapshot,
    prepareEarnVaultAccountsRefund,
    prepareEarnUsdcAutodepositSetup,
    prepareEarnUsdcAutodepositSetupBatch,
    prepareEarnUsdcAutodepositSetupBatchFromPrepared,
    prepareEarnUsdcAutodepositClose,
    prepareEarnUsdcAutodepositPull,
    assertEarnUsdcAutodepositCanonicalArtifacts,
    prepareClosePolicies,
    prepareClosePolicy: (args: SmartAccountClosePolicyProposalInput) =>
      prepareClosePolicies({
        ...args,
        policies: [args.policy],
      }),
    prepareClosePoliciesSync,
    prepareClosePolicySync: (args: SmartAccountClosePolicySyncInput) =>
      prepareClosePoliciesSync({
        ...args,
        policies: [args.policy],
      }),
    prepareCloseYieldRoutingPolicies,
    prepareCloseYieldRoutingPolicy: (
      args: SmartAccountClosePolicyProposalInput
    ) =>
      prepareCloseYieldRoutingPolicies({
        ...args,
        policies: [args.policy],
      }),
    prepareCloseYieldRoutingPoliciesSync,
    prepareCloseYieldRoutingPolicySync: (
      args: SmartAccountClosePolicySyncInput
    ) =>
      prepareCloseYieldRoutingPoliciesSync({
        ...args,
        policies: [args.policy],
      }),
    prepareUseSolSpendingLimitPolicy,
    prepareUseSolSpendingLimit: prepareUseSolSpendingLimitPolicy,
    prepareApproveProposal,
    prepareRejectProposal,
    prepareExecuteProposal,
    prepareExecuteSettingsProposal,
    prepareExecutePolicyProposal,
  };
}
