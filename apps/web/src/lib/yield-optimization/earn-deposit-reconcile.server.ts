import "server-only";

import {
  RiskBasket,
  Stablecoin,
  getRiskBasketMarketsForCluster,
  getStablecoinMintForCluster,
  resolveLoyalClusterForSolanaEnv,
  type LoyalCluster,
} from "@loyal-labs/actions";
import { appUsers, appUserSmartAccounts } from "@loyal-labs/db-core/schema";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { reportEarnDepositQuestCompletion } from "@/features/solana-week/server/quest-completion-service";
import { resolveLoyalSmartAccountsProgramIdFromEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getDatabase } from "@/lib/core/database";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

import { parseEarnDepositConfirmRequestBody } from "./earn-confirm-contracts.shared";
import {
  recordConfirmedEarnDeposit,
  resolvePolicyCreationSignatureFromChain,
} from "./earn-deposit-confirm.server";
import {
  deriveEarnVaultPda,
  fetchEarnRpcHoldingsSnapshot,
  type EarnRpcHolding,
  type EarnRpcPolicyMetadata,
} from "./earn-rpc-holdings.client";
import {
  getEarnProductAssetsForCluster,
  resolveEarnProductAsset,
} from "./earn-product-mints.shared";
import {
  findActiveYieldRoutePolicyPair,
  recordConfirmedEarnDepositOnboardingPolicyStage,
  type ConfirmedYieldRoutePolicyInput,
} from "./yield-deposit-repository.server";
import {
  earnDepositOnboardingAttempts,
  getYieldOptimizationClient,
  userYieldPositionDeposits,
} from "./yield-neon-client.server";

// Adopts "invisible" Earn deposits: wallets whose deposit landed on-chain but
// whose deposit-confirm call was lost or rejected, leaving the yield DB with no
// rows at all — so /holdings shows nothing. For each affected wallet this
// finds an unseen finalized signature in the selected mint's token history,
// binds it to the reserve named by that transaction, and replays it through
// `recordConfirmedEarnDeposit`, which
// re-verifies everything on-chain before writing. Launch night 2026-07-08: 60
// wallets / $355 went invisible this way; the same logic (as a manual script)
// adopted 47 of them. Every adoption logged here is a lost confirm — if these
// appear regularly, the confirm path is broken again.
const EARN_VAULT_INDEX = 1;
const SIGNATURE_PAGE_LIMIT = 1000;
const SIGNATURE_MAX_PAGES = 8;
const DEPOSIT_TX_SCAN_CAP = 80; // max parsed txs inspected per wallet
const MIN_ADOPT_TOTAL_RAW = BigInt(10_000); // ignore sub-$0.01 dust vaults
const DEFAULT_TIME_BUDGET_MS = 240_000;
const SCAN_CONCURRENCY = 5;
// Cover the whole managed fleet without a second database cursor. The cron
// runs every ten minutes; 24 stable shards give every wallet one bounded scan
// per four hours while `full=1` remains available for an explicit sweep.
const RECONCILE_SHARD_COUNT = 24;

export type EarnDepositReconcileOutcome = {
  wallet: string;
  settings: string;
  status: "adopted" | "ready" | "skipped" | "error";
  amountRaw?: string;
  depositSignature?: string;
  reason?: string;
};

export type EarnPolicyOnlyReconcileOutcome = {
  wallet: string;
  settings: string;
  status: "adopted" | "ready" | "skipped";
  routePolicyAccount?: string;
  routePolicySignature?: string;
  setupPolicyAccount?: string;
  setupPolicySignature?: string;
  reason?: string;
};

export type EarnDepositReconcileSummary = {
  candidates: number;
  scanned: number;
  adopted: EarnDepositReconcileOutcome[];
  skipped: number;
  errors: number;
  truncated: boolean;
  dryRun: boolean;
  policyOnlyCandidates: number;
  policyOnlyScanned: number;
  policyOnlyAdopted: EarnPolicyOnlyReconcileOutcome[];
  policyOnlyReady: EarnPolicyOnlyReconcileOutcome[];
  policyOnlySkipped: number;
  policyOnlyErrors: number;
};

type Candidate = { walletAddress: string; settingsPda: string };

export function earnDepositReconcileShard(settingsPda: string): number {
  let hash = 0;
  for (const character of settingsPda) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % RECONCILE_SHARD_COUNT;
}
type PolicyOnlyCandidate = {
  delegatedSigner: string;
  liquidityMint: string;
  market: string | null;
  policyAccount: string;
  policyConfirmedSlot: bigint | null;
  policySeed: bigint;
  policySignature: string | null;
  settingsPda: string;
  setupPolicyAccount: string | null;
  setupPolicyConfirmedSlot: bigint | null;
  setupPolicySeed: bigint | null;
  setupPolicySignature: string | null;
  targetReserve: string;
  updatedAt: Date;
  vaultIndex: number;
  vaultPubkey: string;
  walletAddress: string;
};

function getConnection(solanaEnv: SolanaEnv): Connection {
  const { rpcEndpoint, websocketEndpoint } =
    getServerSolanaEndpoints(solanaEnv);
  return new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
}

// Synthesized Safe-universe policy metadata: the holdings snapshot only reads
// the market/mint lists from it (the wallet has no DB policy row to use).
function buildScanPolicyMetadata(cluster: LoyalCluster): EarnRpcPolicyMetadata {
  const stableMints = Object.values(Stablecoin).flatMap((stablecoin) => {
    try {
      return [getStablecoinMintForCluster(cluster, stablecoin).toBase58()];
    } catch {
      return [];
    }
  });
  return {
    account: PublicKey.default.toBase58(),
    kaminoLiquidityMints: stableMints,
    kaminoMarkets: getRiskBasketMarketsForCluster(cluster, RiskBasket.Safe).map(
      (market) => market.toBase58()
    ),
    routeModes: ["kamino_init_obligation"],
    seed: "0",
    stableMints,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: PublicKey.default.toBase58(),
  };
}

// Ready smart accounts. A missing confirmation is a transaction problem, not a
// wallet-lifecycle state: existing positions remain eligible for recovery.
async function listCandidates(
  solanaEnv: SolanaEnv,
  fullScan: boolean
): Promise<Candidate[]> {
  const readyAccounts = await getDatabase()
    .select({
      settingsPda: appUserSmartAccounts.settingsPda,
      walletAddress: appUsers.subjectAddress,
    })
    .from(appUserSmartAccounts)
    .innerJoin(appUsers, eq(appUserSmartAccounts.userId, appUsers.id))
    .where(
      and(
        eq(appUserSmartAccounts.state, "ready"),
        eq(appUserSmartAccounts.solanaEnv, solanaEnv)
      )
    )
    .orderBy(desc(appUserSmartAccounts.updatedAt));

  const currentShard =
    Math.floor(Date.now() / (10 * 60 * 1000)) % RECONCILE_SHARD_COUNT;
  return readyAccounts.filter(
    (row): row is Candidate =>
      Boolean(row.settingsPda) &&
      Boolean(row.walletAddress) &&
      (fullScan || earnDepositReconcileShard(row.settingsPda!) === currentShard)
  );
}

// Policy-only recovery begins from the durable partial-onboarding journal, not
// from live holdings. Restricting this lane to route-confirmed rows makes a
// successful repair naturally leave the next cron scan: the canonical
// repository call advances it to setup_policy_confirmed. Unlike the high-RPC
// invisible-deposit sweep, this bounded queue includes old strands and visits
// the oldest first so a 72-hour app-account window cannot strand them forever.
async function listPolicyOnlyCandidates(): Promise<PolicyOnlyCandidate[]> {
  return getYieldOptimizationClient()
    .db.select({
      delegatedSigner: earnDepositOnboardingAttempts.delegatedSigner,
      liquidityMint: earnDepositOnboardingAttempts.liquidityMint,
      market: earnDepositOnboardingAttempts.market,
      policyAccount: earnDepositOnboardingAttempts.policyAccount,
      policyConfirmedSlot:
        earnDepositOnboardingAttempts.routePolicyConfirmedSlot,
      policySeed: earnDepositOnboardingAttempts.policySeed,
      policySignature: earnDepositOnboardingAttempts.routePolicySignature,
      settingsPda: earnDepositOnboardingAttempts.settings,
      setupPolicyAccount: earnDepositOnboardingAttempts.setupPolicyAccount,
      setupPolicyConfirmedSlot:
        earnDepositOnboardingAttempts.setupPolicyConfirmedSlot,
      setupPolicySeed: earnDepositOnboardingAttempts.setupPolicySeed,
      setupPolicySignature: earnDepositOnboardingAttempts.setupPolicySignature,
      targetReserve: earnDepositOnboardingAttempts.targetReserve,
      updatedAt: earnDepositOnboardingAttempts.updatedAt,
      vaultIndex: earnDepositOnboardingAttempts.vaultIndex,
      vaultPubkey: earnDepositOnboardingAttempts.vaultPubkey,
      walletAddress: earnDepositOnboardingAttempts.walletAddress,
    })
    .from(earnDepositOnboardingAttempts)
    .leftJoin(
      userYieldPositionDeposits,
      and(
        eq(
          userYieldPositionDeposits.settings,
          earnDepositOnboardingAttempts.settings
        ),
        eq(
          userYieldPositionDeposits.vaultIndex,
          earnDepositOnboardingAttempts.vaultIndex
        ),
        eq(
          userYieldPositionDeposits.vaultPubkey,
          earnDepositOnboardingAttempts.vaultPubkey
        ),
        eq(
          userYieldPositionDeposits.policyAccount,
          earnDepositOnboardingAttempts.policyAccount
        ),
        eq(
          userYieldPositionDeposits.policySeed,
          earnDepositOnboardingAttempts.policySeed
        )
      )
    )
    .where(
      and(
        eq(earnDepositOnboardingAttempts.status, "route_policy_confirmed"),
        isNull(earnDepositOnboardingAttempts.depositSignature),
        isNull(userYieldPositionDeposits.id)
      )
    )
    .orderBy(asc(earnDepositOnboardingAttempts.updatedAt));
}

// --- deposit-tx proof helpers (mirror earn-deposit-confirm.server's
// getParsedTokenBalanceDeltasByOwner, which is not exported) ---
function readTokenBalanceAmountRaw(balance: TokenBalance | undefined): bigint {
  const amount = balance?.uiTokenAmount.amount;
  return typeof amount === "string" && /^\d+$/.test(amount)
    ? BigInt(amount)
    : BigInt(0);
}

function tokenDeltasByOwner(
  mint: string,
  transaction: ParsedTransactionWithMeta
): Map<string, bigint> {
  const pre = transaction.meta?.preTokenBalances ?? [];
  const post = transaction.meta?.postTokenBalances ?? [];
  const indexes = new Set<number>();
  for (const balance of [...pre, ...post]) {
    if (balance.mint === mint) {
      indexes.add(balance.accountIndex);
    }
  }
  const deltas = new Map<string, bigint>();
  for (const accountIndex of indexes) {
    const preBalance = pre.find(
      (b) => b.accountIndex === accountIndex && b.mint === mint
    );
    const postBalance = post.find(
      (b) => b.accountIndex === accountIndex && b.mint === mint
    );
    const owner = postBalance?.owner ?? preBalance?.owner ?? null;
    if (!owner) {
      continue;
    }
    deltas.set(
      owner,
      (deltas.get(owner) ?? BigInt(0)) +
        readTokenBalanceAmountRaw(postBalance) -
        readTokenBalanceAmountRaw(preBalance)
    );
  }
  return deltas;
}

async function listSignaturesOldestFirst(
  connection: Connection,
  address: PublicKey
): Promise<{ signature: string; slot: number; err: unknown }[]> {
  const all: { signature: string; slot: number; err: unknown }[] = [];
  let before: string | undefined;
  for (let page = 0; page < SIGNATURE_MAX_PAGES; page += 1) {
    const batch = await connection.getSignaturesForAddress(
      address,
      { before, limit: SIGNATURE_PAGE_LIMIT },
      "confirmed"
    );
    all.push(
      ...batch.map((entry) => ({
        signature: entry.signature,
        slot: entry.slot,
        err: entry.err,
      }))
    );
    if (batch.length < SIGNATURE_PAGE_LIMIT) {
      break;
    }
    before = batch[batch.length - 1]?.signature;
  }
  return all.reverse();
}

type DiscoveredDeposit = {
  signature: string;
  slot: number;
  proofPrincipalRaw: bigint;
  target: EarnRpcHolding & { market: string; reserve: string };
};

export function selectDepositRecoveryTarget(args: {
  reserveCandidates: Array<
    EarnRpcHolding & { market: string; reserve: string }
  >;
  transactionAccounts: ReadonlySet<string>;
}): (EarnRpcHolding & { market: string; reserve: string }) | null {
  const matches = args.reserveCandidates.filter((candidate) =>
    args.transactionAccounts.has(candidate.reserve)
  );
  return matches.length === 1 ? matches[0]! : null;
}

// Find one unseen finalized deposit and bind it to the one candidate reserve
// actually named by that transaction. Never infer a target from current size.
async function discoverDepositTransaction(args: {
  connection: Connection;
  knownSignatures: ReadonlySet<string>;
  mint: string;
  reserveCandidates: Array<
    EarnRpcHolding & { market: string; reserve: string }
  >;
  tokenProgramId: PublicKey;
  vault: PublicKey;
  wallet: string;
}): Promise<DiscoveredDeposit | null> {
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    new PublicKey(args.mint),
    args.vault,
    true,
    args.tokenProgramId
  );
  let signatures = await listSignaturesOldestFirst(
    args.connection,
    vaultUsdcAta
  );
  if (signatures.length === 0) {
    signatures = await listSignaturesOldestFirst(args.connection, args.vault);
  }

  const vaultBase58 = args.vault.toBase58();
  let vaultOnlyFallback: DiscoveredDeposit | null = null;
  let inspected = 0;

  for (const entry of signatures) {
    if (entry.err !== null || args.knownSignatures.has(entry.signature)) {
      continue;
    }
    if (inspected >= DEPOSIT_TX_SCAN_CAP) {
      break;
    }
    inspected += 1;
    const transaction = await args.connection.getParsedTransaction(
      entry.signature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
    );
    if (!transaction || !transaction.meta || transaction.meta.err) {
      continue;
    }
    const transactionAccounts = new Set(
      transaction.transaction.message.accountKeys.map((account) =>
        account.pubkey.toBase58()
      )
    );
    const target = selectDepositRecoveryTarget({
      reserveCandidates: args.reserveCandidates,
      transactionAccounts,
    });
    if (!target) {
      continue;
    }
    const deltas = tokenDeltasByOwner(args.mint, transaction);
    const walletDelta = deltas.get(args.wallet) ?? BigInt(0);
    const proof = [...new Set([args.wallet, vaultBase58])].reduce(
      (total, owner) => {
        const delta = deltas.get(owner) ?? BigInt(0);
        return delta < BigInt(0) ? total - delta : total;
      },
      BigInt(0)
    );
    if (proof <= BigInt(0)) {
      continue;
    }

    const candidate: DiscoveredDeposit = {
      signature: entry.signature,
      slot: transaction.slot,
      proofPrincipalRaw: proof,
      target,
    };
    if (walletDelta < BigInt(0)) {
      return candidate;
    }
    // A vault-only debit (e.g. router sweep) still satisfies the recorder's
    // proof; keep the oldest as fallback but prefer a wallet debit.
    vaultOnlyFallback ??= candidate;
  }

  return vaultOnlyFallback;
}

async function validateCreationCitation(args: {
  connection: Connection;
  expectedRecordedSignature: string | null;
  expectedRecordedSlot: bigint | null;
  policyAccount: PublicKey;
  recovered: { signature: string; slot: string };
  wallet: PublicKey;
}): Promise<string | null> {
  const recoveredSlot = BigInt(args.recovered.slot);
  if (
    args.expectedRecordedSignature !== null &&
    args.expectedRecordedSignature !== args.recovered.signature
  ) {
    return "recorded_signature_mismatch";
  }
  if (
    args.expectedRecordedSlot !== null &&
    args.expectedRecordedSlot !== recoveredSlot
  ) {
    return "recorded_slot_mismatch";
  }
  const transaction = await args.connection.getParsedTransaction(
    args.recovered.signature,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
  );
  if (
    !transaction ||
    transaction.meta?.err ||
    BigInt(transaction.slot) !== recoveredSlot
  ) {
    return "creation_transaction_unavailable";
  }
  const accountKeys = transaction.transaction.message.accountKeys;
  if (
    !accountKeys.some((account) => account.pubkey.equals(args.policyAccount))
  ) {
    return "creation_transaction_policy_mismatch";
  }
  if (
    !accountKeys.some(
      (account) => account.signer && account.pubkey.equals(args.wallet)
    )
  ) {
    return "creation_transaction_wallet_mismatch";
  }
  return null;
}

async function reconcilePolicyOnlyCandidate(args: {
  candidate: PolicyOnlyCandidate;
  cluster: LoyalCluster;
  connection: Connection;
  dryRun: boolean;
  programId: PublicKey;
  solanaEnv: SolanaEnv;
}): Promise<EarnPolicyOnlyReconcileOutcome> {
  const { candidate } = args;
  const base = {
    settings: candidate.settingsPda,
    wallet: candidate.walletAddress,
  };
  const skip = (reason: string): EarnPolicyOnlyReconcileOutcome => ({
    ...base,
    status: "skipped",
    reason,
  });

  let settingsPda: PublicKey;
  let wallet: PublicKey;
  let delegatedSigner: PublicKey;
  try {
    settingsPda = new PublicKey(candidate.settingsPda);
    wallet = new PublicKey(candidate.walletAddress);
    delegatedSigner = new PublicKey(candidate.delegatedSigner);
  } catch {
    return skip("invalid_onboarding_public_key");
  }
  if (
    candidate.vaultIndex !== EARN_VAULT_INDEX ||
    candidate.policySeed <= BigInt(0) ||
    candidate.policySeed >= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return skip("invalid_onboarding_policy_metadata");
  }

  const vault = deriveEarnVaultPda({
    programId: args.programId,
    settingsPda,
  });
  if (candidate.vaultPubkey !== vault.toBase58()) {
    return skip("vault_mismatch");
  }
  const routeSeed = candidate.policySeed;
  const setupSeed = routeSeed + BigInt(1);
  const routeAccount = pda.getPolicyPda({
    programId: args.programId,
    settingsPda,
    policySeed: Number(routeSeed),
  })[0];
  const setupAccount = pda.getPolicyPda({
    programId: args.programId,
    settingsPda,
    policySeed: Number(setupSeed),
  })[0];
  if (candidate.policyAccount !== routeAccount.toBase58()) {
    return skip("route_policy_account_mismatch");
  }
  if (
    (candidate.setupPolicySeed !== null &&
      candidate.setupPolicySeed !== setupSeed) ||
    (candidate.setupPolicyAccount !== null &&
      candidate.setupPolicyAccount !== setupAccount.toBase58())
  ) {
    return skip("setup_policy_metadata_mismatch");
  }

  try {
    resolveEarnProductAsset({
      cluster: args.cluster,
      mint: candidate.liquidityMint,
    });
    new PublicKey(candidate.targetReserve);
  } catch {
    return skip("earn_target_mismatch");
  }
  if (
    !candidate.market ||
    !getRiskBasketMarketsForCluster(args.cluster, RiskBasket.Safe).some(
      (market) => market.toBase58() === candidate.market
    )
  ) {
    return skip("earn_target_mismatch");
  }

  const [routeInfo, setupInfo] = await args.connection.getMultipleAccountsInfo(
    [routeAccount, setupAccount],
    { commitment: "confirmed" }
  );
  if (!routeInfo || !setupInfo) {
    return skip(!routeInfo ? "route_policy_missing" : "setup_policy_missing");
  }
  if (
    !routeInfo.owner.equals(args.programId) ||
    !setupInfo.owner.equals(args.programId)
  ) {
    return skip("policy_owner_mismatch");
  }

  const routeCreation = await resolvePolicyCreationSignatureFromChain({
    cluster: args.solanaEnv,
    policyAccount: routeAccount.toBase58(),
  });
  const setupCreation = await resolvePolicyCreationSignatureFromChain({
    cluster: args.solanaEnv,
    policyAccount: setupAccount.toBase58(),
  });
  if (!routeCreation || !setupCreation) {
    return skip("policy_creation_signature_not_found");
  }
  const routeCitationMismatch = await validateCreationCitation({
    connection: args.connection,
    expectedRecordedSignature: candidate.policySignature,
    expectedRecordedSlot: candidate.policyConfirmedSlot,
    policyAccount: routeAccount,
    recovered: routeCreation,
    wallet,
  });
  if (routeCitationMismatch) {
    return skip(`route_policy_${routeCitationMismatch}`);
  }
  const setupCitationMismatch = await validateCreationCitation({
    connection: args.connection,
    expectedRecordedSignature: candidate.setupPolicySignature,
    expectedRecordedSlot: candidate.setupPolicyConfirmedSlot,
    policyAccount: setupAccount,
    recovered: setupCreation,
    wallet,
  });
  if (setupCitationMismatch) {
    return skip(`setup_policy_${setupCitationMismatch}`);
  }

  const input: ConfirmedYieldRoutePolicyInput = {
    cluster: args.cluster,
    confirmedSlot: BigInt(routeCreation.slot),
    delegatedSigner: delegatedSigner.toBase58(),
    liquidityMint: candidate.liquidityMint,
    market: candidate.market,
    policyAccount: routeAccount.toBase58(),
    policyConfirmedSlot: BigInt(routeCreation.slot),
    policyId: routeSeed,
    policySeed: routeSeed,
    policySignature: routeCreation.signature,
    settings: settingsPda.toBase58(),
    setupPolicyAccount: setupAccount.toBase58(),
    setupPolicyConfirmedSlot: BigInt(setupCreation.slot),
    setupPolicyId: setupSeed,
    setupPolicySeed: setupSeed,
    setupPolicySignature: setupCreation.signature,
    targetReserve: candidate.targetReserve,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: vault.toBase58(),
    walletAddress: wallet.toBase58(),
  };
  const evidence = {
    ...base,
    routePolicyAccount: routeAccount.toBase58(),
    routePolicySignature: routeCreation.signature,
    setupPolicyAccount: setupAccount.toBase58(),
    setupPolicySignature: setupCreation.signature,
  };
  if (args.dryRun) {
    return { ...evidence, status: "ready" };
  }

  await recordConfirmedEarnDepositOnboardingPolicyStage(input, "setup_policy");
  return { ...evidence, status: "adopted" };
}

async function reconcileWallet(args: {
  candidate: Candidate;
  connection: Connection;
  dryRun: boolean;
  programId: PublicKey;
  safeMarkets: Set<string>;
  scanPolicy: EarnRpcPolicyMetadata;
  solanaEnv: SolanaEnv;
}): Promise<EarnDepositReconcileOutcome> {
  const { candidate } = args;
  const base = {
    wallet: candidate.walletAddress,
    settings: candidate.settingsPda,
  };
  const skip = (reason: string): EarnDepositReconcileOutcome => ({
    ...base,
    status: "skipped",
    reason,
  });

  const cluster = resolveLoyalClusterForSolanaEnv(args.solanaEnv);
  const settingsPda = new PublicKey(candidate.settingsPda);
  const vault = deriveEarnVaultPda({ programId: args.programId, settingsPda });

  // 1. Chain truth: does the vault actually hold funds?
  const snapshot = await fetchEarnRpcHoldingsSnapshot({
    cluster,
    connection: args.connection,
    policy: args.scanPolicy,
    programId: args.programId,
    settingsPda,
  });
  const liveTotal = BigInt(snapshot.currentTotalAmountRaw);
  if (liveTotal < MIN_ADOPT_TOTAL_RAW) {
    return skip(
      liveTotal <= BigInt(0) ? "no_live_holdings" : "below_dust_threshold"
    );
  }

  // A recovery must name the reserve that appears in the finalized
  // transaction. Current aggregate size is never used to guess the target.
  const reserveHoldings = snapshot.holdings.filter(
    (
      holding
    ): holding is EarnRpcHolding & { market: string; reserve: string } =>
      holding.kind === "kamino" &&
      holding.market !== null &&
      holding.reserve !== null &&
      BigInt(holding.amountRaw) > BigInt(0)
  );
  if (reserveHoldings.length === 0) {
    return skip("idle_only_not_representable");
  }

  // Reuse the policy pair already accepted by normal prepare. Recovery does
  // not rediscover, rebuild, or reinterpret policies.
  const existingPair = await findActiveYieldRoutePolicyPair({
    authority: candidate.walletAddress,
    cluster,
    settings: candidate.settingsPda,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: vault.toBase58(),
  });
  if (!(existingPair?.routePolicy && existingPair.setupPolicy)) {
    return skip("policy_update_required");
  }
  const delegatedSigner = existingPair.routePolicy.delegatedSigners[0];
  if (!delegatedSigner) {
    return skip("policy_update_required");
  }
  const knownDepositRows = await getYieldOptimizationClient()
    .db.select({ signature: userYieldPositionDeposits.depositSignature })
    .from(userYieldPositionDeposits)
    .where(
      eq(userYieldPositionDeposits.walletAddress, candidate.walletAddress)
    );
  const knownSignatures = new Set(knownDepositRows.map((row) => row.signature));
  let deposit: DiscoveredDeposit | null = null;
  for (const asset of getEarnProductAssetsForCluster(cluster)) {
    const candidates = reserveHoldings.filter(
      (holding) => holding.liquidityMint === asset.mint.toBase58()
    );
    if (candidates.length === 0) {
      continue;
    }
    deposit = await discoverDepositTransaction({
      connection: args.connection,
      knownSignatures,
      mint: asset.mint.toBase58(),
      reserveCandidates: candidates,
      tokenProgramId: asset.tokenProgramId,
      vault,
      wallet: candidate.walletAddress,
    });
    if (deposit) {
      break;
    }
  }
  if (!deposit) {
    return skip("deposit_transaction_not_found");
  }
  const target = deposit.target;
  if (!args.safeMarkets.has(target.market)) {
    return skip(`target_market_not_in_safe_universe: ${target.market}`);
  }
  resolveEarnProductAsset({ cluster, mint: target.liquidityMint });

  // Replay the exact finalized signature through the normal validating
  // recorder. Signature uniqueness is the only recovery concurrency boundary.
  const confirmBody = {
    cluster,
    confirmedSlot: deposit.slot.toString(),
    delegatedSigner,
    depositMint: target.liquidityMint,
    depositSignature: deposit.signature,
    liquidityMint: target.liquidityMint,
    market: target.market,
    policyAccount: existingPair.routePolicy.policyAccount,
    policyId: existingPair.routePolicy.policySeed.toString(),
    policyInitialization: "reuse",
    policySeed: existingPair.routePolicy.policySeed.toString(),
    policySignature: existingPair.routePolicy.lastSeenSignature,
    principalAmountRaw: deposit.proofPrincipalRaw.toString(),
    settings: candidate.settingsPda,
    setupPolicyAccount: existingPair.setupPolicy.policyAccount,
    setupPolicyId: existingPair.setupPolicy.policySeed.toString(),
    setupPolicySeed: existingPair.setupPolicy.policySeed.toString(),
    setupPolicySignature: existingPair.setupPolicy.lastSeenSignature,
    smartAccountAddress: vault.toBase58(),
    targetReserve: target.reserve,
    targetSupplyApyBps: null,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: vault.toBase58(),
    walletAddress: candidate.walletAddress,
  };
  const input = parseEarnDepositConfirmRequestBody(confirmBody);

  if (args.dryRun) {
    return {
      ...base,
      status: "ready",
      amountRaw: deposit.proofPrincipalRaw.toString(),
      depositSignature: deposit.signature,
    };
  }

  await recordConfirmedEarnDeposit({
    principal: {
      walletAddress: candidate.walletAddress,
      smartAccountAddress: vault.toBase58(),
      settingsPda: candidate.settingsPda,
    },
    input,
  });

  // Best-effort quest attribution (no-op below threshold; idempotent).
  await reportEarnDepositQuestCompletion(
    candidate.walletAddress,
    deposit.proofPrincipalRaw,
    {
      source: "earn-deposit-reconcile-cron",
      solanaEnv: args.solanaEnv,
      depositUsdcRaw: deposit.proofPrincipalRaw.toString(),
    }
  );

  return {
    ...base,
    status: "adopted",
    amountRaw: deposit.proofPrincipalRaw.toString(),
    depositSignature: deposit.signature,
  };
}

export async function reconcileInvisibleEarnDeposits(args?: {
  dryRun?: boolean;
  fullScan?: boolean;
  policyOnly?: boolean;
  timeBudgetMs?: number;
}): Promise<EarnDepositReconcileSummary> {
  const dryRun = args?.dryRun ?? false;
  const fullScan = args?.fullScan ?? false;
  const policyOnly = args?.policyOnly ?? false;
  const deadline = Date.now() + (args?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const programId = new PublicKey(
    resolveLoyalSmartAccountsProgramIdFromEnv(process.env)
  );
  const safeMarkets = new Set(
    getRiskBasketMarketsForCluster(cluster, RiskBasket.Safe).map((market) =>
      market.toBase58()
    )
  );
  const scanPolicy = buildScanPolicyMetadata(cluster);
  const connection = getConnection(solanaEnv);

  const [candidates, policyOnlyCandidates] = await Promise.all([
    policyOnly ? Promise.resolve([]) : listCandidates(solanaEnv, fullScan),
    listPolicyOnlyCandidates(),
  ]);
  const summary: EarnDepositReconcileSummary = {
    candidates: candidates.length,
    scanned: 0,
    adopted: [],
    skipped: 0,
    errors: 0,
    truncated: false,
    dryRun,
    policyOnlyCandidates: policyOnlyCandidates.length,
    policyOnlyScanned: 0,
    policyOnlyAdopted: [],
    policyOnlyReady: [],
    policyOnlySkipped: 0,
    policyOnlyErrors: 0,
  };

  const policyOnlyQueue = [...policyOnlyCandidates];
  const policyOnlyWorker = async () => {
    for (;;) {
      if (Date.now() >= deadline) {
        summary.truncated = true;
        return;
      }
      const candidate = policyOnlyQueue.shift();
      if (!candidate) {
        return;
      }
      try {
        const outcome = await reconcilePolicyOnlyCandidate({
          candidate,
          cluster,
          connection,
          dryRun,
          programId,
          solanaEnv,
        });
        if (outcome.status === "adopted") {
          // This is a lost setup-policy confirmation, not a deposit adoption.
          // Keep it loud: repeat occurrences indicate the staged-confirm path
          // is losing acknowledgements again.
          console.error(
            "[earn-deposit-reconcile] adopted policy-only onboarding strand",
            { ...outcome }
          );
          summary.policyOnlyAdopted.push(outcome);
        } else if (outcome.status === "ready") {
          console.info(
            "[earn-deposit-reconcile] policy-only onboarding strand ready",
            { ...outcome }
          );
          summary.policyOnlyReady.push(outcome);
        } else {
          summary.policyOnlySkipped += 1;
          console.warn(
            "[earn-deposit-reconcile] skipped policy-only onboarding strand",
            { ...outcome }
          );
        }
      } catch (error) {
        summary.policyOnlyErrors += 1;
        console.error("[earn-deposit-reconcile] policy-only wallet failed", {
          errorMessage:
            error instanceof Error ? error.message : "Unknown reconcile error.",
          settings: candidate.settingsPda,
          wallet: candidate.walletAddress,
        });
      }
      summary.policyOnlyScanned += 1;
    }
  };
  await Promise.all(
    Array.from({ length: SCAN_CONCURRENCY }, () => policyOnlyWorker())
  );

  if (policyOnly) {
    return summary;
  }

  const queue = [...candidates];
  const worker = async () => {
    for (;;) {
      if (Date.now() >= deadline) {
        summary.truncated = true;
        return;
      }
      const candidate = queue.shift();
      if (!candidate) {
        return;
      }
      try {
        const outcome = await reconcileWallet({
          candidate,
          connection,
          dryRun,
          programId,
          safeMarkets,
          scanPolicy,
          solanaEnv,
        });
        if (outcome.status === "adopted" || outcome.status === "ready") {
          // Each adoption is a deposit-confirm the normal path lost — loud on
          // purpose so regressions surface in the logs, not in support tickets.
          console.error("[earn-deposit-reconcile] adopted invisible deposit", {
            ...outcome,
          });
          summary.adopted.push(outcome);
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        summary.errors += 1;
        console.error("[earn-deposit-reconcile] wallet failed", {
          errorMessage:
            error instanceof Error ? error.message : "Unknown reconcile error.",
          settings: candidate.settingsPda,
          wallet: candidate.walletAddress,
        });
      }
      summary.scanned += 1;
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, () => worker()));

  if (summary.truncated) {
    console.warn("[earn-deposit-reconcile] time budget hit before full scan", {
      candidates: summary.candidates,
      scanned: summary.scanned,
    });
  }
  return summary;
}
