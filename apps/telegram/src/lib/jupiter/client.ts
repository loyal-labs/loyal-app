export function convertToBaseUnits(amount: number, decimals: number): string {
  const multiplier = Math.pow(10, decimals);
  const baseUnits = Math.floor(amount * multiplier);
  return baseUnits.toString();
}

export function convertFromBaseUnits(amount: string, decimals: number): number {
  const divisor = Math.pow(10, decimals);
  return parseInt(amount, 10) / divisor;
}
