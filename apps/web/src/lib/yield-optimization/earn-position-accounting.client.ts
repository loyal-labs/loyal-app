// Accounting evidence is scoped by the authenticated position endpoint. Closed
// rows must remain present: absence is not proof of a confirmed full exit.
export type EarnProjectedPosition = {
  id: string;
  initialLiquidityMint: string;
  initialReserve: string;
  currentLiquidityMint: string;
  currentReserve: string;
  lastConfirmedSlot: string;
  status: string;
  vaultPubkey: string;
};

export type EarnAccountingTarget = {
  kind: "deposit" | "withdrawal";
  liquidityMint: string;
  reserve: string | null;
  vaultPubkey: string;
  positionIds?: string[];
};

export type EarnPositionMutation = {
  confirmedSlot?: string;
  signature?: string;
  targets: EarnAccountingTarget[];
};

function matchesTarget(row: EarnProjectedPosition, target: EarnAccountingTarget) {
  if (row.vaultPubkey !== target.vaultPubkey) return false;
  if (target.positionIds?.length) return target.positionIds.includes(row.id);
  return target.kind === "deposit"
    ? row.initialLiquidityMint === target.liquidityMint &&
        row.initialReserve === target.reserve
    : row.currentLiquidityMint === target.liquidityMint &&
        (target.reserve === null || row.currentReserve === target.reserve);
}

export function bindEarnAccountingTargets(
  targets: EarnAccountingTarget[],
  rows: EarnProjectedPosition[]
): EarnAccountingTarget[] {
  return targets.map((target) => ({
    ...target,
    // Deposit identity is immutable; a first deposit may have no row yet.
    // Withdrawals bind current sources before sending, surviving rebalances.
    positionIds: target.kind === "withdrawal"
      ? rows.filter((row) => row.status === "active" && matchesTarget(row, target))
          .map((row) => row.id)
      : undefined,
  }));
}

export function isEarnMutationCovered(
  rows: EarnProjectedPosition[],
  mutation: EarnPositionMutation
): boolean {
  const slot = parseEarnConfirmationSlot(mutation.confirmedSlot);
  if (slot === null || !mutation.targets.length) return false;
  return mutation.targets.every((target) => {
    const relevant = rows.filter((row) => matchesTarget(row, target) &&
      (target.kind === "deposit" || target.positionIds?.length ||
        row.status === "active" || BigInt(row.lastConfirmedSlot) >= slot));
    return relevant.length > 0 &&
      (!target.positionIds?.length || target.positionIds.every((id) =>
        relevant.some((row) => row.id === id))) &&
      relevant.every((row) => BigInt(row.lastConfirmedSlot) >= slot);
  });
}

// Only exact transaction evidence can recover a missing confirmation slot.
export function parseEarnConfirmationSlot(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const slot = BigInt(value);
  return slot <= BigInt(Number.MAX_SAFE_INTEGER) ? slot : null;
}

export function recoverEarnMutationEvidence(
  mutation: EarnPositionMutation,
  rows: EarnProjectedPosition[],
  history: unknown
): EarnPositionMutation {
  if (!mutation.signature || !mutation.targets.length ||
    typeof history !== "object" || history === null ||
    !("transactions" in history) || !Array.isArray(history.transactions)) return mutation;
  const events = history.transactions.filter((event: unknown) =>
    typeof event === "object" && event !== null && "signature" in event &&
    event.signature === mutation.signature);
  if (!events.length) return mutation;
  // Legacy history confirmedSlot is the later holding observation, not landing.
  const slot = parseEarnConfirmationSlot(events[0].transactionSlot);
  if (slot === null || (mutation.confirmedSlot !== undefined &&
    parseEarnConfirmationSlot(mutation.confirmedSlot) !== slot)) return mutation;
  // Validate EVERY matching event, not a convenient first row or MAX slot.
  if (!events.every((event) => {
    const row = rows.find((candidate) => candidate.id === event.positionId);
    return row && parseEarnConfirmationSlot(event.transactionSlot) === slot &&
      mutation.targets.some((target) => row.vaultPubkey === target.vaultPubkey &&
        event.kind === (target.kind === "deposit" ? "deposit" : "withdraw"));
  })) return mutation;
  const targets = mutation.targets.map((target) => ({
    ...target,
    positionIds: events.filter((event) =>
      event.kind === (target.kind === "deposit" ? "deposit" : "withdraw") &&
      rows.some((row) => row.id === event.positionId && row.vaultPubkey === target.vaultPubkey)
    ).map((event) => event.positionId as string),
  }));
  if (targets.some((target, index) => !target.positionIds.length ||
    mutation.targets[index].positionIds?.some((id) => !target.positionIds.includes(id)))) return mutation;
  return { ...mutation, confirmedSlot: slot.toString(), targets };
}

export function assertEarnProjectionDoesNotRegress(
  previous: EarnProjectedPosition[],
  next: EarnProjectedPosition[]
) {
  for (const old of previous) {
    const row = next.find((candidate) => candidate.id === old.id &&
      candidate.vaultPubkey === old.vaultPubkey);
    if (!row || BigInt(row.lastConfirmedSlot) < BigInt(old.lastConfirmedSlot)) {
      throw new Error("Earn accounting projection regressed.");
    }
  }
}
