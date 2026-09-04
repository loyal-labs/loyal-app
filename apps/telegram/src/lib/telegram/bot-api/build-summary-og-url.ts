import { resolveEndpoint } from "@/lib/core/api";

const INVISIBLE_CHAR = "\u200b";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export function buildSummaryOgImageUrl(text: string, date: Date): string {
  const endpoint = resolveEndpoint("api/og/share-summary");
  const url = new URL(endpoint, "http://localhost");
  url.searchParams.set("text", text);
  url.searchParams.set("date", formatDate(date));
  return url.toString();
}

export function buildSummaryMessageWithPreview(
  messageText: string,
  ogText: string,
  date: Date
): string {
  const photoUrl = buildSummaryOgImageUrl(ogText, date);
  return `${messageText}<a href="${photoUrl}">${INVISIBLE_CHAR}</a>`;
}
