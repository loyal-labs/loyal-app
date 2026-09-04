export const USDC_DECIMALS = 6n;
const SCALE = 10n ** USDC_DECIMALS;

export function parseUsdc(value: string): bigint {
  if (!/^\d+(\.\d{0,6})?$/.test(value))
    throw new Error("Enter a positive USDC amount with at most 6 decimals.");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
  if (result <= 0n) throw new Error("Amount must be greater than zero.");
  return result;
}

export function formatUsdc(raw: bigint): string {
  const whole = raw / SCALE;
  const fraction = (raw % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
