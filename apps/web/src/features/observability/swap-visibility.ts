export type SwapBalanceSnapshot = {
  owner: string | null;
  balances: readonly { mint: string; amount: number }[];
};

export function isSwapVisible(
  before: SwapBalanceSnapshot,
  after: SwapBalanceSnapshot,
  inputMint: string,
  outputMint: string
): boolean {
  if (!before.owner || before.owner !== after.owner || inputMint === outputMint)
    return false;
  const balance = (snapshot: SwapBalanceSnapshot, mint: string) =>
    snapshot.balances.find((item) => item.mint === mint)?.amount ?? 0;
  const inputBefore = balance(before, inputMint);
  const inputAfter = balance(after, inputMint);
  const outputBefore = balance(before, outputMint);
  const outputAfter = balance(after, outputMint);
  // Display precision or concurrent transfers can conservatively delay proof.
  return (
    [inputBefore, inputAfter, outputBefore, outputAfter].every(
      (value) => Number.isFinite(value) && value >= 0
    ) &&
    inputAfter < inputBefore &&
    outputAfter > outputBefore
  );
}
