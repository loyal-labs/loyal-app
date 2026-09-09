import type {
  EarnPosition,
  EarnProjectedPosition,
  EarnTransactionItem,
} from "./earn-api";

export type EarnAccountingTarget = {
  kind: "deposit" | "withdrawal";
  liquidityMint: string;
  reserve?: string | null;
  positionIds?: string[];
};

const matchesTarget = (
  row: EarnProjectedPosition,
  target: EarnAccountingTarget
) =>
  target.positionIds?.length
    ? target.positionIds.includes(row.id)
    : target.kind === "deposit"
    ? row.liquidityMint === target.liquidityMint &&
      (target.reserve === undefined ||
        row.initialReserveAddress === target.reserve)
    : row.currentLiquidityMint === target.liquidityMint &&
      (target.reserve === undefined ||
        row.currentReserveAddress === target.reserve);

// Capture IDs before sending: rebalances can change the current mint/reserve
// before confirmation reaches the UI. Initial deposit mint is NOT a withdrawal source.
export function bindEarnAccountingTargets(
  targets: EarnAccountingTarget[],
  rows: EarnProjectedPosition[] = []
): EarnAccountingTarget[] {
  return targets.map((target) => ({
    ...target,
    positionIds: rows
      .filter((row) => row.status === "active" && matchesTarget(row, target))
      .map((row) => row.id),
  }));
}

function mutationCovered(
  rows: EarnProjectedPosition[],
  mutation: ConfirmedEarnMutation
) {
  const slot =
    mutation.accountingSlot === undefined
      ? mutation.confirmedSlot
      : mutation.accountingSlot;
  if (!slot || !mutation.accountingTargets?.length) return false;
  return mutation.accountingTargets.every((target) => {
    const relevant = rows.filter(
      (row) =>
        matchesTarget(row, target) &&
        (target.kind === "deposit" ||
          target.positionIds?.length ||
          row.status === "active" ||
          BigInt(row.lastConfirmedSlot) >= BigInt(slot))
    );
    return (
      relevant.length > 0 &&
      (!target.positionIds?.length ||
        target.positionIds.every((id) =>
          relevant.some((row) => row.id === id)
        )) &&
      relevant.every((row) => BigInt(row.lastConfirmedSlot) >= BigInt(slot))
    );
  });
}

// Only emitted after RPC confirmation, once for each landed money-moving stage.
export type ConfirmedEarnMutation = {
  signature: string;
  confirmedSlot: string;
  walletAddress: string;
  settingsPda: string;
  cluster: string;
  deltaAmountRaw: string;
  // null means confirmedSlot is a conservative WS context fence, not the landing slot.
  accountingSlot?: string | null;
  accountingTargets?: EarnAccountingTarget[];
  fullExit?: boolean;
};

export type EarnPositionOverlay = {
  settingsPda: string;
  position: EarnPosition;
  confirmedSlot: string;
  projectedSlot: string | null;
  amountObservedSlot: string | null;
  signatures: string[];
  pending: boolean;
  projectedPositions?: EarnProjectedPosition[];
  mutations?: ConfirmedEarnMutation[];
};

// Idle debits and rebalance races cannot always be mapped from a cached
// current mint/reserve. Immutable signature -> position IDs are definitive;
// their exact slot also resolves a conservative WS confirmation context.
export function resolveEarnMutationAccounting(
  mutation: ConfirmedEarnMutation,
  rows: EarnProjectedPosition[],
  history: Pick<
    EarnTransactionItem,
    "signature" | "positionId" | "transactionSlot" | "kind"
  >[]
): ConfirmedEarnMutation {
  const kind = BigInt(mutation.deltaAmountRaw) > 0n ? "deposit" : "withdraw";
  const events = history.filter(
    (event) => event.signature === mutation.signature && event.kind === kind
  );
  const slot = events[0]?.transactionSlot;
  if (
    !slot ||
    !/^\d+$/.test(slot) ||
    (mutation.accountingSlot === null
      ? BigInt(slot) > BigInt(mutation.confirmedSlot)
      : slot !== (mutation.accountingSlot ?? mutation.confirmedSlot)) ||
    !events.every(
      (event) =>
        event.transactionSlot === slot &&
        event.positionId &&
        rows.some((row) => row.id === event.positionId)
    )
  )
    return mutation;
  return {
    ...mutation,
    accountingSlot: slot,
    accountingTargets: [
      {
        kind: kind === "deposit" ? "deposit" : "withdrawal",
        liquidityMint: "", // IDs from the ledger supersede mutable venue metadata.
        positionIds: [...new Set(events.map((event) => event.positionId!))],
      },
    ],
  };
}

const maxZero = (value: bigint) => (value > 0n ? value : 0n);
export const normalizeEarnCluster = (cluster: string) =>
  cluster === "mainnet" ? "mainnet-beta" : cluster;

export function applyConfirmedEarnMutation(
  previous: EarnPositionOverlay | null,
  position: EarnPosition | null,
  mutation: ConfirmedEarnMutation
): EarnPositionOverlay {
  const sameScope = previous?.settingsPda === mutation.settingsPda;
  const prior = sameScope ? previous : null;
  if (prior?.signatures.includes(mutation.signature)) return prior;
  // A refreshed projection may have already included this transaction before
  // its confirmation callback ran. Never add/subtract it a second time.
  if (mutationCovered(prior?.projectedPositions ?? [], mutation)) {
    if (prior)
      return {
        ...prior,
        signatures: [...prior.signatures, mutation.signature],
      };
  }
  const base = prior?.position ?? (previous && !sameScope ? null : position);
  const delta = BigInt(mutation.deltaAmountRaw);
  const amountAlreadyObserved =
    prior?.amountObservedSlot &&
    BigInt(prior.amountObservedSlot) >= BigInt(mutation.confirmedSlot);
  const amount = amountAlreadyObserved
    ? BigInt(base?.currentAmountRaw ?? "0")
    : mutation.fullExit
    ? 0n
    : maxZero(BigInt(base?.currentAmountRaw ?? "0") + delta);
  const principal = mutation.fullExit
    ? 0n
    : maxZero(BigInt(base?.principalAmountRaw ?? "0") + delta);
  return {
    settingsPda: mutation.settingsPda,
    confirmedSlot:
      prior && BigInt(prior.confirmedSlot) > BigInt(mutation.confirmedSlot)
        ? prior.confirmedSlot
        : mutation.confirmedSlot,
    projectedSlot: prior?.projectedSlot ?? null,
    amountObservedSlot: prior?.amountObservedSlot ?? null,
    signatures: [...(prior?.signatures ?? []), mutation.signature],
    pending: true,
    projectedPositions: prior?.projectedPositions,
    mutations: [...(prior?.mutations ?? []), mutation],
    position: {
      currentAmountRaw: amount.toString(),
      principalAmountRaw: principal.toString(),
      currentSupplyApyBps: base?.currentSupplyApyBps ?? null,
      status: amount > 0n ? "active" : "closed",
    },
  };
}

// Retain the slot high-water even after projection catches up. Otherwise a
// later stale REST response can resurrect a completely withdrawn position.
export function reconcileEarnProjection(args: {
  previous: EarnPositionOverlay | null;
  settingsPda: string;
  position: EarnPosition | null;
  projectedSlot: string | null;
  projectedPositions?: EarnProjectedPosition[];
}): EarnPositionOverlay | null {
  const prior =
    args.previous?.settingsPda === args.settingsPda ? args.previous : null;
  const slot = args.projectedSlot;
  if (args.projectedPositions) {
    const rows = args.projectedPositions;
    // Per-row monotonicity, never MAX across siblings. Closed rows are tombstones.
    for (const old of prior?.projectedPositions ?? []) {
      const row = rows.find((candidate) => candidate.id === old.id);
      if (
        !row ||
        BigInt(row.lastConfirmedSlot) < BigInt(old.lastConfirmedSlot) ||
        BigInt(row.currentObservedSlot) < BigInt(old.currentObservedSlot)
      )
        throw new Error("Earn accounting projection regressed.");
    }
    const mutations = (prior?.mutations ?? []).filter(
      (mutation) => !mutationCovered(rows, mutation)
    );
    if (mutations.length && prior)
      return { ...prior, projectedPositions: rows, mutations, pending: true };
    const position = args.position ?? {
      currentAmountRaw: "0",
      principalAmountRaw: "0",
      currentSupplyApyBps: null,
      status: "closed",
    };
    return {
      settingsPda: args.settingsPda,
      confirmedSlot: prior?.confirmedSlot ?? "0",
      projectedSlot: slot,
      amountObservedSlot: prior?.amountObservedSlot ?? null,
      signatures: prior?.signatures ?? [],
      projectedPositions: rows,
      mutations,
      pending: false,
      position: prior?.amountObservedSlot
        ? { ...position, currentAmountRaw: prior.position.currentAmountRaw }
        : position,
    };
  }
  // Aggregate slots cannot identify which historical rows a transfer affected.
  return prior;
}
