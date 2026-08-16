// Splits a USD amount into its whole-dollar and cents parts so the cents can be
// rendered dimmed, matching the wallet designs (e.g. "$1,005" + ".66").
export function splitUsd(value: number): { whole: string; cents: string } {
  const safe = Number.isFinite(value) ? value : 0;
  const [whole, cents] = safe.toFixed(2).split(".");
  return {
    whole: `$${Number(whole).toLocaleString("en-US")}`,
    cents: `.${cents}`,
  };
}

// Formats basis points as a percentage label, e.g. 846 -> "8.46%".
export function formatApyBps(bps: number): string {
  const pct = bps / 100;
  return `${pct.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}
