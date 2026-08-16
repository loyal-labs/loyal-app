import type { TokenDetailTransaction } from "./types";

export function filterTransactionsForMint(
  transactions: TokenDetailTransaction[],
  mint: string,
): TokenDetailTransaction[] {
  return transactions.filter(
    (transaction) =>
      transaction.tokenMint === mint ||
      transaction.swapFromMint === mint ||
      transaction.swapToMint === mint,
  );
}
