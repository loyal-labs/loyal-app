import type { ChatSummary, Topic } from "@loyal-labs/shared";

export function toDateKey(isoString: string): string {
  return isoString.split("T")[0];
}

export function groupSummariesByDate(
  summaries: ChatSummary[],
): Map<string, ChatSummary[]> {
  const map = new Map<string, ChatSummary[]>();
  for (const summary of summaries) {
    if (!summary.createdAt) continue;
    const dateKey = toDateKey(summary.createdAt);
    const existing = map.get(dateKey) ?? [];
    existing.push(summary);
    map.set(dateKey, existing);
  }
  return map;
}

export function getAvailableDates(summaries: ChatSummary[]): string[] {
  const dateSet = new Set<string>();
  for (const summary of summaries) {
    if (summary.createdAt) {
      dateSet.add(toDateKey(summary.createdAt));
    }
  }
  return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
}

export function getMessageCountForDate(
  summariesByDate: Map<string, ChatSummary[]>,
  date: string,
): number {
  const summaries = summariesByDate.get(date) ?? [];
  return summaries.reduce((sum, s) => sum + (s.messageCount ?? 0), 0);
}

export function getTopicsForDate(
  summariesByDate: Map<string, ChatSummary[]>,
  date: string,
): Topic[] {
  const summaries = summariesByDate.get(date) ?? [];
  return summaries.flatMap((s) => s.topics);
}
