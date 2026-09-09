import {
  applyConfirmedEarnMutation,
  bindEarnAccountingTargets,
  reconcileEarnProjection,
  resolveEarnMutationAccounting,
  type ConfirmedEarnMutation,
} from "../position-overlay";
import type { EarnPosition, EarnProjectedPosition } from "../earn-api";

const row = (
  id: string,
  slot: string,
  extra: Partial<EarnProjectedPosition> = {}
): EarnProjectedPosition => ({
  id,
  lastConfirmedSlot: slot,
  currentObservedSlot: slot,
  liquidityMint: "usdc",
  initialReserveAddress: "initial",
  currentLiquidityMint: "usdc",
  currentReserveAddress: "current",
  vaultPubkey: "vault",
  currentAmountRaw: "11000000",
  principalAmountRaw: "10000000",
  status: "active",
  ...extra,
});
const closed = {
  status: "closed",
  currentAmountRaw: "0",
  principalAmountRaw: "0",
};
const historical = row("old", "1", { ...closed, liquidityMint: "usdt" });

const position: EarnPosition = {
  currentAmountRaw: "11000000",
  principalAmountRaw: "10000000",
  currentSupplyApyBps: null,
  status: "active",
};
const mutation: ConfirmedEarnMutation = {
  walletAddress: "wallet",
  settingsPda: "settings",
  cluster: "devnet",
  signature: "deposit",
  confirmedSlot: "101",
  deltaAmountRaw: "2000000",
  accountingTargets: [
    { kind: "deposit", liquidityMint: "usdc", reserve: "initial" },
  ],
};
const projected = (slot: string, value = position) =>
  reconcileEarnProjection({
    previous: null,
    settingsPda: "settings",
    projectedSlot: slot,
    position: value,
    projectedPositions: [row("main", slot)],
  })!;

test("unrelated closed rows never pin a new deposit handoff; RPC amount stays authoritative", () => {
  const oldSameMint = row("old-same-mint", "2", {
    ...closed,
    initialReserveAddress: "retired",
  });
  const prior = reconcileEarnProjection({
    previous: null,
    settingsPda: "settings",
    position,
    projectedSlot: "1",
    projectedPositions: [historical, oldSameMint, row("new", "100")],
  })!;
  const deposit = {
    ...mutation,
    accountingTargets: [
      { kind: "deposit" as const, liquidityMint: "usdc", reserve: "initial" },
    ],
  };
  const applied = applyConfirmedEarnMutation(prior, position, deposit);
  const live = {
    ...applied,
    amountObservedSlot: "110",
    position: { ...applied.position, currentAmountRaw: "13000001" },
  };
  const accepted = reconcileEarnProjection({
    previous: live,
    settingsPda: "settings",
    position: { ...position, principalAmountRaw: "12000000" },
    projectedSlot: "1",
    projectedPositions: [historical, oldSameMint, row("new", "101")],
  })!;
  expect(accepted.pending).toBe(false);
  expect(accepted.position.principalAmountRaw).toBe("12000000");
  expect(accepted.position.currentAmountRaw).toBe("13000001");
  expect(applyConfirmedEarnMutation(accepted, position, deposit)).toBe(
    accepted
  );
  expect(() =>
    reconcileEarnProjection({
      previous: accepted,
      settingsPda: "settings",
      position,
      projectedSlot: "1",
      projectedPositions: [historical, oldSameMint, row("new", "100")],
    })
  ).toThrow(/regressed/);
  // Projection can beat the callback without adding the principal again.
  const raced = { ...accepted, signatures: [] };
  expect(
    applyConfirmedEarnMutation(raced, raced.position, deposit).position
      .principalAmountRaw
  ).toBe("12000000");
});

test("each withdrawal stage releases at its own row slot, including rebalance identities and an old tombstone", () => {
  const rows = [
    historical,
    row("a", "100", { liquidityMint: "cash" }),
    row("b", "100", { currentReserveAddress: "other" }),
  ];
  const targetsA = bindEarnAccountingTargets(
    [{ kind: "withdrawal", liquidityMint: "usdc", reserve: "current" }],
    rows
  );
  const targetsB = bindEarnAccountingTargets(
    [{ kind: "withdrawal", liquidityMint: "usdc", reserve: "other" }],
    rows
  );
  const prior = reconcileEarnProjection({
    previous: null,
    settingsPda: "settings",
    position,
    projectedSlot: "1",
    projectedPositions: rows,
  })!;
  const partial = applyConfirmedEarnMutation(prior, position, {
    ...mutation,
    signature: "stage-a",
    deltaAmountRaw: "-2000000",
    accountingTargets: targetsA,
  });
  expect(partial.position.currentAmountRaw).toBe("9000000");
  const firstProjected = [
    historical,
    row("a", "101", {
      ...closed,
      liquidityMint: "cash",
      currentLiquidityMint: "pyusd",
      currentReserveAddress: "rebalanced-again",
    }),
    rows[2],
  ];
  const partialAccepted = reconcileEarnProjection({
    previous: partial,
    settingsPda: "settings",
    position: {
      ...position,
      principalAmountRaw: "8000000",
      currentAmountRaw: "9000000",
    },
    projectedSlot: "1",
    projectedPositions: firstProjected,
  })!;
  expect(partialAccepted.pending).toBe(false);
  // Both stages can land before either accounting event reaches this reader.
  const final = applyConfirmedEarnMutation(partial, partial.position, {
    ...mutation,
    signature: "stage-b",
    confirmedSlot: "102",
    deltaAmountRaw: "-9000000",
    fullExit: true,
    accountingTargets: targetsB,
  });
  const allProjected = [
    firstProjected[0],
    firstProjected[1],
    row("b", "102", { ...closed, currentReserveAddress: "other" }),
  ];
  const accepted = reconcileEarnProjection({
    previous: final,
    settingsPda: "settings",
    position: null,
    projectedSlot: "1",
    projectedPositions: allProjected,
  })!;
  expect(accepted.pending).toBe(false);
  expect(accepted.position.currentAmountRaw).toBe("0");
  expect(accepted.position.principalAmountRaw).toBe("0");
});

test("WS context higher than landing slot fences RPC but does not pin accounting once exact status resolves", () => {
  const deposit = {
    ...mutation,
    confirmedSlot: "120",
    accountingSlot: null,
    accountingTargets: [
      { kind: "deposit" as const, liquidityMint: "usdc", reserve: "initial" },
    ],
  };
  const applied = applyConfirmedEarnMutation(null, null, deposit);
  const args = {
    settingsPda: "settings",
    position,
    projectedSlot: "1",
    projectedPositions: [historical, row("new", "101")],
  };
  const waiting = reconcileEarnProjection({ ...args, previous: applied })!;
  expect(waiting.pending).toBe(true);
  const resolved = {
    ...waiting,
    mutations: [{ ...deposit, accountingSlot: "101" }],
  };
  const accepted = reconcileEarnProjection({ ...args, previous: resolved })!;
  expect(accepted.pending).toBe(false);
  expect(accepted.confirmedSlot).toBe("120");
  expect(accepted.position.principalAmountRaw).toBe(
    position.principalAmountRaw
  );
});

test("idle withdrawal follows immutable signature identities, not old venue metadata or unrelated row slots", () => {
  const idle = {
    ...mutation,
    signature: "idle",
    deltaAmountRaw: "-2000000",
    accountingSlot: null,
    confirmedSlot: "120",
    accountingTargets: [],
  };
  const applied = applyConfirmedEarnMutation(null, position, idle);
  const rows = [
    historical,
    row("affected", "105", {
      currentLiquidityMint: "cash",
      currentReserveAddress: "prior-venue",
    }),
    row("unaffected", "100"),
  ];
  const event = {
    signature: "idle",
    transactionSlot: "105",
    confirmedSlot: "999", // Projection observation is NOT the landing slot.
    kind: "withdraw" as const,
    positionId: "affected",
  };
  expect(
    resolveEarnMutationAccounting(idle, rows, [
      { ...event, signature: "other" },
    ])
  ).toBe(idle);
  expect(
    resolveEarnMutationAccounting(idle, rows, [{ ...event, kind: "deposit" }])
  ).toBe(idle);
  expect(
    resolveEarnMutationAccounting(idle, rows, [
      { ...event, positionId: "other-wallet-row" },
    ])
  ).toBe(idle);
  expect(
    resolveEarnMutationAccounting(idle, rows, [
      { ...event, transactionSlot: "121" },
    ])
  ).toBe(idle);
  expect(
    resolveEarnMutationAccounting(idle, rows, [
      { ...event, transactionSlot: null },
    ])
  ).toBe(idle);
  const exact = { ...idle, accountingSlot: "110" };
  expect(resolveEarnMutationAccounting(exact, rows, [event])).toBe(exact);
  const resolved = resolveEarnMutationAccounting(idle, rows, [event]);
  const accepted = reconcileEarnProjection({
    previous: { ...applied, mutations: [resolved] },
    settingsPda: "settings",
    position: { ...position, principalAmountRaw: "8000000" },
    projectedSlot: "1",
    projectedPositions: rows,
  })!;
  expect(accepted.pending).toBe(false);
  expect(accepted.position.principalAmountRaw).toBe("8000000");
  expect(accepted.confirmedSlot).toBe("120");
});

test("top-up survives stale projection and replay without doubling principal", () => {
  const applied = applyConfirmedEarnMutation(
    projected("100"),
    position,
    mutation
  );
  expect(applied.position.currentAmountRaw).toBe("13000000");
  expect(applied.position.principalAmountRaw).toBe("12000000");
  const stale = reconcileEarnProjection({
    previous: applied,
    settingsPda: "settings",
    projectedSlot: "100",
    position,
  });
  expect(stale).toBe(applied);
  expect(applyConfirmedEarnMutation(stale, position, mutation)).toBe(applied);
});

test("a live read racing confirmation does not apply the amount twice but still advances principal", () => {
  const prior = {
    ...projected("100"),
    amountObservedSlot: "101",
    position: { ...position, currentAmountRaw: "13000000" },
  };
  const next = applyConfirmedEarnMutation(prior, prior.position, mutation);
  expect(next.position.currentAmountRaw).toBe("13000000");
  expect(next.position.principalAmountRaw).toBe("12000000");
  const covered = projected("101", next.position);
  expect(
    applyConfirmedEarnMutation(covered, covered.position, mutation).position
  ).toEqual(next.position);
});

test("partial stages retain remaining funds; completed full exit cannot resurrect after projection release", () => {
  const partial = applyConfirmedEarnMutation(projected("100"), position, {
    ...mutation,
    signature: "withdraw-1",
    deltaAmountRaw: "-2000000",
  });
  expect(partial.position.currentAmountRaw).toBe("9000000");
  expect(partial.position.principalAmountRaw).toBe("8000000");
  const full = applyConfirmedEarnMutation(partial, partial.position, {
    ...mutation,
    signature: "withdraw-2",
    confirmedSlot: "102",
    deltaAmountRaw: "-9000000",
    fullExit: true,
  });
  expect(full.position.currentAmountRaw).toBe("0");
  expect(full.position.principalAmountRaw).toBe("0");
  const covered = reconcileEarnProjection({
    previous: full,
    settingsPda: "settings",
    projectedSlot: "102",
    position: null,
    projectedPositions: [row("main", "102", closed)],
  })!;
  expect(covered.pending).toBe(false);
  expect(
    reconcileEarnProjection({
      previous: covered,
      settingsPda: "settings",
      projectedSlot: "100",
      position,
    })?.position.currentAmountRaw
  ).toBe("0");
  expect(
    reconcileEarnProjection({
      previous: covered,
      settingsPda: "settings",
      projectedSlot: null,
      position,
    })?.position.currentAmountRaw
  ).toBe("0");
});

test("first deposit creates both amount and principal; a different settings scope cannot inherit optimism", () => {
  const first = applyConfirmedEarnMutation(null, null, mutation);
  expect(first.position.currentAmountRaw).toBe("2000000");
  expect(first.position.principalAmountRaw).toBe("2000000");
  const other = reconcileEarnProjection({
    previous: first,
    settingsPda: "other",
    projectedSlot: "1",
    position: null,
    projectedPositions: [],
  });
  expect(other?.position.currentAmountRaw).toBe("0");
});
