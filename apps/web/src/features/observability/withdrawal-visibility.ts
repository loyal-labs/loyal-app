import type { EarnRpcObservation } from "@/hooks/use-active-earn-position";

export function isWithdrawalVisible(
  observation: EarnRpcObservation | null,
  confirmedSlot: string | undefined,
  sourceId: string | null,
  previousAmountRaw: string
): boolean {
  if (
    !observation ||
    !confirmedSlot ||
    !/^\d+$/.test(confirmedSlot) ||
    !/^\d+$/.test(observation.observedSlot) ||
    BigInt(observation.observedSlot) < BigInt(confirmedSlot)
  )
    return false;
  if (sourceId === null) return observation.position === null;
  if (!/^\d+$/.test(previousAmountRaw)) return false;
  const holding = observation.position?.holdings?.find(
    (item) => item.sourceId === sourceId
  );
  const remaining = holding?.amountRaw ?? "0";
  return (
    /^\d+$/.test(remaining) && BigInt(remaining) < BigInt(previousAmountRaw)
  );
}
