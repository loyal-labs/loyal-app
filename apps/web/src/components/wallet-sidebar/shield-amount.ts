import { TOKEN_DECIMALS } from "@loyal-labs/wallet-core/constants";
import { toRoundedTokenRawAmount } from "@loyal-labs/wallet-core/lib";

export function formatShieldAmountInputValue(
  value: number,
  tokenSymbol: string
): string {
  const decimals = TOKEN_DECIMALS[tokenSymbol.toUpperCase()] ?? 6;
  const fractionDigits = Math.min(Math.max(decimals, 0), 9);

  return String(Number(value.toFixed(fractionDigits)));
}

export function toRoundedTokenRawUnits(
  value: number,
  tokenSymbol: string
): bigint {
  const decimals = TOKEN_DECIMALS[tokenSymbol.toUpperCase()] ?? 6;
  return toRoundedTokenRawAmount(value, decimals);
}

export function isShieldAmountOverBalance(params: {
  amount: number;
  sourceBalance: number;
  tokenSymbol: string;
}): boolean {
  return (
    toRoundedTokenRawUnits(params.amount, params.tokenSymbol) >
    toRoundedTokenRawUnits(params.sourceBalance, params.tokenSymbol)
  );
}
