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
import { Policy, toBigInt } from "@loyal-labs/loyal-smart-accounts-core";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";
import { and, desc, eq, gte } from "drizzle-orm";

import { reportEarnDepositQuestCompletion } from "@/features/solana-week/server/quest-completion-service";
import { getServerEnv } from "@/lib/core/config/server";
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
import { findActiveYieldRoutePolicyPair } from "./yield-deposit-repository.server";
import {
  getYieldOptimizationClient,
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

export type EarnDepositReconcileSummary = {
  candidates: number;
  scanned: number;
  adopted: EarnDepositReconcileOutcome[];
  skipped: number;
  errors: number;
  truncated: boolean;
  dryRun: boolean;
};

type Candidate = { walletAddress: string; settingsPda: string };

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
    return skip(`target_market_not_in_safe_universe: ${target.market ?? "null"}`);
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
  timeBudgetMs?: number;
}): Promise<EarnDepositReconcileSummary> {
  const dryRun = args?.dryRun ?? false;
  const fullScan = args?.fullScan ?? false;
  const deadline = Date.now() + (args?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
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

  const candidates = await listCandidates(solanaEnv, fullScan);
  const summary: EarnDepositReconcileSummary = {
    candidates: candidates.length,
    scanned: 0,
    adopted: [],
    skipped: 0,
    errors: 0,
    truncated: false,
    dryRun,
  };

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
  await Promise.all(
    Array.from({ length: SCAN_CONCURRENCY }, () => worker())
  );

  if (summary.truncated) {
    console.warn("[earn-deposit-reconcile] time budget hit before full scan", {
      candidates: summary.candidates,
      scanned: summary.scanned,
    });
  }
  return summary;
}
