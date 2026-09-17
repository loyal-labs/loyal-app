import type { DecodedKaminoObligation } from "./kamino-obligation";

/** SDK marketValueSf fields are recorded USD values, before borrow-factor weighting.
 * Never use this historical projection to price a transaction or reconcile USDC NAV.
 */
export function recordedKaminoValuation(value: DecodedKaminoObligation) {
  const deposits = value.deposits.filter(row => row.active);
  const borrows = value.borrows.filter(row => row.active);
  const parse = (raw: string) => {
    if (!/^\d+$/.test(raw)) throw new Error("Invalid recorded market value");
    const amount = BigInt(raw);
    if (amount >= 1n << 128n) throw new Error("Recorded market value exceeds u128");
    return amount;
  };
  const collateral = deposits.map(row => parse(row.marketValueSf));
  const debt = borrows.map(row => parse(row.marketValueSf));
  if ([...collateral, ...debt].some(amount => amount === 0n)) return null;
  const collateralSf = collateral.reduce((sum, amount) => sum + amount, 0n);
  const debtSf = debt.reduce((sum, amount) => sum + amount, 0n);
  const scale = 1n << 60n, usdUnit = 1_000_000n;
  const collateralRaw = collateralSf * usdUnit / scale;
  const debtRaw = (debtSf * usdUnit + scale - 1n) / scale;
  return {
    source: "recorded-obligation" as const,
    decimals: 6 as const,
    collateralUsdRaw: collateralRaw.toString(),
    debtUsdRaw: debtRaw.toString(),
    netEquityUsdRaw: (collateralRaw - debtRaw).toString(),
    ltvBps: collateralSf === 0n ? null : ((debtSf * 10_000n + collateralSf - 1n) / collateralSf).toString(),
  };
}
