import type { EarnMaxActivityItem, EarnMaxSummary } from "../types";

export function isVoltrOperationVisible(
  signature: string,
  summary: Pick<EarnMaxSummary, "observedSlot"> | null,
  operations: readonly Pick<
    EarnMaxActivityItem,
    "signature" | "status" | "confirmedSlot"
  >[]
): boolean {
  const observedSlot = summary?.observedSlot;
  if (!observedSlot || !/^\d+$/.test(observedSlot)) return false;
  return operations.some((operation) => {
    const slot = operation.confirmedSlot;
    return (
      operation.signature === signature &&
      operation.status === "confirmed" &&
      Boolean(
        slot && /^\d+$/.test(slot) && BigInt(observedSlot) >= BigInt(slot)
      )
    );
  });
}
