// Display helpers shared by the server page and the client charts.

export function usd(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export function compactUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 1 : 2,
    notation: "compact",
  }).format(value)}`;
}

export const pct = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;

export function ago(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86_400).toFixed(1)} d`;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return `${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso))} UTC`;
}

export function shortDate(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export const words = (value: string | null | undefined) =>
  value ? value.replaceAll("_", " ").toLowerCase() : "";
