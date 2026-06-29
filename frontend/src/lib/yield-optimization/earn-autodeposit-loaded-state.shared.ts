export type LoadedEarnAutodepositScheduledSweep = {
  classification: string;
  confidence: string;
  eligibleAfter: string;
  id: string;
  lotCount?: number;
  originalAmountRaw: string;
  reason: string;
  remainingAmountRaw: string;
  slotId?: string;
  status: string;
};

export type LoadedEarnAutodepositState = {
  amountPerPeriodRaw: string;
  cluster?: string | null;
  depositedThisPeriodRaw?: string | null;
  expiryTimestamp?: string | null;
  nonce?: string | null;
  policyAccount: string;
  policyConfirmedSlot?: string | null;
  policySeed: string;
  policySignature?: string | null;
  periodLengthSeconds: string | null;
  recurringDelegation: string | null;
  recurringDelegationConfirmedSlot?: string | null;
  recurringDelegationSignature?: string | null;
  scheduledSweeps?: LoadedEarnAutodepositScheduledSweep[];
  startTimestamp: string | null;
  status: "active" | "paused" | "pending";
  walletBalanceFloorRaw: string | null;
};

export type LoadedEarnAutodepositConfig = {
  amount: string;
  depositedAmount: string;
  keepAmount: string;
  nextPeriodLabel: string | null;
  expiryTimestamp: string | null;
  periodLengthSeconds: string | null;
  policyAccount: string;
  policySeed: string;
  recurringDelegation: string;
  setupNonce: string | null;
  nonce: string;
  scheduledSweeps?: LoadedEarnAutodepositScheduledSweep[];
  startTimestamp: string | null;
  state: "created" | "creating" | "paused";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLoadedScheduledSweep(
  value: unknown
): value is LoadedEarnAutodepositScheduledSweep {
  return (
    isRecord(value) &&
    typeof value.classification === "string" &&
    typeof value.confidence === "string" &&
    typeof value.eligibleAfter === "string" &&
    typeof value.id === "string" &&
    typeof value.originalAmountRaw === "string" &&
    typeof value.reason === "string" &&
    typeof value.remainingAmountRaw === "string" &&
    typeof value.status === "string"
  );
}

export function isLoadedEarnAutodepositConfig(
  value: unknown
): value is LoadedEarnAutodepositConfig {
  return (
    isRecord(value) &&
    typeof value.amount === "string" &&
    typeof value.depositedAmount === "string" &&
    typeof value.keepAmount === "string" &&
    (typeof value.nextPeriodLabel === "string" ||
      value.nextPeriodLabel === null) &&
    (typeof value.expiryTimestamp === "string" ||
      value.expiryTimestamp === null) &&
    (typeof value.periodLengthSeconds === "string" ||
      value.periodLengthSeconds === null) &&
    typeof value.policyAccount === "string" &&
    typeof value.policySeed === "string" &&
    typeof value.recurringDelegation === "string" &&
    (typeof value.setupNonce === "string" || value.setupNonce === null) &&
    typeof value.nonce === "string" &&
    (typeof value.startTimestamp === "string" ||
      value.startTimestamp === null) &&
    (value.state === "created" ||
      value.state === "creating" ||
      value.state === "paused") &&
    (value.scheduledSweeps === undefined ||
      (Array.isArray(value.scheduledSweeps) &&
        value.scheduledSweeps.every(isLoadedScheduledSweep)))
  );
}

function rawTokenAmountToLabel(amountRaw: string | null | undefined): string {
  if (!amountRaw || !/^\d+$/.test(amountRaw)) {
    return "0";
  }

  const raw = BigInt(amountRaw);
  const scale = BigInt(1_000_000);
  const whole = raw / scale;
  const fraction = raw % scale;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function formatNextPeriodLabel(
  startTimestamp: string | null | undefined,
  periodLengthSeconds: string | null | undefined,
  now = new Date()
): string | null {
  if (
    !startTimestamp ||
    !periodLengthSeconds ||
    !/^\d+$/.test(startTimestamp) ||
    !/^\d+$/.test(periodLengthSeconds)
  ) {
    return null;
  }

  const startMs = Number(BigInt(startTimestamp) * BigInt(1000));
  const periodMs = Number(BigInt(periodLengthSeconds) * BigInt(1000));
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(periodMs) ||
    periodMs <= 0
  ) {
    return null;
  }

  const nowMs = now.getTime();
  const periodsElapsed =
    nowMs < startMs ? 0 : Math.floor((nowMs - startMs) / periodMs) + 1;
  const nextDate = new Date(startMs + periodsElapsed * periodMs);

  return nextDate.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
  });
}

export function earnAutodepositConfigFromLoadedState(
  autodeposit: LoadedEarnAutodepositState | null
): LoadedEarnAutodepositConfig | null {
  if (!autodeposit) {
    return null;
  }

  return {
    amount: rawTokenAmountToLabel(autodeposit.amountPerPeriodRaw),
    depositedAmount: rawTokenAmountToLabel(autodeposit.depositedThisPeriodRaw),
    keepAmount: rawTokenAmountToLabel(autodeposit.walletBalanceFloorRaw),
    nextPeriodLabel: formatNextPeriodLabel(
      autodeposit.startTimestamp,
      autodeposit.periodLengthSeconds
    ),
    expiryTimestamp: autodeposit.expiryTimestamp ?? null,
    nonce: autodeposit.policySeed,
    periodLengthSeconds: autodeposit.periodLengthSeconds,
    policyAccount: autodeposit.policyAccount,
    policySeed: autodeposit.policySeed,
    recurringDelegation: autodeposit.recurringDelegation ?? "",
    scheduledSweeps: autodeposit.scheduledSweeps ?? [],
    setupNonce: autodeposit.nonce ?? null,
    startTimestamp: autodeposit.startTimestamp,
    state:
      autodeposit.status === "active"
        ? "created"
        : autodeposit.status === "paused"
        ? "paused"
        : "creating",
  };
}
