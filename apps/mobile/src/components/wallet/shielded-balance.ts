import type { ShieldedBalance } from "@loyal-labs/wallet-core/hooks";

import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { NATIVE_SOL_DECIMALS, NATIVE_SOL_MINT } from "@/lib/solana/constants";
import {
  resolveTokenIcon,
  resolveTokenName,
  resolveTokenSymbol,
} from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";

// Display model for a legacy shielded balance (ASK-2269): shared by the
// category list row and the Unshield sheet so both render the same numbers.
export type ShieldedRow = {
  mint: string;
  symbol: string;
  name: string;
  icon: string;
  amount: number;
  amountText: string;
  usd: number | null;
};

export function resolveShieldedRow(
  balance: ShieldedBalance,
  holdings: TokenHolding[],
  detailsByMint: TokenDetailsByMint,
): ShieldedRow {
  const mint = balance.tokenMint;
  const holding = holdings.find((h) => h.mint === mint);
  const detail = detailsByMint[mint];
  const decimals =
    holding?.decimals ??
    detail?.token.decimals ??
    (mint === NATIVE_SOL_MINT ? NATIVE_SOL_DECIMALS : 6);
  const amount = Number(balance.amountRaw) / 10 ** decimals;
  const price = detail?.market.priceUsd ?? holding?.priceUsd ?? null;
  return {
    mint,
    symbol: resolveTokenSymbol({
      mint,
      detailSymbol: detail?.token.symbol,
      holdingSymbol: holding?.symbol,
    }),
    name: resolveTokenName({
      mint,
      detailName: detail?.token.name,
      holdingName: holding?.name,
    }),
    icon: resolveTokenIcon({
      mint,
      imageUrl: holding?.imageUrl,
      detailLogoUrl: detail?.token.logoUrl,
    }),
    amount,
    amountText: amount.toLocaleString("en-US", { maximumFractionDigits: 6 }),
    usd: price !== null && price > 0 ? amount * price : null,
  };
}

export function formatShieldedUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
