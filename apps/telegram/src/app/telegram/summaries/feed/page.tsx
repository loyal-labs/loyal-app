"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { useSummaries } from "@/components/summaries/SummariesContext";
import SummaryFeed from "@/components/summaries/SummaryFeed";

function SummaryFeedContent() {
  const searchParams = useSearchParams();
  const groupChatId = searchParams.get("groupChatId") || undefined;
  const summaryId = searchParams.get("summaryId") || undefined;
  const { summaries: cachedSummaries } = useSummaries();
  const [feedSummaries, setFeedSummaries] = useState(cachedSummaries);
  const canFetchByGroupChatId = Boolean(
    groupChatId && /^-?\d+$/.test(groupChatId)
  );

  const isSummaryInGroup = useCallback(
    (summary: { chatId?: string; title: string }) => {
      if (!groupChatId) {
        return true;
      }

      if (summary.chatId) {
        return summary.chatId === groupChatId;
      }

      // Mock summaries may not include chatId yet; fallback to title key.
      return summary.title === groupChatId;
    },
    [groupChatId]
  );

  useEffect(() => {
    setFeedSummaries(cachedSummaries);
  }, [cachedSummaries]);

  const hasTargetSummary = useMemo(() => {
    if (!summaryId) return true;
    return feedSummaries.some(
      (summary) => summary.id === summaryId && isSummaryInGroup(summary)
    );
  }, [feedSummaries, summaryId, isSummaryInGroup]);
  const hasGroupSummaries = useMemo(() => {
    if (!groupChatId) return feedSummaries.length > 0;
    return feedSummaries.some((summary) => isSummaryInGroup(summary));
  }, [feedSummaries, groupChatId, isSummaryInGroup]);

  useEffect(() => {
    if (!groupChatId || !canFetchByGroupChatId) {
      return;
    }

    if (hasGroupSummaries && (!summaryId || hasTargetSummary)) {
      return;
    }

    let cancelled = false;
    const fetchGroupSummaries = async () => {
      try {
        const response = await fetch(
          `/api/summaries?groupChatId=${encodeURIComponent(groupChatId)}`
        );
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (cancelled || !Array.isArray(data.summaries)) {
          return;
        }

        setFeedSummaries(data.summaries);
      } catch {
        // Keep cached summaries fallback
      }
    };

    fetchGroupSummaries();

    return () => {
      cancelled = true;
    };
  }, [
    canFetchByGroupChatId,
    groupChatId,
    isSummaryInGroup,
    summaryId,
    hasTargetSummary,
    hasGroupSummaries,
  ]);

  const groupSummaries = useMemo(() => {
    if (!groupChatId) {
      return feedSummaries.length > 0 ? feedSummaries : undefined;
    }

    const filtered = feedSummaries.filter((summary) => isSummaryInGroup(summary));
    return filtered.length > 0 ? filtered : undefined;
  }, [feedSummaries, groupChatId, isSummaryInGroup]);

  const groupTitle = useMemo(() => {
    if (!groupSummaries || groupSummaries.length === 0) return undefined;
    return groupSummaries[0].title;
  }, [groupSummaries]);

  // Pass filtered summaries for the specific group
  return (
    <SummaryFeed
      initialSummaryId={summaryId}
      summaries={groupSummaries}
      groupChatId={groupChatId}
      groupTitle={groupTitle}
    />
  );
}

export default function SummaryFeedPage() {
  return (
    <Suspense
      fallback={
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: "#fff" }}
        >
          <div className="w-6 h-6 border-2 border-black/10 border-t-black/40 rounded-full animate-spin" />
        </div>
      }
    >
      <SummaryFeedContent />
    </Suspense>
  );
}
