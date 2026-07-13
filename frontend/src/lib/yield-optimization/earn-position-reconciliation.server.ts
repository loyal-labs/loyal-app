import "server-only";

import {
  KAMINO_VANILLA_OBLIGATION_ID,
  KAMINO_VANILLA_OBLIGATION_TAG,
  LoyalCluster,
  RiskBasket,
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
} from "@loyal-labs/actions";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  parseKaminoObligationAccount,
  parseKaminoObligationDepositedCollateralAmountRaw,
  parseKaminoReserveTokenAccounts,
  parseKaminoReserveSnapshot,
  resolveEarnUsdcVaultTokenAccounts,
} from "@loyal-labs/smart-account-vaults";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type {
  AccountInfo,
  Commitment,
  Connection,
  GetMultipleAccountsConfig,
} from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import {
  findActiveManagedYieldVaultWithPolicy,
  findCurrentNonzeroYieldVaultReservePositions,
  findReconciledActiveYieldPositionForVault,
  recordSnapshotReconciledYieldHolding,
  recordReconciledYieldVaultSnapshot,
  type CurrentYieldVaultReservePositionRecord,
  type ReconciledYieldVaultReservePositionInput,
} from "./yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;
const EARN_MAINNET_CLUSTER = LoyalCluster.MainnetBeta;
const EARN_MAINNET_TARGET = getKaminoUsdcEarnTargetForCluster(
  EARN_MAINNET_CLUSTER
);
const RECONCILE_CACHE_MS = 5 * 60 * 1000;
const SOURCE_COMMITMENT = "confirmed";

type ReconcileStatus = "cached" | "missing" | "refreshed";

export type EarnPositionReconciliationResult = {
  lastReconciledAt: string | null;
  lastReconciledSlot: string | null;
  positionId: string | null;
  status: ReconcileStatus;
};

type ReconciliationDependencies = {
  now: () => Date;
};

type ReconcileEarnVaultPositionInput = {
  authority: string;
  cluster: Parameters<typeof getKaminoUsdcEarnTargetForCluster>[0];
  connection: Pick<Connection, "getMultipleAccountsInfoAndContext">;
  force?: boolean;
  // When set, the chain read demands a node at or past this slot so a lagging
  // node cannot feed pre-confirmation account state into the reconciled write.
  minContextSlot?: number;
  // Routine reads preserve a last-known-positive fallback when an RPC account
  // is temporarily unavailable. Post-withdraw reconciliation runs only after
  // an independent zero proof and must fail before writing if a positive
  // obligation cannot be valued from its reserve account.
  purpose?: "routine" | "post_withdrawal_zero_proof";
  settings: string;
  vaultPubkey: string;
};

type ReserveCandidate = {
  borrowApyBps: bigint | null;
  liquidityMint: string;
  market: string | null;
  planningMetadata: Record<string, unknown>;
  reserve: string;
  supplyApyBps: bigint | null;
};

type ReconciledReserveCandidate = {
  candidate: ReserveCandidate;
  obligation: PublicKey | null;
  obligationAccount: AccountInfo<Buffer> | null;
  reserveAccount: AccountInfo<Buffer> | null;
  reserveCollateralMint: PublicKey | null;
};

function isFresh(lastReconciledAt: Date | null, now: Date): boolean {
  return (
    lastReconciledAt !== null &&
    now.getTime() - lastReconciledAt.getTime() < RECONCILE_CACHE_MS
  );
}

function publicKeyOrNull(value: string | null): PublicKey | null {
  if (!value) {
    return null;
  }

  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function decodeTokenAccountAmount(args: {
  account: AccountInfo<Buffer> | null;
  expectedMint?: PublicKey;
  expectedOwner: PublicKey;
}): bigint {
  if (!args.account || !args.account.owner.equals(TOKEN_PROGRAM_ID)) {
    return BigInt(0);
  }

  const decoded = AccountLayout.decode(args.account.data);
  if (!decoded.owner.equals(args.expectedOwner)) {
    return BigInt(0);
  }
  if (args.expectedMint && !decoded.mint.equals(args.expectedMint)) {
    return BigInt(0);
  }

  return BigInt(decoded.amount.toString());
}

function deriveKaminoVanillaObligation(args: {
  lendProgramId: PublicKey;
  market: PublicKey;
  vaultPda: PublicKey;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Uint8Array.of(KAMINO_VANILLA_OBLIGATION_TAG),
      Uint8Array.of(KAMINO_VANILLA_OBLIGATION_ID),
      args.vaultPda.toBytes(),
      args.market.toBytes(),
      PublicKey.default.toBytes(),
      PublicKey.default.toBytes(),
    ],
    args.lendProgramId
  )[0];
}

function buildReserveCandidates(args: {
  currentRows: CurrentYieldVaultReservePositionRecord[];
  position: Awaited<
    ReturnType<typeof findReconciledActiveYieldPositionForVault>
  >;
}): ReserveCandidate[] {
  const candidates = new Map<string, ReserveCandidate>();
  const canonical = EARN_MAINNET_TARGET;

  const add = (candidate: ReserveCandidate) => {
    candidates.set(candidate.reserve, candidate);
  };

  add({
    borrowApyBps: null,
    liquidityMint: canonical.liquidityMint.toBase58(),
    market: canonical.market.toBase58(),
    planningMetadata: { source: "canonical_earn_target" },
    reserve: canonical.reserve.toBase58(),
    supplyApyBps: null,
  });

  if (args.position) {
    add({
      borrowApyBps: null,
      liquidityMint: args.position.currentLiquidityMint,
      market: args.position.currentMarket,
      planningMetadata: { source: "user_yield_positions" },
      reserve: args.position.currentReserve,
      supplyApyBps: null,
    });
  }

  for (const row of args.currentRows) {
    add({
      borrowApyBps: row.borrowApyBps,
      liquidityMint: row.liquidityMint,
      market: row.market,
      planningMetadata: row.planningMetadata,
      reserve: row.reserve,
      supplyApyBps: row.supplyApyBps,
    });
  }

  return [...candidates.values()];
}

// The Safe markets this policy may route into. The candidate list above only
// covers reserves we have ALREADY recorded, so a market the optimizer
// rebalanced into is invisible to it — and its funds then read as zero. Deriving
// an obligation for every allowed market lets the chain tell us where the money
// actually is, the same universe `fetchEarnRpcHoldingsSnapshot` scans.
function resolvePolicySafeMarkets(args: {
  cluster: Parameters<typeof getRiskBasketMarketsForCluster>[0];
  policy: { kaminoMarkets?: string[] | null };
}): PublicKey[] {
  const safeMarkets = new Set(
    getRiskBasketMarketsForCluster(args.cluster, RiskBasket.Safe).map((market) =>
      market.toBase58()
    )
  );

  return (args.policy.kaminoMarkets ?? []).flatMap((market) => {
    if (!safeMarkets.has(market)) {
      return [];
    }
    const key = publicKeyOrNull(market);
    return key ? [key] : [];
  });
}

function fallbackRowsAsPositions(
  currentRows: CurrentYieldVaultReservePositionRecord[]
): ReconciledYieldVaultReservePositionInput[] {
  return currentRows.map((row) => ({
    amountRaw: row.amountRaw,
    borrowApyBps: row.borrowApyBps,
    hasValue: row.hasValue,
    liquidityMint: row.liquidityMint,
    market: row.market,
    planningMetadata: {
      ...row.planningMetadata,
      reconciliationFallback: true,
    },
    reserve: row.reserve,
    supplyApyBps: row.supplyApyBps,
  }));
}

export async function reconcileEarnVaultPosition(
  input: ReconcileEarnVaultPositionInput,
  dependencies: ReconciliationDependencies = { now: () => new Date() }
): Promise<EarnPositionReconciliationResult> {
  const now = dependencies.now();
  const managed = await findActiveManagedYieldVaultWithPolicy({
    authority: input.authority,
    cluster: input.cluster,
    settings: input.settings,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: input.vaultPubkey,
  });

  if (!managed) {
    return {
      lastReconciledAt: null,
      lastReconciledSlot: null,
      positionId: null,
      status: "missing",
    };
  }

  const position = await findReconciledActiveYieldPositionForVault({
    cluster: input.cluster,
    settings: input.settings,
    vaultIndex: EARN_VAULT_INDEX,
    walletAddress: input.authority,
  });
  if (!position) {
    return {
      lastReconciledAt: managed.vault.lastReconciledAt?.toISOString() ?? null,
      lastReconciledSlot: managed.vault.lastReconciledSlot?.toString() ?? null,
      positionId: null,
      status: "missing",
    };
  }

  if (!input.force && isFresh(managed.vault.lastReconciledAt, now)) {
    return {
      lastReconciledAt: managed.vault.lastReconciledAt?.toISOString() ?? null,
      lastReconciledSlot: managed.vault.lastReconciledSlot?.toString() ?? null,
      positionId: position.id.toString(),
      status: "cached",
    };
  }

  const vaultPda = new PublicKey(input.vaultPubkey);
  const currentRows = await findCurrentNonzeroYieldVaultReservePositions({
    cluster: input.cluster,
    settings: input.settings,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.authority,
  });
  const candidates = buildReserveCandidates({
    currentRows,
    position,
  });
  const canonicalAccounts = resolveEarnUsdcVaultTokenAccounts({
    cluster: EARN_MAINNET_CLUSTER,
    vaultPda,
  });
  const lendProgramId = EARN_MAINNET_TARGET.lendProgramId;
  const readConfig: Commitment | GetMultipleAccountsConfig =
    input.minContextSlot !== undefined
      ? { commitment: SOURCE_COMMITMENT, minContextSlot: input.minContextSlot }
      : SOURCE_COMMITMENT;
  const obligationForMarket = (market: PublicKey) =>
    deriveKaminoVanillaObligation({ lendProgramId, market, vaultPda });

  const accountKeys: PublicKey[] = [];
  const requestedKeys = new Set<string>();
  const requestKey = (key: PublicKey) => {
    const text = key.toBase58();
    if (requestedKeys.has(text)) {
      return;
    }
    requestedKeys.add(text);
    accountKeys.push(key);
  };

  for (const candidate of candidates) {
    const reserve = publicKeyOrNull(candidate.reserve);
    const market = publicKeyOrNull(candidate.market);
    if (!reserve || !market) {
      continue;
    }
    requestKey(reserve);
    requestKey(obligationForMarket(market));
  }
  // Discovery rides along in the SAME batch: an allowed market whose obligation
  // a candidate already covers dedupes away, so the common single-market vault
  // reads exactly the accounts it read before.
  const policySafeMarkets = resolvePolicySafeMarkets({
    cluster: input.cluster,
    policy: managed.routePolicy,
  });
  for (const market of policySafeMarkets) {
    requestKey(obligationForMarket(market));
  }
  requestKey(canonicalAccounts.usdcAta);

  const { context: reserveContext, value: reserveValues } =
    await input.connection.getMultipleAccountsInfoAndContext(
      accountKeys,
      readConfig
    );
  const accountByKey = new Map<string, AccountInfo<Buffer> | null>();
  accountKeys.forEach((key, index) => {
    accountByKey.set(key.toBase58(), reserveValues[index] ?? null);
  });
  const accountFor = (key: PublicKey | null) =>
    key ? accountByKey.get(key.toBase58()) ?? null : null;
  const idleAmountRaw = decodeTokenAccountAmount({
    account: accountFor(canonicalAccounts.usdcAta),
    expectedMint: canonicalAccounts.targetReserve.liquidityMint,
    expectedOwner: vaultPda,
  });

  // Reserves the vault holds in a policy market we have never recorded. Their
  // exchange rate needs a second read, so this only costs an extra round trip
  // when a market actually went missing from the read-model.
  const knownReserves = new Set(candidates.map((candidate) => candidate.reserve));
  const discoveredCandidates: ReserveCandidate[] = [];
  for (const market of policySafeMarkets) {
    const obligationAccount = accountFor(obligationForMarket(market));
    if (!obligationAccount || !obligationAccount.owner.equals(lendProgramId)) {
      continue;
    }

    const parsedObligation = parseKaminoObligationAccount(
      obligationAccount.data
    );
    if (
      !parsedObligation.owner.equals(vaultPda) ||
      !parsedObligation.lendingMarket.equals(market)
    ) {
      continue;
    }

    for (const deposit of parsedObligation.deposits) {
      const reserve = deposit.reserve.toBase58();
      if (
        knownReserves.has(reserve) ||
        deposit.depositedAmountRaw <= BigInt(0)
      ) {
        continue;
      }

      knownReserves.add(reserve);
      discoveredCandidates.push({
        borrowApyBps: null,
        liquidityMint: canonicalAccounts.targetReserve.liquidityMint.toBase58(),
        market: market.toBase58(),
        planningMetadata: { source: "policy_market_discovery" },
        reserve,
        supplyApyBps: null,
      });
    }
  }

  if (discoveredCandidates.length > 0) {
    const discoveredReserveKeys = discoveredCandidates.map(
      (candidate) => new PublicKey(candidate.reserve)
    );
    const { value: discoveredReserveValues } =
      await input.connection.getMultipleAccountsInfoAndContext(
        discoveredReserveKeys,
        readConfig
      );
    discoveredReserveKeys.forEach((key, index) => {
      accountByKey.set(key.toBase58(), discoveredReserveValues[index] ?? null);
    });
  }

  // An unreadable reserve keeps its candidate: dropping it here would hide a
  // positive obligation from the post-withdrawal zero proof's fail-closed check
  // below. A readable reserve for some other liquidity is not ours — drop it.
  const usdcCandidates = discoveredCandidates.filter((candidate) => {
    const reserveAccount = accountFor(new PublicKey(candidate.reserve));
    if (!reserveAccount) {
      return true;
    }

    return parseKaminoReserveTokenAccounts(
      reserveAccount.data
    ).reserveLiquidityMint?.equals(canonicalAccounts.targetReserve.liquidityMint);
  });
  const reconciledCandidates: ReconciledReserveCandidate[] = [
    ...candidates,
    ...usdcCandidates,
  ].map((candidate) => {
    const market = publicKeyOrNull(candidate.market);
    const obligation = market ? obligationForMarket(market) : null;
    const reserveAccount = accountFor(publicKeyOrNull(candidate.reserve));
    const obligationAccount = accountFor(obligation);
    const reserveTokenAccounts = reserveAccount
      ? parseKaminoReserveTokenAccounts(reserveAccount.data)
      : null;

    return {
      candidate,
      obligation,
      obligationAccount,
      reserveAccount,
      reserveCollateralMint:
        reserveTokenAccounts?.reserveCollateralMint ?? null,
    };
  });

  // The obligations and the idle ATA — everything that defines a balance — come
  // from the first read; a discovered reserve only contributes its exchange
  // rate, so this slot stays the honest observation point.
  const observedSlot = BigInt(reserveContext.slot);

  const positions = reconciledCandidates.map((reconciled) => {
    const { candidate, obligation, obligationAccount, reserveAccount } =
      reconciled;
    const canUseReserveFallback = Boolean(reserveAccount && obligationAccount);
    const fallbackRow = canUseReserveFallback
      ? currentRows.find(
          (row) =>
            row.reserve === candidate.reserve && row.amountRaw > BigInt(0)
        )
      : null;
    const positionFallbackRaw =
      canUseReserveFallback && position?.currentReserve === candidate.reserve
        ? position.currentAmountRaw > idleAmountRaw
          ? position.currentAmountRaw - idleAmountRaw
          : BigInt(0)
        : BigInt(0);
    const obligationCollateralAmountRaw = obligationAccount
      ? parseKaminoObligationDepositedCollateralAmountRaw({
          data: obligationAccount.data,
          reserve: new PublicKey(candidate.reserve),
        })
      : BigInt(0);
    if (
      input.purpose === "post_withdrawal_zero_proof" &&
      obligationCollateralAmountRaw > BigInt(0) &&
      !reserveAccount
    ) {
      throw new Error(
        "Kamino reserve account is unavailable for a positive Earn obligation."
      );
    }
    const measuredAmountRaw =
      reserveAccount && obligationAccount
        ? calculateKaminoRedeemableLiquidityAmountRaw({
            collateralAmountRaw: obligationCollateralAmountRaw,
            snapshot: parseKaminoReserveSnapshot(reserveAccount.data),
          })
        : BigInt(0);
    const amountRaw =
      measuredAmountRaw > BigInt(0)
        ? measuredAmountRaw
        : input.purpose === "post_withdrawal_zero_proof"
        ? BigInt(0)
        : fallbackRow?.amountRaw ?? positionFallbackRaw;
    const reconciliationFallback =
      measuredAmountRaw <= BigInt(0) && amountRaw > BigInt(0)
        ? reserveAccount && obligationAccount
          ? "confirmed_position_or_current_row"
          : "missing_reserve_or_obligation_account"
        : null;

    return {
      amountRaw,
      borrowApyBps: candidate.borrowApyBps,
      hasValue: amountRaw > BigInt(0),
      liquidityMint: candidate.liquidityMint,
      market: candidate.market,
      planningMetadata: {
        ...candidate.planningMetadata,
        amountSemantics: "kamino_redeemable_liquidity",
        measuredAmountRaw: measuredAmountRaw.toString(),
        obligation: obligation?.toBase58() ?? null,
        obligationCollateralAmountRaw: obligationCollateralAmountRaw.toString(),
        reconciliationFallback,
        reserveCollateralMint:
          reconciled.reserveCollateralMint?.toBase58() ?? null,
        sourceCommitment: SOURCE_COMMITMENT,
      },
      reserve: candidate.reserve,
      supplyApyBps: candidate.supplyApyBps,
    };
  });
  const reservePositions =
    positions.length > 0 ? positions : fallbackRowsAsPositions(currentRows);

  const { snapshotId } = await recordReconciledYieldVaultSnapshot({
    chainSlot: observedSlot,
    context: {
      source: "frontend_position_reconcile",
      purpose: input.purpose ?? "routine",
      sourceCommitment: SOURCE_COMMITMENT,
      discoveredReserveCount: reconciledCandidates.length - candidates.length,
    },
    idleTokenBalance: {
      amountRaw: idleAmountRaw,
      mint: canonicalAccounts.targetReserve.liquidityMint.toBase58(),
      owner: input.vaultPubkey,
      tokenAccount: canonicalAccounts.usdcAta.toBase58(),
    },
    observedAt: now,
    observedSlot,
    policyId: managed.vault.activePolicyId,
    positions: reservePositions,
    sourceCommitment: SOURCE_COMMITMENT,
    vaultId: managed.vault.id,
  });

  const reconciledTotalAmountRaw =
    reservePositions.reduce((sum, row) => sum + row.amountRaw, BigInt(0)) +
    idleAmountRaw;
  const primaryReservePosition = reservePositions.find(
    (row) => row.amountRaw > BigInt(0)
  ) ??
    reservePositions[0] ?? {
      liquidityMint: canonicalAccounts.targetReserve.liquidityMint.toBase58(),
      market: canonicalAccounts.targetReserve.market.toBase58(),
      reserve: canonicalAccounts.targetReserve.reserve.toBase58(),
    };

  await recordSnapshotReconciledYieldHolding({
    amountRaw: reconciledTotalAmountRaw,
    cluster: input.cluster,
    liquidityMint: primaryReservePosition.liquidityMint,
    market: primaryReservePosition.market,
    observedAt: now,
    observedSlot,
    positionId: position.id,
    reserve: primaryReservePosition.reserve,
    sourceSnapshotId: snapshotId,
  });

  return {
    lastReconciledAt: now.toISOString(),
    lastReconciledSlot: observedSlot.toString(),
    positionId: position.id.toString(),
    status: "refreshed",
  };
}
