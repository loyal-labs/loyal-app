"use client";

import {
  backButton,
  hapticFeedback,
  swipeBehavior,
} from "@telegram-apps/sdk-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  SUMMARIES_ANALYTICS_EVENTS,
  SUMMARIES_ANALYTICS_PATH,
  SUMMARY_SELECTION_SOURCES,
  type SummarySelectionSource,
} from "@/app/telegram/summaries/summaries-analytics";
import { useDeviceSafeAreaTop } from "@/hooks/useTelegramSafeArea";
import { track } from "@/lib/core/analytics";

import { getAvatarColor, getFirstLetter } from "./avatar-utils";
import DatePicker from "./DatePicker";

export type ChatSummary = {
  id: string;
  chatId?: string;
  title: string;
  messageCount?: number;
  createdAt?: string;
  photoUrl?: string;
  // Deprecated compatibility fields; remove after migration window.
  photoBase64?: string;
  photoMimeType?: string;
  topics: Array<{
    id: string;
    title: string;
    content: string;
    sources: string[];
  }>;
};

// Source avatars component (overlapping circles)
function SourceAvatars({ sources }: { sources: string[] }) {
  return (
    <div className="flex items-end pt-3">
      <div className="flex items-center">
        {sources.slice(0, 3).map((source, index) => (
          <div
            key={source}
            className="rounded-full flex items-center justify-center text-[10px] font-medium text-white"
            style={{
              width: 28,
              height: 28,
              backgroundColor: getAvatarColor(source),
              marginRight: -2,
              zIndex: sources.length - index,
            }}
          >
            {getFirstLetter(source)}
          </div>
        ))}
      </div>
    </div>
  );
}

// Empty state for today when no summaries available
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/dogs/dog-green.png"
        alt=""
        className="w-16 h-16 object-contain mb-4 opacity-60"
      />
      <p className="text-[15px] text-center" style={{ color: "rgba(60,60,67,0.6)" }}>
        Summary for today is being created...
      </p>
    </div>
  );
}

// Topic card component
function TopicCard({ topic }: { topic: ChatSummary["topics"][0] }) {
  return (
    <div className="bg-[#F2F2F7] overflow-hidden" style={{ borderRadius: 26, padding: 16 }}>
      <h2 className="font-semibold text-black pb-3" style={{ fontSize: 20, lineHeight: "24px" }}>
        {topic.title}
      </h2>
      <p className="font-normal" style={{ fontSize: 16, lineHeight: "22px", color: "rgba(60,60,67,0.9)" }}>
        {topic.content}
      </p>
      <SourceAvatars sources={topic.sources} />
    </div>
  );
}

// Smooth ease-out for animations
const EASE_OUT = "cubic-bezier(0.0, 0.0, 0.2, 1)";

// Convert ISO date string to YYYY-MM-DD format
function toDateKey(isoString: string): string {
  return isoString.split("T")[0];
}

// Group summaries by date
function groupSummariesByDate(
  summaries: ChatSummary[]
): Map<string, ChatSummary[]> {
  const map = new Map<string, ChatSummary[]>();

  for (const summary of summaries) {
    if (!summary.createdAt) continue;
    const dateKey = toDateKey(summary.createdAt);
    const existing = map.get(dateKey) || [];
    existing.push(summary);
    map.set(dateKey, existing);
  }

  return map;
}

// Get available dates from summaries (sorted newest first)
function getAvailableDates(summaries: ChatSummary[]): string[] {
  const dateSet = new Set<string>();

  for (const summary of summaries) {
    if (summary.createdAt) {
      dateSet.add(toDateKey(summary.createdAt));
    }
  }

  return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
}

// Get total message count for a date
function getMessageCountForDate(
  summariesByDate: Map<string, ChatSummary[]>,
  date: string
): number {
  const summaries = summariesByDate.get(date) || [];
  return summaries.reduce((sum, s) => sum + (s.messageCount || 0), 0);
}

// Get all topics for a date
function getTopicsForDate(
  summariesByDate: Map<string, ChatSummary[]>,
  date: string
): ChatSummary["topics"] {
  const summaries = summariesByDate.get(date) || [];
  return summaries.flatMap((s) => s.topics);
}

export type SummaryFeedProps = {
  /** Initial summary ID to focus (deeplink entry) */
  initialSummaryId?: string;
  /** All summaries for the group (pre-fetched) */
  summaries?: ChatSummary[];
  /** Telegram community chat ID for tracking */
  groupChatId?: string;
  /** Group title (optional, derived from summaries if not provided) */
  groupTitle?: string;
};

export default function SummaryFeed({
  initialSummaryId,
  summaries: initialSummaries,
  groupChatId,
  groupTitle: initialGroupTitle,
}: SummaryFeedProps) {
  const router = useRouter();
  const safeAreaInsetTop = useDeviceSafeAreaTop();
  const topOffset = Math.max(safeAreaInsetTop || 0, 12) + 10 + 27 + 16;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [summaries, setSummaries] = useState<ChatSummary[]>(
    initialSummaries || []
  );
  const [isLoading, setIsLoading] = useState(!initialSummaries);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialSummaries) return;
    setSummaries(initialSummaries);
    setIsLoading(false);
    setError(null);
  }, [initialSummaries]);

  // Fetch summaries from API if not provided
  useEffect(() => {
    if (initialSummaries) return;

    const fetchSummaries = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch("/api/summaries");
        if (!response.ok) {
          throw new Error("Failed to fetch summaries");
        }
        const data = await response.json();
        setSummaries(data.summaries || []);
      } catch (err) {
        console.error("Failed to fetch summaries:", err);
        setError("Failed to load summaries");
      } finally {
        setIsLoading(false);
      }
    };

    fetchSummaries();
  }, [initialSummaries]);

  const groupTitle = useMemo(() => {
    if (initialGroupTitle) return initialGroupTitle;
    if (summaries.length > 0) return summaries[0].title;
    return "Chat Summary";
  }, [initialGroupTitle, summaries]);

  const groupPhoto = useMemo(() => {
    if (summaries.length === 0) return null;
    const first = summaries[0];
    if (first.photoUrl) {
      return first.photoUrl;
    }
    if (first.photoBase64) {
      return `data:${first.photoMimeType || "image/jpeg"};base64,${first.photoBase64}`;
    }
    return null;
  }, [summaries]);

  const summariesByDate = useMemo(
    () => groupSummariesByDate(summaries),
    [summaries]
  );

  const availableDates = useMemo(
    () => getAvailableDates(summaries),
    [summaries]
  );

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return availableDates[0] || toDateKey(new Date().toISOString());
  });
  const initialSummaryDate = useMemo(() => {
    if (!initialSummaryId) {
      return undefined;
    }

    const summary = summaries.find((item) => item.id === initialSummaryId);
    if (!summary?.createdAt) {
      return undefined;
    }

    return toDateKey(summary.createdAt);
  }, [initialSummaryId, summaries]);
  const pendingSelectionSourceRef = useRef<SummarySelectionSource>(
    SUMMARY_SELECTION_SOURCES.initial
  );
  const hasTrackedInitialViewRef = useRef(false);
  const hasAppliedInitialSummarySelectionRef = useRef(false);

  useEffect(() => {
    hasAppliedInitialSummarySelectionRef.current = false;
  }, [initialSummaryId]);

  // Only reset selectedDate when the data itself changes (not on every selectedDate change)
  useEffect(() => {
    if (availableDates.length > 0) {
      setSelectedDate(prev => {
        const todayKey = toDateKey(new Date().toISOString());
        // Keep current selection if it has data or is today
        if (availableDates.includes(prev) || prev === todayKey) return prev;
        // Otherwise default to most recent
        return availableDates[0];
      });
    }
  }, [availableDates]);

  useEffect(() => {
    if (hasAppliedInitialSummarySelectionRef.current) {
      return;
    }

    if (!initialSummaryId) {
      hasAppliedInitialSummarySelectionRef.current = true;
      return;
    }

    if (initialSummaryDate) {
      setSelectedDate(initialSummaryDate);
      hasAppliedInitialSummarySelectionRef.current = true;
      return;
    }

    // If the data has loaded and we still cannot resolve summaryId, fallback to default date.
    if (!isLoading) {
      hasAppliedInitialSummarySelectionRef.current = true;
    }
  }, [initialSummaryId, initialSummaryDate, isLoading]);

  useEffect(() => {
    if (!groupChatId || !groupTitle || !selectedDate) {
      return;
    }

    const selectionSource = hasTrackedInitialViewRef.current
      ? pendingSelectionSourceRef.current
      : SUMMARY_SELECTION_SOURCES.initial;

    track(SUMMARIES_ANALYTICS_EVENTS.viewCommunitySummaryDay, {
      path: SUMMARIES_ANALYTICS_PATH,
      community_chat_id: groupChatId,
      community_title: groupTitle,
      summary_date: selectedDate,
      selection_source: selectionSource,
    });

    hasTrackedInitialViewRef.current = true;
    pendingSelectionSourceRef.current = SUMMARY_SELECTION_SOURCES.initial;
  }, [groupChatId, groupTitle, selectedDate]);

  const messageCount = useMemo(
    () => getMessageCountForDate(summariesByDate, selectedDate),
    [summariesByDate, selectedDate]
  );

  const topics = useMemo(
    () => getTopicsForDate(summariesByDate, selectedDate),
    [summariesByDate, selectedDate]
  );

  const { prevTopics, nextTopics } = useMemo(() => {
    const currentIndex = availableDates.indexOf(selectedDate);
    const prevDate = currentIndex < availableDates.length - 1 ? availableDates[currentIndex + 1] : null;
    const nextDate = currentIndex > 0 ? availableDates[currentIndex - 1] : null;
    return {
      prevTopics: prevDate ? getTopicsForDate(summariesByDate, prevDate) : [],
      nextTopics: nextDate ? getTopicsForDate(summariesByDate, nextDate) : [],
    };
  }, [availableDates, selectedDate, summariesByDate]);

  // Setup Telegram back button and disable vertical swipe to close
  useEffect(() => {
    if (swipeBehavior.disableVertical.isAvailable()) {
      swipeBehavior.disableVertical();
    }

    try {
      backButton.mount();
    } catch {
      // Mount may not be available in all contexts
    }
    if (backButton.show.isAvailable()) {
      backButton.show();
    }

    const handleBack = () => {
      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }
      router.push("/telegram/summaries");
    };

    if (backButton.onClick.isAvailable()) {
      backButton.onClick(handleBack);
    }

    return () => {
      if (swipeBehavior.enableVertical.isAvailable()) {
        swipeBehavior.enableVertical();
      }
      if (backButton.hide.isAvailable()) {
        backButton.hide();
      }
      if (backButton.offClick.isAvailable()) {
        backButton.offClick(handleBack);
      }
      try {
        backButton.unmount();
      } catch {
        // Unmount may not be available in all contexts
      }
    };
  }, [router]);

  // Header hide/show on content scroll
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const lastContentScrollTopRef = useRef(0);
  const headerInnerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  // Measure header height
  useEffect(() => {
    const el = headerInnerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setHeaderHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleContentScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const currentScrollTop = container.scrollTop;
    const maxScroll = container.scrollHeight - container.clientHeight;

    // Ignore WebKit rubber-band overscroll (negative or beyond max)
    if (currentScrollTop < 0 || currentScrollTop > maxScroll) {
      return;
    }

    const delta = currentScrollTop - lastContentScrollTopRef.current;

    // Only trigger after meaningful scroll (avoid micro-jitter)
    if (Math.abs(delta) < 4) return;

    if (delta > 0 && currentScrollTop > 20) {
      // Scrolling down — hide timeline
      setIsHeaderHidden(true);
    } else if (delta < -2 && currentScrollTop < maxScroll) {
      // Scrolling up (but not during bottom bounce) — show timeline
      setIsHeaderHidden(false);
    }

    lastContentScrollTopRef.current = currentScrollTop;
  }, []);

  // Slide animation state
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(
    null
  );
  const [isSliding, setIsSliding] = useState(false);
  const [oldTopics, setOldTopics] = useState<typeof topics>([]);
  const prevDateRef = useRef(selectedDate);

  // Swipe detection for content area
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isSwipingRef = useRef(false);
  const [swipeX, setSwipeX] = useState(0);

  // Navigate to adjacent date with data
  const navigateToAdjacentDate = useCallback(
    (direction: "prev" | "next") => {
      const currentIndex = availableDates.indexOf(selectedDate);
      if (currentIndex === -1) return;

      let targetDate: string | null = null;
      if (direction === "prev" && currentIndex < availableDates.length - 1) {
        targetDate = availableDates[currentIndex + 1];
      } else if (direction === "next" && currentIndex > 0) {
        targetDate = availableDates[currentIndex - 1];
      }

      if (targetDate) {
        if (hapticFeedback.impactOccurred.isAvailable()) {
          hapticFeedback.impactOccurred("light");
        }
        pendingSelectionSourceRef.current = SUMMARY_SELECTION_SOURCES.swipe;
        const slideDir = direction === "next" ? "left" : "right";
        setOldTopics(topics);
        setSlideDirection(slideDir);
        setIsSliding(true);
        setSelectedDate(targetDate);
        prevDateRef.current = targetDate;

        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }

        setTimeout(() => {
          setIsSliding(false);
          setSlideDirection(null);
        }, 180);
      }
    },
    [availableDates, selectedDate, topics]
  );

  const SWIPE_THRESHOLD = 50;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    isSwipingRef.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;

    if (!isSwipingRef.current && Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      isSwipingRef.current = true;
    }

    if (isSwipingRef.current) {
      const currentIndex = availableDates.indexOf(selectedDate);
      const canGoNext = currentIndex > 0;
      const canGoPrev = currentIndex < availableDates.length - 1;

      let adjustedDelta = deltaX;
      if ((deltaX < 0 && !canGoNext) || (deltaX > 0 && !canGoPrev)) {
        adjustedDelta = deltaX * 0.15;
      } else {
        adjustedDelta = deltaX * 0.35;
      }

      setSwipeX(adjustedDelta);

      if (Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(deltaX - (deltaX > 0 ? 5 : -5)) < SWIPE_THRESHOLD) {
        if (hapticFeedback.selectionChanged.isAvailable()) {
          hapticFeedback.selectionChanged();
        }
      }
    }
  }, [availableDates, selectedDate]);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;

      const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
      const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;

      if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        if (deltaX < 0) {
          navigateToAdjacentDate("next");
        } else {
          navigateToAdjacentDate("prev");
        }
      }

      setSwipeX(0);
      touchStartRef.current = null;
      isSwipingRef.current = false;
    },
    [navigateToAdjacentDate]
  );

  // Handle date selection with slide animation
  const handleDateSelect = useCallback(
    (
      date: string,
      source: SummarySelectionSource = SUMMARY_SELECTION_SOURCES.datePicker
    ) => {
      if (date === selectedDate) return;

      setIsHeaderHidden(false);
      setOldTopics(topics);
      pendingSelectionSourceRef.current = source;

      const direction = date > prevDateRef.current ? "left" : "right";
      setSlideDirection(direction);
      setIsSliding(true);

      setSelectedDate(date);
      prevDateRef.current = date;

      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }

      setTimeout(() => {
        setIsSliding(false);
        setSlideDirection(null);
      }, 180);
    },
    [selectedDate, topics]
  );

  // Handle "Today" button - always navigate to today
  const handleTodayClick = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    const today = toDateKey(new Date().toISOString());
    handleDateSelect(today, SUMMARY_SELECTION_SOURCES.todayButton);
  }, [handleDateSelect]);

  // Page entrance animation
  const [isPageMounted, setIsPageMounted] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsPageMounted(true);
      });
    });
  }, []);

  if (isLoading) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: "#fff" }}
      >
        <div className="w-6 h-6 border-2 border-black/10 border-t-black/40 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-4"
        style={{ background: "#fff" }}
      >
        <p className="text-black/50">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-black/5 rounded-lg text-black text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: "#fff" }}
      >
        <p className="text-black/50">No summaries available</p>
      </div>
    );
  }

  const avatarColor = getAvatarColor(groupTitle);
  const firstLetter = getFirstLetter(groupTitle);

  return (
    <main
      className="text-black font-sans overflow-hidden relative flex flex-col"
      style={{
        background: "#fff",
        height: `calc(100vh - ${topOffset}px)`,
      }}
    >
      {/* Header Section - Always visible */}
      <div className="shrink-0 px-4">
        {/* Group info row */}
        <div
          className="flex items-center gap-3 py-2"
          style={{
            opacity: isPageMounted ? 1 : 0,
            transform: isPageMounted ? "translateY(0)" : "translateY(-10px)",
            transition: `all 300ms ${EASE_OUT}`,
          }}
        >
          {/* Avatar */}
          {groupPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={groupPhoto}
              alt={groupTitle}
              className="rounded-full object-cover shrink-0"
              style={{ width: 44, height: 44 }}
            />
          ) : (
            <div
              className="rounded-full flex items-center justify-center font-medium text-white shrink-0"
              style={{ width: 44, height: 44, fontSize: 16, backgroundColor: avatarColor }}
            >
              {firstLetter}
            </div>
          )}

          {/* Title and subtitle */}
          <div className="flex-1 min-w-0 py-2.5">
            <p className="font-medium text-black truncate" style={{ fontSize: 17, lineHeight: "22px" }}>
              {groupTitle}
            </p>
            <p className="font-normal mt-0.5" style={{ fontSize: 15, lineHeight: "20px", color: "rgba(60,60,67,0.6)" }}>
              {messageCount > 0
                ? `Summary of ${messageCount.toLocaleString()} messages`
                : "No messages"}
            </p>
          </div>

          {/* Today button */}
          <button
            onClick={handleTodayClick}
            className="shrink-0 rounded-full font-medium text-black active:opacity-70 transition-opacity"
            style={{ fontSize: 17, lineHeight: "22px", height: 44, paddingLeft: 16, paddingRight: 16, backgroundColor: "rgba(249,54,60,0.14)" }}
          >
            Today
          </button>
        </div>
      </div>

      {/* Date Picker - Slides up/down on content scroll */}
      <div
        className="shrink-0 overflow-hidden"
        style={{
          height: isHeaderHidden ? 0 : headerHeight || "auto",
          transition: headerHeight ? "height 300ms cubic-bezier(0.25, 0.1, 0.25, 1)" : "none",
        }}
      >
        <div
          ref={headerInnerRef}
          className="pb-2"
          style={{
            transform: isHeaderHidden ? "translateY(-100%)" : "translateY(0)",
            transition: "transform 300ms cubic-bezier(0.25, 0.1, 0.25, 1)",
            opacity: isPageMounted ? 1 : 0,
          }}
        >
          <DatePicker
            availableDates={availableDates}
            selectedDate={selectedDate}
            onDateSelect={handleDateSelect}
          />
        </div>
      </div>

      {/* Content Section - Scrollable with slide animation */}
      <div
        className="flex-1 relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Sliding container wrapper - carousel with peek */}
        <div
          className="h-full relative"
          style={{
            transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
            transition: swipeX === 0 ? "transform 200ms ease-out" : "none",
          }}
        >
          {/* Previous day's content - peeking from left */}
          {prevTopics.length > 0 && !isSliding && (
            <div
              className="absolute top-0 bottom-0 px-4 pt-2 pb-8 overflow-hidden pointer-events-none"
              style={{
                width: "100%",
                right: "100%",
                marginRight: -20,
              }}
            >
              <div className="flex flex-col gap-3 opacity-60">
                {prevTopics.slice(0, 2).map((topic) => (
                  <TopicCard key={`prev-${topic.id}`} topic={topic} />
                ))}
              </div>
            </div>
          )}

          {/* Next day's content - peeking from right */}
          {nextTopics.length > 0 && !isSliding && (
            <div
              className="absolute top-0 bottom-0 px-4 pt-2 pb-8 overflow-hidden pointer-events-none"
              style={{
                width: "100%",
                left: "100%",
                marginLeft: -20,
              }}
            >
              <div className="flex flex-col gap-3 opacity-60">
                {nextTopics.slice(0, 2).map((topic) => (
                  <TopicCard key={`next-${topic.id}`} topic={topic} />
                ))}
              </div>
            </div>
          )}

          {/* Old content - slides out */}
          {isSliding && (
            <div
              className="absolute inset-0 overflow-y-auto px-4 pt-2 pb-8"
              style={{
                WebkitOverflowScrolling: "touch",
                animation:
                  slideDirection === "left"
                    ? "slideOutToLeft 180ms ease-out forwards"
                    : "slideOutToRight 180ms ease-out forwards",
              }}
            >
              {oldTopics.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {oldTopics.map((topic) => (
                    <TopicCard key={topic.id} topic={topic} />
                  ))}
                </div>
              ) : (
                <EmptyState />
              )}
              <div className="h-20 shrink-0" />
            </div>
          )}

          {/* Current content */}
          <div
            ref={scrollContainerRef}
            onScroll={handleContentScroll}
            className="h-full overflow-y-auto px-4 pt-2 pb-8"
            style={{
              WebkitOverflowScrolling: "touch",
              opacity: isPageMounted ? 1 : 0,
              transform: isSliding
                ? "translateX(0)"
                : isPageMounted
                  ? "translateX(0)"
                  : "translateY(20px)",
              transition: isSliding
                ? `transform 180ms ${EASE_OUT}`
                : isPageMounted
                  ? `all 400ms ${EASE_OUT} 150ms`
                  : "none",
              ...(isSliding && {
                animation:
                  slideDirection === "left"
                    ? "slideInFromRight 180ms ease-out forwards"
                    : "slideInFromLeft 180ms ease-out forwards",
              }),
            }}
          >
            {topics.length > 0 ? (
              <div className="flex flex-col gap-3">
                {topics.map((topic) => (
                  <TopicCard key={topic.id} topic={topic} />
                ))}
              </div>
            ) : (
              <EmptyState />
            )}

            {/* Bottom safe area padding */}
            <div className="h-20 shrink-0" />
          </div>
        </div>

        {/* CSS Keyframes for slide animations */}
        <style jsx>{`
          @keyframes slideInFromRight {
            from {
              transform: translateX(100%);
            }
            to {
              transform: translateX(0);
            }
          }
          @keyframes slideInFromLeft {
            from {
              transform: translateX(-100%);
            }
            to {
              transform: translateX(0);
            }
          }
          @keyframes slideOutToLeft {
            from {
              transform: translateX(0);
            }
            to {
              transform: translateX(-100%);
            }
          }
          @keyframes slideOutToRight {
            from {
              transform: translateX(0);
            }
            to {
              transform: translateX(100%);
            }
          }
        `}</style>
      </div>
    </main>
  );
}
