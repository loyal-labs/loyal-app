import { formatUsdc } from "@/lib/forms";

/** Product-style money display: whole digits at full strength, decimals
 *  muted — "14,777" + ".14" — matching the webapp's balance treatment. */
export function splitUsdcDisplay(raw: bigint): { fraction: string; whole: string } {
  const [whole, fraction = ""] = formatUsdc(raw).split(".");
  return { fraction: `.${fraction.padEnd(2, "0")}`, whole: whole ?? "0" };
}

export function UsdcAmount({ raw, unit }: { raw: bigint; unit?: string }) {
  const { fraction, whole } = splitUsdcDisplay(raw);
  return (
    <span className="usdc-amount">
      {whole}
      <span className="usdc-fraction">{fraction}</span>
      {unit && <small>{unit}</small>}
    </span>
  );
}
