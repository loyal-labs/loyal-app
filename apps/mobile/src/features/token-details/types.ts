import type { Transaction } from "@/types/wallet";

export type TokenDetailTransaction = Pick<
  Transaction,
  "id" | "swapFromMint" | "swapToMint" | "tokenMint"
>;

export type TokenPosition = {
  mint: string;
  publicBalance: number;
  shieldedBalance: number;
  totalBalance: number;
  totalValueUsd: number | null;
  symbol: string;
  name: string;
  icon: string;
};
