/** A confirmed deposit is visible only after an RPC read at or beyond its slot. */
export function isDepositVisible(
  holdings:
    | readonly {
        reserve: string | null;
        amountRaw: string;
        observedSlot: string | null;
        provenance: Record<string, string | null>;
      }[]
    | undefined,
  reserve: string,
  confirmedSlot: string | undefined
): boolean {
  if (!confirmedSlot || !/^\d+$/.test(confirmedSlot)) return false;
  return (
    holdings?.some(
      (holding) =>
        holding.reserve === reserve &&
        holding.provenance.source === "rpc_getMultipleAccounts" &&
        /^\d+$/.test(holding.amountRaw) &&
        BigInt(holding.amountRaw) > BigInt(0) &&
        holding.observedSlot !== null &&
        /^\d+$/.test(holding.observedSlot) &&
        BigInt(holding.observedSlot) >= BigInt(confirmedSlot)
    ) ?? false
  );
}
