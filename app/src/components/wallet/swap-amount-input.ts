const MAX_SUPPORTED_TOKEN_DECIMALS = 18;
const MAX_DISPLAY_SIGNIFICANT_DIGITS = 16;

export function getAmountInputMaxDecimals(decimals: number): number {
  if (!Number.isFinite(decimals)) return 0;
  return Math.max(
    0,
    Math.min(Math.trunc(decimals), MAX_SUPPORTED_TOKEN_DECIMALS)
  );
}

export function parseAmountInput(
  value: string,
  maxDecimals: number
): string | null {
  const normalized = value.replace(",", ".");
  if (!/^[0-9]*\.?[0-9]*$/.test(normalized)) return null;
  if (normalized.includes(".")) {
    const [, dec] = normalized.split(".");
    if (dec && dec.length > maxDecimals) return null;
  }
  return normalized;
}

function expandScientificNotation(value: string): string {
  if (!value.includes("e") && !value.includes("E")) return value;

  const [mantissa, exponentPart] = value.toLowerCase().split("e");
  const exponent = Number.parseInt(exponentPart, 10);
  if (!Number.isFinite(exponent)) return value;

  const sign = mantissa.startsWith("-") ? "-" : "";
  const unsignedMantissa = sign ? mantissa.slice(1) : mantissa;
  const [whole = "0", fraction = ""] = unsignedMantissa.split(".");
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;

  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(Math.abs(decimalIndex))}${digits}`;
  }

  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }

  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function truncateAmountString(value: string, maxDecimals: number): string {
  const normalized = expandScientificNotation(value);
  const [whole, fraction = ""] = normalized.split(".");
  const truncatedFraction = fraction.slice(0, maxDecimals);
  return (
    truncatedFraction.length > 0 ? `${whole}.${truncatedFraction}` : whole
  );
}

export function formatAmountInputValue(
  value: number,
  maxDecimals: number
): string {
  if (!Number.isFinite(value) || value <= 0) return "0";

  const safeMaxDecimals = getAmountInputMaxDecimals(maxDecimals);
  return (
    truncateAmountString(value.toString(), safeMaxDecimals).replace(/\.?0+$/, "") ||
    "0"
  );
}

export function formatAmountDisplayValue(
  value: number,
  maxDecimals: number
): string {
  if (!Number.isFinite(value) || value <= 0) return "0";

  const safeMaxDecimals = getAmountInputMaxDecimals(maxDecimals);
  const roundedValue = Number.parseFloat(
    value.toPrecision(MAX_DISPLAY_SIGNIFICANT_DIGITS)
  );
  return (
    truncateAmountString(roundedValue.toString(), safeMaxDecimals).replace(
      /\.?0+$/,
      ""
    ) || "0"
  );
}
