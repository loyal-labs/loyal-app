import "server-only";

import { getKaminoUsdcEarnTargetForCluster } from "@loyal-labs/actions";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  parseKaminoReserveTokenAccounts,
  parseKaminoReserveSnapshot,
  resolveEarnUsdcVaultTokenAccounts,
  type SmartAccountEarnUsdcReserveTargetInput,
} from "@loyal-labs/smart-account-vaults";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { AccountInfo, Connection } from "@solana/web3.js";
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
  settings: string;
  vaultPubkey: string;
};

type ReserveCandidate = {
  borrowApyBps: bigint | null;
  collateralAta: PublicKey | null;
  liquidityMint: string;
  market: string | null;
  planningMetadata: Record<string, unknown>;
  reserve: string;
  supplyApyBps: bigint | null;
};

type ReconciledReserveCandidate = {
  candidate: ReserveCandidate;
  collateralAta: PublicKey;
  reserveAccount: AccountInfo<Buffer>;
  reserveCollateralMint: PublicKey;
};

function isFresh(lastReconciledAt: Date | null, now: Date): boolean {
  return (
    lastReconciledAt !== null &&
    now.getTime() - lastReconciledAt.getTime() < RECONCILE_CACHE_MS
  );
}

function toStringMetadataValue(
  metadata: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
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

function reserveTargetFromCandidate(
  candidate: ReserveCandidate
): SmartAccountEarnUsdcReserveTargetInput {
  const reserveCollateralMint = publicKeyOrNull(
    toStringMetadataValue(candidate.planningMetadata, [
      "reserveCollateralMint",
      "reserve_collateral_mint",
      "collateralMint",
      "collateral_mint",
    ])
  );

  return {
    liquidityMint: new PublicKey(candidate.liquidityMint),
    market: new PublicKey(candidate.market ?? PublicKey.default.toBase58()),
    reserve: new PublicKey(candidate.reserve),
    ...(reserveCollateralMint ? { reserveCollateralMint } : {}),
    supplyApyBps: candidate.supplyApyBps,
  };
}

function deriveCollateralAta(args: {
  candidate: ReserveCandidate;
  cluster: ReconcileEarnVaultPositionInput["cluster"];
  vaultPda: PublicKey;
}): PublicKey | null {
  const metadataAta = publicKeyOrNull(
    toStringMetadataValue(args.candidate.planningMetadata, [
      "vaultCollateralAta",
      "vault_collateral_ata",
      "collateralAta",
      "collateral_ata",
    ])
  );
  if (metadataAta) {
    return metadataAta;
  }

  const target = reserveTargetFromCandidate(args.candidate);
  const accounts = resolveEarnUsdcVaultTokenAccounts({
    cluster: args.cluster,
    target,
    vaultPda: args.vaultPda,
  });
  return accounts.collateralAta;
}

function buildReserveCandidates(args: {
  currentRows: CurrentYieldVaultReservePositionRecord[];
  position: Awaited<
    ReturnType<typeof findReconciledActiveYieldPositionForVault>
  >;
  cluster: ReconcileEarnVaultPositionInput["cluster"];
  vaultPda: PublicKey;
}): ReserveCandidate[] {
  const candidates = new Map<string, ReserveCandidate>();
  const canonical = getKaminoUsdcEarnTargetForCluster(args.cluster);

  const add = (candidate: Omit<ReserveCandidate, "collateralAta">) => {
    const withAta: ReserveCandidate = {
      ...candidate,
      collateralAta: deriveCollateralAta({
        candidate: { ...candidate, collateralAta: null },
        cluster: args.cluster,
        vaultPda: args.vaultPda,
      }),
    };
    candidates.set(withAta.reserve, withAta);
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
    cluster: input.cluster,
    currentRows,
    position,
    vaultPda,
  });
  const canonicalAccounts = resolveEarnUsdcVaultTokenAccounts({
    cluster: input.cluster,
    vaultPda,
  });
  const accountKeys = [
    ...candidates.map((candidate) => new PublicKey(candidate.reserve)),
    canonicalAccounts.usdcAta,
  ];
  const { context: reserveContext, value: reserveValues } =
    await input.connection.getMultipleAccountsInfoAndContext(
      accountKeys,
      SOURCE_COMMITMENT
    );
  const idleAccount = reserveValues[reserveValues.length - 1] ?? null;

  const reconciledCandidates: ReconciledReserveCandidate[] = candidates.map(
    (candidate, index) => {
      const reserveAccount = reserveValues[index] ?? null;
      if (!reserveAccount) {
        throw new Error(
          `Kamino reserve account ${candidate.reserve} was not found.`
        );
      }
      const reserveTokenAccounts = parseKaminoReserveTokenAccounts(
        reserveAccount.data
      );
      const collateralAta =
        candidate.collateralAta ??
        getAssociatedTokenAddressSync(
          reserveTokenAccounts.reserveCollateralMint,
          vaultPda,
          true,
          TOKEN_PROGRAM_ID
        );
      return {
        candidate,
        collateralAta,
        reserveAccount,
        reserveCollateralMint: reserveTokenAccounts.reserveCollateralMint,
      };
    }
  );

  const { context: collateralContext, value: collateralValues } =
    reconciledCandidates.length > 0
      ? await input.connection.getMultipleAccountsInfoAndContext(
          reconciledCandidates.map((candidate) => candidate.collateralAta),
          SOURCE_COMMITMENT
        )
      : { context: reserveContext, value: [] };
  const observedSlot = BigInt(
    Math.max(reserveContext.slot, collateralContext.slot)
  );

  const positions = reconciledCandidates.map((reconciled, index) => {
    const { candidate, collateralAta, reserveAccount, reserveCollateralMint } =
      reconciled;
    const collateralAccount = collateralValues[index] ?? null;
    const collateralAmountRaw = decodeTokenAccountAmount({
      account: collateralAccount,
      expectedMint: reserveCollateralMint,
      expectedOwner: vaultPda,
    });
    const reserveSnapshot = parseKaminoReserveSnapshot(reserveAccount.data);
    const measuredAmountRaw = calculateKaminoRedeemableLiquidityAmountRaw({
      collateralAmountRaw,
      snapshot: reserveSnapshot,
    });
    const fallbackRow = currentRows.find(
      (row) => row.reserve === candidate.reserve && row.amountRaw > BigInt(0)
    );
    const positionFallbackRaw =
      position?.currentReserve === candidate.reserve
        ? position.currentAmountRaw
        : BigInt(0);
    const amountRaw =
      measuredAmountRaw > BigInt(0)
        ? measuredAmountRaw
        : fallbackRow?.amountRaw ?? positionFallbackRaw;

    return {
      amountRaw,
      borrowApyBps: candidate.borrowApyBps,
      hasValue: amountRaw > BigInt(0),
      liquidityMint: candidate.liquidityMint,
      market: candidate.market,
      planningMetadata: {
        ...candidate.planningMetadata,
        amountSemantics: "kamino_redeemable_liquidity",
        collateralAmountRaw: collateralAmountRaw.toString(),
        measuredAmountRaw: measuredAmountRaw.toString(),
        reconciliationFallback:
          measuredAmountRaw <= BigInt(0) && amountRaw > BigInt(0)
            ? "confirmed_position_or_current_row"
            : null,
        reserveCollateralMint: reserveCollateralMint.toBase58(),
        sourceCommitment: SOURCE_COMMITMENT,
        vaultCollateralAta: collateralAta.toBase58(),
      },
      reserve: candidate.reserve,
      supplyApyBps: candidate.supplyApyBps,
    };
  });
  const reservePositions =
    positions.length > 0 ? positions : fallbackRowsAsPositions(currentRows);
  const idleAmountRaw = decodeTokenAccountAmount({
    account: idleAccount,
    expectedMint: canonicalAccounts.targetReserve.liquidityMint,
    expectedOwner: vaultPda,
  });

  const { snapshotId } = await recordReconciledYieldVaultSnapshot({
    chainSlot: observedSlot,
    context: {
      source: "frontend_position_reconcile",
      sourceCommitment: SOURCE_COMMITMENT,
      skippedReserveCount: candidates.length - reconciledCandidates.length,
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
