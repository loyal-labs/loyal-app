import "server-only";

import {
  KAMINO_USER_METADATA_SEED,
  KAMINO_VANILLA_OBLIGATION_ID,
  KAMINO_VANILLA_OBLIGATION_TAG,
  RiskBasket,
  Stablecoin,
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
  getStablecoinMintForCluster,
  getStablecoinMintsForCluster,
  resolveLoyalClusterForSolanaEnv,
  type LoyalCluster,
} from "@loyal-labs/actions";
import { appUsers, appUserSmartAccounts } from "@loyal-labs/db-core/schema";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  Permission,
  Policy,
  generated,
  toBigInt,
} from "@loyal-labs/loyal-smart-accounts-core";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";
import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";

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
  findActiveYieldRoutePolicyPair,
  recordConfirmedEarnDepositOnboardingPolicyStage,
  type ConfirmedYieldRoutePolicyInput,
} from "./yield-deposit-repository.server";
import {
  earnDepositOnboardingAttempts,
  getYieldOptimizationClient,
  userYieldPositionDeposits,
  userYieldPositions,
} from "./yield-neon-client.server";

// Adopts "invisible" Earn deposits: wallets whose deposit landed on-chain but
// whose deposit-confirm call was lost or rejected, leaving the yield DB with no
// rows at all — so /holdings shows nothing. For each affected wallet this
// reconstructs the confirm payload the device would have sent (policy pair
// recovered from chain, deposit signature+slot from the vault's USDC ATA
// history) and replays it through `recordConfirmedEarnDeposit`, which
// re-verifies everything on-chain before writing. Launch night 2026-07-08: 60
// wallets / $355 went invisible this way; the same logic (as a manual script)
// adopted 47 of them. Every adoption logged here is a lost confirm — if these
// appear regularly, the confirm path is broken again.
const EARN_VAULT_INDEX = 1;
const POLICY_SEED_PROBE_MAX = 40; // policy seeds start at 1; first deposits use low seeds
const SIGNATURE_PAGE_LIMIT = 1000;
const SIGNATURE_MAX_PAGES = 8;
const DEPOSIT_TX_SCAN_CAP = 80; // max parsed txs inspected per wallet
const MIN_ADOPT_TOTAL_RAW = BigInt(10_000); // ignore sub-$0.01 dust vaults
const DEFAULT_TIME_BUDGET_MS = 240_000;
const SCAN_CONCURRENCY = 5;
// Lost confirms happen to fresh signups (every adoption so far was a new
// account), and the Helius budget is a hard 5 rps — so each run scans only
// recently-touched accounts (~100 RPC calls) instead of the whole fleet
// (~1,300). `full=1` on the cron route runs the unbounded sweep on demand.
const RECENT_CANDIDATE_WINDOW_MS = 72 * 60 * 60 * 1000;

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

// Ready smart accounts (app DB) that have no active yield position (yield DB).
// Newest accounts first: fresh signups are where confirms get lost.
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
        eq(appUserSmartAccounts.solanaEnv, solanaEnv),
        ...(fullScan
          ? []
          : [
              gte(
                appUserSmartAccounts.updatedAt,
                new Date(Date.now() - RECENT_CANDIDATE_WINDOW_MS)
              ),
            ])
      )
    )
    .orderBy(desc(appUserSmartAccounts.updatedAt));

  const activeRows = await getYieldOptimizationClient()
    .db.selectDistinct({ walletAddress: userYieldPositions.walletAddress })
    .from(userYieldPositions)
    .where(eq(userYieldPositions.status, "active"));
  const activeWallets = new Set(activeRows.map((row) => row.walletAddress));

  return readyAccounts.filter(
    (row): row is Candidate =>
      Boolean(row.settingsPda) &&
      Boolean(row.walletAddress) &&
      !activeWallets.has(row.walletAddress)
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
};

// The deposit tx is the oldest successful tx on the vault's USDC ATA whose
// parsed token deltas debit USDC from the wallet (preferred) or, failing that,
// from the vault side. This is exactly the debit `recordConfirmedEarnDeposit`
// re-verifies, so a discovered tx is guaranteed to satisfy the recorder.
async function discoverDepositTransaction(args: {
  connection: Connection;
  usdcMint: string;
  vault: PublicKey;
  wallet: string;
}): Promise<DiscoveredDeposit | null> {
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    new PublicKey(args.usdcMint),
    args.vault,
    true
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
    if (entry.err !== null) {
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
    const deltas = tokenDeltasByOwner(args.usdcMint, transaction);
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

type DecodedPolicy = ReturnType<typeof Policy.fromAccountInfo>[0];

function publicKeysEqual(
  actual: readonly PublicKey[],
  expected: readonly PublicKey[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key.equals(expected[index]!))
  );
}

function matchesPubkeyAccountConstraints(
  instruction: generated.InstructionConstraint,
  expected: ReadonlyArray<{
    accountIndex: number;
    owner?: PublicKey;
    pubkeys: readonly PublicKey[];
  }>
): boolean {
  if (instruction.accountConstraints.length !== expected.length) {
    return false;
  }
  return expected.every((specification) => {
    const constraint = instruction.accountConstraints.find(
      (candidate) => candidate.accountIndex === specification.accountIndex
    );
    if (
      !constraint ||
      constraint.accountConstraint.__kind !== "Pubkey" ||
      !publicKeysEqual(
        constraint.accountConstraint.fields[0],
        specification.pubkeys
      )
    ) {
      return false;
    }
    if (specification.owner) {
      return constraint.owner?.equals(specification.owner) === true;
    }
    return constraint.owner === null;
  });
}

function matchesDataSliceEquals(
  instruction: generated.InstructionConstraint,
  expected: readonly number[]
): boolean {
  const [constraint] = instruction.dataConstraints;
  return (
    instruction.dataConstraints.length === 1 &&
    constraint !== undefined &&
    toBigInt(constraint.dataOffset) === BigInt(0) &&
    constraint.operator === generated.DataOperator.Equals &&
    constraint.dataValue.__kind === "U8Slice" &&
    Buffer.from(constraint.dataValue.fields[0]).equals(Buffer.from(expected))
  );
}

function canonicalPolicyBaseMismatch(args: {
  expectedSeed: bigint;
  expectedSettings: PublicKey;
  expectedSigner: PublicKey;
  policy: DecodedPolicy;
}): string | null {
  if (!args.policy.settings.equals(args.expectedSettings)) {
    return "settings_mismatch";
  }
  if (toBigInt(args.policy.seed) !== args.expectedSeed) {
    return "seed_mismatch";
  }
  if (args.policy.threshold !== 1) {
    return "threshold_mismatch";
  }
  if (args.policy.timeLock !== 0) {
    return "timelock_mismatch";
  }
  if (
    args.policy.signers.length !== 1 ||
    !args.policy.signers[0]?.key.equals(args.expectedSigner)
  ) {
    return "signer_mismatch";
  }
  const expectedPermissions =
    Permission.Initiate | Permission.Vote | Permission.Execute;
  if (args.policy.signers[0].permissions.mask !== expectedPermissions) {
    return "signer_permissions_mismatch";
  }
  return null;
}

function canonicalEarnPolicyStateMismatch(args: {
  cluster: LoyalCluster;
  policy: DecodedPolicy;
  stage: "route" | "setup";
  vault: PublicKey;
}): string | null {
  const state = args.policy.policyState;
  if (state.__kind !== "ProgramInteraction") {
    return "policy_state_mismatch";
  }
  const [interaction] = state.fields;
  if (
    interaction.accountIndex !== EARN_VAULT_INDEX ||
    interaction.preHook !== null ||
    interaction.postHook !== null ||
    interaction.spendingLimits.length !== 0
  ) {
    return "policy_interaction_mismatch";
  }

  const target = getKaminoUsdcEarnTargetForCluster(args.cluster);
  const markets = getRiskBasketMarketsForCluster(args.cluster, RiskBasket.Safe);
  const stableMints = getStablecoinMintsForCluster(args.cluster);

  if (args.stage === "route") {
    const [withdraw, deposit] = interaction.instructionsConstraints;
    if (
      interaction.instructionsConstraints.length !== 2 ||
      !withdraw ||
      !deposit
    ) {
      return "route_constraint_count_mismatch";
    }
    if (
      !withdraw.programId.equals(target.lendProgramId) ||
      !matchesPubkeyAccountConstraints(withdraw, [
        { accountIndex: 0, pubkeys: [args.vault] },
        { accountIndex: 2, pubkeys: markets },
      ]) ||
      !matchesDataSliceEquals(withdraw, target.withdrawDiscriminator)
    ) {
      return "route_withdraw_constraint_mismatch";
    }
    if (
      !deposit.programId.equals(target.lendProgramId) ||
      !matchesPubkeyAccountConstraints(deposit, [
        { accountIndex: 0, pubkeys: [args.vault] },
        { accountIndex: 2, pubkeys: markets },
        {
          accountIndex: 5,
          owner: TOKEN_PROGRAM_ID,
          pubkeys: stableMints,
        },
      ]) ||
      !matchesDataSliceEquals(deposit, target.depositDiscriminator)
    ) {
      return "route_deposit_constraint_mismatch";
    }
    return null;
  }

  const [setup] = interaction.instructionsConstraints;
  if (interaction.instructionsConstraints.length !== 1 || !setup) {
    return "setup_constraint_count_mismatch";
  }
  const obligations = markets.map(
    (market) =>
      PublicKey.findProgramAddressSync(
        [
          Uint8Array.of(KAMINO_VANILLA_OBLIGATION_TAG),
          Uint8Array.of(KAMINO_VANILLA_OBLIGATION_ID),
          args.vault.toBytes(),
          market.toBytes(),
          PublicKey.default.toBytes(),
          PublicKey.default.toBytes(),
        ],
        target.lendProgramId
      )[0]
  );
  const userMetadata = PublicKey.findProgramAddressSync(
    [KAMINO_USER_METADATA_SEED, args.vault.toBytes()],
    target.lendProgramId
  )[0];
  const dataPrefix = [
    ...target.initObligationDiscriminator,
    KAMINO_VANILLA_OBLIGATION_TAG,
    KAMINO_VANILLA_OBLIGATION_ID,
  ];
  if (
    !setup.programId.equals(target.lendProgramId) ||
    !matchesPubkeyAccountConstraints(setup, [
      { accountIndex: 0, pubkeys: [args.vault] },
      { accountIndex: 1, pubkeys: [args.vault] },
      { accountIndex: 2, pubkeys: obligations },
      { accountIndex: 3, pubkeys: markets },
      { accountIndex: 4, pubkeys: [PublicKey.default] },
      { accountIndex: 5, pubkeys: [PublicKey.default] },
      { accountIndex: 6, pubkeys: [userMetadata] },
      { accountIndex: 7, pubkeys: [SYSVAR_RENT_PUBKEY] },
      { accountIndex: 8, pubkeys: [SystemProgram.programId] },
    ]) ||
    !matchesDataSliceEquals(setup, dataPrefix)
  ) {
    return "setup_constraint_mismatch";
  }
  return null;
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

type DiscoveredPolicyPair = {
  routeAccount: PublicKey;
  routeSeed: bigint;
  setupAccount: PublicKey;
  setupSeed: bigint;
  delegatedSigner: string;
};

// Probe policy PDAs at seeds 1..N and classify with the SDK's own codec,
// mirroring smart-account-vaults' discoverEarnYieldRoutingPolicyPairOnChain
// (not exported from the SDK): route policy = ProgramInteraction on vault
// index 1 with 2 instruction constraints; its setup twin sits at seed+1 with 1.
async function discoverPolicyPairOnChain(args: {
  connection: Connection;
  programId: PublicKey;
  settingsPda: PublicKey;
}): Promise<{ pair: DiscoveredPolicyPair } | { pair: null; reason: string }> {
  const seeds = Array.from({ length: POLICY_SEED_PROBE_MAX }, (_, i) => i + 1);
  const addresses = seeds.map(
    (seed) =>
      pda.getPolicyPda({
        programId: args.programId,
        settingsPda: args.settingsPda,
        policySeed: seed,
      })[0]
  );
  const policiesBySeed = new Map<
    number,
    ReturnType<typeof Policy.fromAccountInfo>[0]
  >();
  for (let offset = 0; offset < addresses.length; offset += 100) {
    const chunk = addresses.slice(offset, offset + 100);
    const infos = await args.connection.getMultipleAccountsInfo(chunk, {
      commitment: "confirmed",
    });
    infos.forEach((info, index) => {
      if (!info || !info.owner.equals(args.programId)) {
        return;
      }
      try {
        const [policy] = Policy.fromAccountInfo(info);
        policiesBySeed.set(seeds[offset + index]!, policy);
      } catch {
        // Not a Policy account (different discriminator) — ignore.
      }
    });
  }

  const earnConstraintCount = (
    policy: ReturnType<typeof Policy.fromAccountInfo>[0]
  ): number | null => {
    const state = policy.policyState;
    if (
      state.__kind !== "ProgramInteraction" ||
      state.fields[0].accountIndex !== EARN_VAULT_INDEX
    ) {
      return null;
    }
    return state.fields[0].instructionsConstraints.length;
  };

  const routeSeeds = [...policiesBySeed.entries()]
    .filter(([, policy]) => earnConstraintCount(policy) === 2)
    .map(([seed]) => seed)
    .sort((a, b) => b - a);

  if (routeSeeds.length === 0) {
    return {
      pair: null,
      reason: `no earn route policy found at seeds 1..${POLICY_SEED_PROBE_MAX}`,
    };
  }

  for (const routeSeed of routeSeeds) {
    const setup = policiesBySeed.get(routeSeed + 1);
    if (!setup || earnConstraintCount(setup) !== 1) {
      continue;
    }
    const route = policiesBySeed.get(routeSeed)!;
    if (!route.settings.equals(args.settingsPda)) {
      continue;
    }
    const delegatedSigner = route.signers[0]?.key.toBase58();
    if (!delegatedSigner) {
      return { pair: null, reason: "route policy has no signers" };
    }
    return {
      pair: {
        routeAccount: pda.getPolicyPda({
          programId: args.programId,
          settingsPda: args.settingsPda,
          policySeed: routeSeed,
        })[0],
        routeSeed: toBigInt(route.seed),
        setupAccount: pda.getPolicyPda({
          programId: args.programId,
          settingsPda: args.settingsPda,
          policySeed: routeSeed + 1,
        })[0],
        setupSeed: toBigInt(setup.seed),
        delegatedSigner,
      },
    };
  }

  return {
    pair: null,
    reason:
      "route policy found on-chain but its setup twin (seed+1, 1 constraint) is missing",
  };
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

  const target = getKaminoUsdcEarnTargetForCluster(args.cluster);
  if (
    candidate.targetReserve !== target.reserve.toBase58() ||
    candidate.market !== target.market.toBase58() ||
    candidate.liquidityMint !== target.liquidityMint.toBase58()
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

  let routePolicy: DecodedPolicy;
  let setupPolicy: DecodedPolicy;
  try {
    [routePolicy] = Policy.fromAccountInfo(routeInfo);
    [setupPolicy] = Policy.fromAccountInfo(setupInfo);
  } catch {
    return skip("policy_decode_failed");
  }
  const routeBaseMismatch = canonicalPolicyBaseMismatch({
    expectedSeed: routeSeed,
    expectedSettings: settingsPda,
    expectedSigner: delegatedSigner,
    policy: routePolicy,
  });
  if (routeBaseMismatch) {
    return skip(`route_policy_${routeBaseMismatch}`);
  }
  const setupBaseMismatch = canonicalPolicyBaseMismatch({
    expectedSeed: setupSeed,
    expectedSettings: settingsPda,
    expectedSigner: delegatedSigner,
    policy: setupPolicy,
  });
  if (setupBaseMismatch) {
    return skip(`setup_policy_${setupBaseMismatch}`);
  }
  const routeStateMismatch = canonicalEarnPolicyStateMismatch({
    cluster: args.cluster,
    policy: routePolicy,
    stage: "route",
    vault,
  });
  if (routeStateMismatch) {
    return skip(routeStateMismatch);
  }
  const setupStateMismatch = canonicalEarnPolicyStateMismatch({
    cluster: args.cluster,
    policy: setupPolicy,
    stage: "setup",
    vault,
  });
  if (setupStateMismatch) {
    return skip(setupStateMismatch);
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
    liquidityMint: target.liquidityMint.toBase58(),
    market: target.market.toBase58(),
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
    targetReserve: target.reserve.toBase58(),
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
  usdcMint: string;
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

  // 2. Idle-only wallets are not representable: ConfirmedYieldDepositInput has
  // no idle target — recording one would fabricate a reserve holding.
  const reserveHoldings = snapshot.holdings
    .filter(
      (holding): holding is EarnRpcHolding & { reserve: string } =>
        holding.kind === "kamino" &&
        holding.reserve !== null &&
        BigInt(holding.amountRaw) > BigInt(0)
    )
    .sort((a, b) => (BigInt(a.amountRaw) > BigInt(b.amountRaw) ? -1 : 1));
  if (reserveHoldings.length === 0) {
    return skip("idle_only_not_representable");
  }
  const target = reserveHoldings[0]!;
  if (target.liquidityMint !== args.usdcMint) {
    return skip(`target_liquidity_mint_not_usdc: ${target.liquidityMint}`);
  }
  if (!target.market || !args.safeMarkets.has(target.market)) {
    return skip(
      `target_market_not_in_safe_universe: ${target.market ?? "null"}`
    );
  }

  // 3. Already adopted? (Policy rows present ⇒ the read paths see the wallet.)
  const existingPair = await findActiveYieldRoutePolicyPair({
    authority: candidate.walletAddress,
    cluster,
    settings: candidate.settingsPda,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: vault.toBase58(),
  });
  if (existingPair) {
    return skip("db_policy_pair_exists");
  }

  // 4. Recover the on-chain policy pair and its creation signatures.
  const discovery = await discoverPolicyPairOnChain({
    connection: args.connection,
    programId: args.programId,
    settingsPda,
  });
  if (!discovery.pair) {
    return skip(`no_policy_pair_on_chain: ${discovery.reason}`);
  }
  const pair = discovery.pair;
  if (pair.setupSeed !== pair.routeSeed + BigInt(1)) {
    return skip("policy_seed_mismatch");
  }
  const routeCreation = await resolvePolicyCreationSignatureFromChain({
    cluster: args.solanaEnv,
    policyAccount: pair.routeAccount.toBase58(),
  });
  const setupCreation = await resolvePolicyCreationSignatureFromChain({
    cluster: args.solanaEnv,
    policyAccount: pair.setupAccount.toBase58(),
  });
  if (!routeCreation || !setupCreation) {
    return skip("policy_creation_signature_not_found");
  }

  // 5. Deposit signature + slot from the vault USDC ATA history.
  const deposit = await discoverDepositTransaction({
    connection: args.connection,
    usdcMint: args.usdcMint,
    vault,
    wallet: candidate.walletAddress,
  });
  if (!deposit) {
    return skip("deposit_transaction_not_found");
  }

  // 6. Build the canonical confirm body exactly as the mobile confirm route
  // would have and replay it through the validating recorder.
  const confirmBody = {
    cluster,
    confirmedSlot: deposit.slot.toString(),
    delegatedSigner: pair.delegatedSigner,
    depositMint: args.usdcMint,
    depositSignature: deposit.signature,
    liquidityMint: target.liquidityMint,
    market: target.market,
    policyAccount: pair.routeAccount.toBase58(),
    policyId: pair.routeSeed.toString(),
    policyConfirmedSlot: routeCreation.slot,
    policyInitialization: "create",
    policySeed: pair.routeSeed.toString(),
    policySignature: routeCreation.signature,
    principalAmountRaw: deposit.proofPrincipalRaw.toString(),
    settings: candidate.settingsPda,
    setupPolicyAccount: pair.setupAccount.toBase58(),
    setupPolicyConfirmedSlot: setupCreation.slot,
    setupPolicyId: pair.setupSeed.toString(),
    setupPolicySeed: pair.setupSeed.toString(),
    setupPolicySignature: setupCreation.signature,
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
  const usdcMint = getStablecoinMintForCluster(
    cluster,
    Stablecoin.USDC
  ).toBase58();
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
          usdcMint,
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
