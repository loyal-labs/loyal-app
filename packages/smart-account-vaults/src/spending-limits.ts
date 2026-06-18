import { PublicKey } from "@solana/web3.js";

export type SmartAccountSpendingLimitPeriod =
  | "one_time"
  | "day"
  | "week"
  | "month"
  | "custom";

export const SOL_SPENDING_LIMIT_MINT = PublicKey.default.toBase58();

const PERIOD_SECONDS: Record<SmartAccountSpendingLimitPeriod, number | null> = {
  one_time: null,
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60,
  custom: null,
};

export function getSpendingLimitPeriodSeconds(
  period: SmartAccountSpendingLimitPeriod
): number | null {
  return PERIOD_SECONDS[period];
}

export function getEffectiveSpendingLimitRemainingAmount(args: {
  amount: bigint;
  accumulateUnused?: boolean;
  lastReset: number;
  now: number;
  period: SmartAccountSpendingLimitPeriod;
  periodSeconds?: number | null;
  remainingAmount: bigint;
}): bigint {
  const resetPeriod =
    args.periodSeconds ?? getSpendingLimitPeriodSeconds(args.period);

  if (resetPeriod === null) {
    return args.remainingAmount;
  }

  const elapsed = args.now - args.lastReset;

  if (elapsed <= resetPeriod) {
    return args.remainingAmount;
  }

  const periodsPassed = Math.floor(elapsed / resetPeriod);

  if (periodsPassed <= 0) {
    return args.remainingAmount;
  }

  if (args.accumulateUnused) {
    return args.remainingAmount + args.amount * BigInt(periodsPassed);
  }

  return args.amount;
}

export function getSpendingLimitNextReset(args: {
  lastReset: number;
  now: number;
  period: SmartAccountSpendingLimitPeriod;
  periodSeconds?: number | null;
}): number | null {
  const resetPeriod =
    args.periodSeconds ?? getSpendingLimitPeriodSeconds(args.period);

  if (resetPeriod === null) {
    return null;
  }

  const elapsed = Math.max(0, args.now - args.lastReset);
  const periodsElapsed = Math.floor(elapsed / resetPeriod);

  return args.lastReset + (periodsElapsed + 1) * resetPeriod;
}

export function formatTokenAmount(amountRaw: bigint, decimals: number): string {
  if (decimals === 0) {
    return amountRaw.toString();
  }

  const base = BigInt(10) ** BigInt(decimals);
  const whole = amountRaw / base;
  const fraction = amountRaw % base;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  const paddedFraction = fraction.toString().padStart(decimals, "0");
  return `${whole.toString()}.${paddedFraction.replace(/0+$/, "")}`;
}

export function tokenAmountToNumber(
  amountRaw: bigint,
  decimals: number
): number | null {
  const amount = Number(formatTokenAmount(amountRaw, decimals));

  return Number.isFinite(amount) ? amount : null;
}

export function toSpendingLimitPeriodLabel(
  period: SmartAccountSpendingLimitPeriod,
  periodSeconds?: number | null
): string {
  switch (period) {
    case "one_time":
      return "one-time";
    case "day":
      return "day";
    case "week":
      return "week";
    case "month":
      return "month";
    case "custom":
      if (typeof periodSeconds === "number" && Number.isFinite(periodSeconds)) {
        const days = periodSeconds / (24 * 60 * 60);
        return Number.isInteger(days)
          ? `${days} day${days === 1 ? "" : "s"}`
          : "custom";
      }

      return "custom";
  }
}
