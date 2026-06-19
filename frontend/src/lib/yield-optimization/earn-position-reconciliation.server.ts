import "server-only";

import {
  KAMINO_VANILLA_OBLIGATION_ID,
  KAMINO_VANILLA_OBLIGATION_TAG,
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
} from "@loyal-labs/actions";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  parseKaminoObligationDepositedCollateralAmountRaw,
  parseKaminoReserveTokenAccounts,
  parseKaminoReserveSnapshot,
  resolveEarnUsdcVaultTokenAccounts,
} from "@loyal-labs/smart-account-vaults";
import {
  AccountLayout,
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

type CandidateAccountRole = {
  candidateIndex: number;
  kind: "obligation" | "reserve";
  pubkey: PublicKey;
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
  const candidateAccountRoles: CandidateAccountRole[] = candidates.flatMap(
    (candidate, candidateIndex) => {
      const reserve = publicKeyOrNull(candidate.reserve);
      const market = publicKeyOrNull(candidate.market);
      if (!reserve || !market) {
        return [];
      }

      return [
        { candidateIndex, kind: "reserve" as const, pubkey: reserve },
        {
          candidateIndex,
          kind: "obligation" as const,
          pubkey: deriveKaminoVanillaObligation({
            lendProgramId,
            market,
            vaultPda,
          }),
        },
      ];
    }
  );
  const accountKeys = [
    ...candidateAccountRoles.map((role) => role.pubkey),
    canonicalAccounts.usdcAta,
  ];
  const { context: reserveContext, value: reserveValues } =
    await input.connection.getMultipleAccountsInfoAndContext(
      accountKeys,
      SOURCE_COMMITMENT
    );
  const idleAccount = reserveValues[reserveValues.length - 1] ?? null;
  const accountForRole = (role: CandidateAccountRole) =>
    reserveValues[candidateAccountRoles.indexOf(role)] ?? null;
  const idleAmountRaw = decodeTokenAccountAmount({
    account: idleAccount,
    expectedMint: canonicalAccounts.targetReserve.liquidityMint,
    expectedOwner: vaultPda,
  });

  const reconciledCandidates: ReconciledReserveCandidate[] = candidates.map(
    (candidate, candidateIndex) => {
      const reserveRole = candidateAccountRoles.find(
        (role) =>
          role.kind === "reserve" && role.candidateIndex === candidateIndex
      );
      const obligationRole = candidateAccountRoles.find(
        (role) =>
          role.kind === "obligation" && role.candidateIndex === candidateIndex
      );
      const reserveAccount = reserveRole ? accountForRole(reserveRole) : null;
      const obligationAccount = obligationRole
        ? accountForRole(obligationRole)
        : null;
      const reserveTokenAccounts = reserveAccount
        ? parseKaminoReserveTokenAccounts(reserveAccount.data)
        : null;

      return {
        candidate,
        obligation: obligationRole?.pubkey ?? null,
        obligationAccount,
        reserveAccount,
        reserveCollateralMint:
          reserveTokenAccounts?.reserveCollateralMint ?? null,
      };
    }
  );

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
    const obligationCollateralAmountRaw =
      reserveAccount && obligationAccount
        ? parseKaminoObligationDepositedCollateralAmountRaw({
            data: obligationAccount.data,
            reserve: new PublicKey(candidate.reserve),
          })
        : BigInt(0);
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
