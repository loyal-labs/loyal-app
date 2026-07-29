// Reads a CSS duration custom property in milliseconds. The compiled
// stylesheet serves durations in seconds (Lightning CSS minifies `350ms` to
// `.35s`), so a bare parseFloat reads 0.35 — treating that as milliseconds
// made every recipe's cleanup timer fire instantly. Parse the unit.
export function readCssDurationMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) {
    return fallback;
  }
  if (raw.endsWith("ms")) {
    return value;
  }
  if (raw.endsWith("s")) {
    return value * 1000;
  }
  return value;
}
