const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  // Format in UTC so an ISO date like "2026-02-06" never shifts a day.
  timeZone: "UTC",
});

/** Formats an ISO date (YYYY-MM-DD) as e.g. "Feb 6, 2026"; passes through if unparseable. */
export function formatBlogDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  return Number.isNaN(parsed.getTime())
    ? isoDate
    : DATE_FORMATTER.format(parsed);
}
