"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

export type DatePickerProps = {
  /** Dates that have summaries available (ISO date strings: YYYY-MM-DD) */
  availableDates: string[];
  /** Currently selected date (ISO date string: YYYY-MM-DD) */
  selectedDate: string;
  /** Callback when date is selected */
  onDateSelect: (date: string) => void;
};

// Get 3-letter uppercase month abbreviation from date string
function getMonthAbbr(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

// Get month index (YYYY-MM) from date string
function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7);
}

// Get day number from date string
function getDayNumber(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDate();
}

// Get today's date key
function getTodayKey(): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return today.toISOString().split("T")[0];
}

// Generate array of dates: past N days + future M days
function generateDateRange(pastDays: number, futureDays: number = 7): string[] {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  for (let i = pastDays - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split("T")[0]);
  }

  for (let i = 1; i <= futureDays; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    dates.push(date.toISOString().split("T")[0]);
  }

  return dates;
}

// Check if a date is in the future (strictly after today)
function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr + "T00:00:00");
  return date > today;
}

export default function DatePicker({
  availableDates,
  selectedDate,
  onDateSelect,
}: DatePickerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const availableDateSet = useMemo(() => new Set(availableDates), [availableDates]);
  const todayKey = getTodayKey();

  const latestDateWithData = useMemo(() => {
    const validDates = availableDates.filter(d => !isFutureDate(d));
    if (validDates.length === 0) return new Date().toISOString().split("T")[0];
    return validDates.sort().pop()!;
  }, [availableDates]);

  const dates = useMemo(() => generateDateRange(30, 7), []);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollLeftRef = useRef(0);
  const lastCenteredDateRef = useRef<string | null>(null);

  const selectedMonthKey = getMonthKey(selectedDate);

  // Determine which dates should show month labels
  // Selected month label travels with the selected date
  // Earlier months show label on their LAST date (near boundary)
  // Later months show label on their FIRST date (near boundary)
  const monthLabelDates = useMemo(() => {
    const labels = new Map<string, string>(); // date -> month abbreviation
    const monthGroups = new Map<string, string[]>(); // monthKey -> dates[]

    for (const date of dates) {
      const monthKey = getMonthKey(date);
      if (!monthGroups.has(monthKey)) {
        monthGroups.set(monthKey, []);
      }
      monthGroups.get(monthKey)!.push(date);
    }

    for (const [monthKey, monthDates] of monthGroups) {
      if (monthKey === selectedMonthKey) {
        labels.set(selectedDate, getMonthAbbr(selectedDate));
      } else if (monthKey < selectedMonthKey) {
        // Months before: label on last date (nearest to boundary)
        const lastDate = monthDates[monthDates.length - 1];
        labels.set(lastDate, getMonthAbbr(lastDate));
      } else {
        // Months after: label on first date (nearest to boundary)
        labels.set(monthDates[0], getMonthAbbr(monthDates[0]));
      }
    }

    return labels;
  }, [dates, selectedDate, selectedMonthKey]);

  // Scroll to selected date on mount and when selection changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    const selectedElement = itemRefs.current.get(selectedDate);

    if (container && selectedElement) {
      const containerWidth = container.offsetWidth;
      const elementLeft = selectedElement.offsetLeft;
      const elementWidth = selectedElement.offsetWidth;
      const scrollLeft = elementLeft - containerWidth / 2 + elementWidth / 2;

      container.scrollTo({
        left: scrollLeft,
        behavior: "smooth",
      });
    }
  }, [selectedDate]);

  const handleDateClick = useCallback(
    (date: string) => {
      const hasData = availableDateSet.has(date);
      const isFuture = isFutureDate(date);
      const isToday = date === todayKey;

      // Allow today even without data; block future dates and past dates without data
      if (isFuture || (!hasData && !isToday)) {
        if (hapticFeedback.notificationOccurred.isAvailable()) {
          hapticFeedback.notificationOccurred("error");
        }
        return;
      }

      if (date === selectedDate) {
        return;
      }

      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }
      onDateSelect(date);
    },
    [availableDateSet, selectedDate, onDateSelect, todayKey]
  );

  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    const container = scrollContainerRef.current;
    if (!container) return;

    const currentScrollLeft = container.scrollLeft;
    const scrollDirection = currentScrollLeft > lastScrollLeftRef.current ? 1 : -1;
    lastScrollLeftRef.current = currentScrollLeft;

    const containerCenter = currentScrollLeft + container.offsetWidth / 2;
    let closestDate: string | null = null;
    let closestDistance = Infinity;

    itemRefs.current.forEach((element, date) => {
      const elementCenter = element.offsetLeft + element.offsetWidth / 2;
      const distance = Math.abs(elementCenter - containerCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestDate = date;
      }
    });

    if (closestDate && closestDate !== lastCenteredDateRef.current && closestDistance < 28) {
      lastCenteredDateRef.current = closestDate;
      if (hapticFeedback.selectionChanged.isAvailable()) {
        hapticFeedback.selectionChanged();
      }
    }

    isScrollingRef.current = true;

    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
      if (!container) return;

      const containerCenter = container.scrollLeft + container.offsetWidth / 2;

      const datesWithPositions: Array<{
        date: string;
        center: number;
        hasData: boolean;
        isFuture: boolean;
        isToday: boolean;
      }> = [];

      itemRefs.current.forEach((element, date) => {
        const elementCenter = element.offsetLeft + element.offsetWidth / 2;
        datesWithPositions.push({
          date,
          center: elementCenter,
          hasData: availableDateSet.has(date),
          isFuture: isFutureDate(date),
          isToday: date === todayKey,
        });
      });

      datesWithPositions.sort((a, b) => a.center - b.center);

      let targetDate: string | null = null;
      const isSelectable = (item: typeof datesWithPositions[0]) =>
        !item.isFuture && (item.hasData || item.isToday);

      if (scrollDirection >= 0) {
        for (const item of datesWithPositions) {
          if (isSelectable(item) && item.center >= containerCenter - 28) {
            targetDate = item.date;
            break;
          }
        }
        if (!targetDate) {
          for (let i = datesWithPositions.length - 1; i >= 0; i--) {
            if (isSelectable(datesWithPositions[i])) {
              targetDate = datesWithPositions[i].date;
              break;
            }
          }
        }
      } else {
        for (let i = datesWithPositions.length - 1; i >= 0; i--) {
          const item = datesWithPositions[i];
          if (isSelectable(item) && item.center <= containerCenter + 28) {
            targetDate = item.date;
            break;
          }
        }
        if (!targetDate) {
          for (const item of datesWithPositions) {
            if (isSelectable(item)) {
              targetDate = item.date;
              break;
            }
          }
        }
      }

      if (targetDate && targetDate !== selectedDate) {
        if (hapticFeedback.selectionChanged.isAvailable()) {
          hapticFeedback.selectionChanged();
        }
        onDateSelect(targetDate);
      } else if (targetDate) {
        const element = itemRefs.current.get(targetDate);
        if (element) {
          const elementCenter = element.offsetLeft + element.offsetWidth / 2;
          const targetScrollLeft = elementCenter - container.offsetWidth / 2;
          container.scrollTo({ left: targetScrollLeft, behavior: "smooth" });
        }
      }
    }, 80);
  }, [availableDateSet, selectedDate, onDateSelect, todayKey]);

  const setItemRef = useCallback(
    (date: string) => (el: HTMLDivElement | null) => {
      if (el) {
        itemRefs.current.set(date, el);
      } else {
        itemRefs.current.delete(date);
      }
    },
    []
  );

  return (
    <div className="flex flex-col items-center w-full overflow-hidden">
      <div className="relative w-full">
        {/* Left fade gradient */}
        <div
          className="absolute left-0 top-0 bottom-0 w-9 z-10 pointer-events-none"
          style={{
            background: "linear-gradient(to right, #fff, rgba(255, 255, 255, 0))",
          }}
        />

        {/* Right fade gradient */}
        <div
          className="absolute right-0 top-0 bottom-0 w-9 z-10 pointer-events-none"
          style={{
            background: "linear-gradient(to left, #fff, rgba(255, 255, 255, 0))",
          }}
        />

        {/* Scrollable container */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex items-end overflow-x-auto scrollbar-none pt-5"
          style={{
            scrollSnapType: "x mandatory",
            scrollBehavior: "smooth",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            // @ts-expect-error - WebKit specific property
            WebkitScrollDecelerationRate: "fast",
          }}
        >
          {/* Left padding for centering first item */}
          <div className="shrink-0 w-[calc(50%-28px)]" />

          {dates.map((date) => {
            const isSelected = date === selectedDate;
            const hasData = availableDateSet.has(date);
            const isFuture = isFutureDate(date);
            const isToday = date === todayKey;
            const isSelectable = !isFuture && (hasData || isToday);
            const isPastLatestWithData = date > latestDateWithData && !isToday;
            const monthLabel = monthLabelDates.get(date);
            const showMonthLabel = !!monthLabel;
            const dateMonthKey = getMonthKey(date);
            const isActiveMonth = dateMonthKey === selectedMonthKey;

            // Future placeholder dates (past latest with data, not today)
            if (isPastLatestWithData && !isToday) {
              return (
                <div
                  key={date}
                  className="shrink-0 flex flex-col items-center relative"
                  style={{ width: 56 }}
                >
                  {/* Month label */}
                  {showMonthLabel && (
                    <span
                      className="absolute font-medium leading-4 text-[13px]"
                      style={{
                        top: -20,
                        color: isActiveMonth ? "#000" : "rgba(60,60,67,0.6)",
                      }}
                    >
                      {monthLabel}
                    </span>
                  )}
                  <div className="flex items-center justify-center" style={{ height: 40, padding: 9 }}>
                    <div className="flex items-center justify-center rounded-full" style={{ width: 40, height: 40 }}>
                      <span
                        className="font-medium leading-[22px] text-[17px] text-center"
                        style={{ color: "rgba(60,60,67,0.3)" }}
                      >
                        {getDayNumber(date)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={date}
                ref={setItemRef(date)}
                className="shrink-0 flex flex-col items-center relative"
                style={{ width: 56, scrollSnapAlign: "center", scrollSnapStop: "always" }}
              >
                {/* Month label */}
                {showMonthLabel && (
                  <span
                    className="absolute font-medium leading-4 text-[13px]"
                    style={{
                      top: -20,
                      color: isActiveMonth ? "#000" : "rgba(60,60,67,0.6)",
                    }}
                  >
                    {monthLabel}
                  </span>
                )}
                {/* Date button */}
                <button
                  onClick={() => handleDateClick(date)}
                  disabled={!isSelectable}
                  className="flex items-center justify-center"
                  style={{ width: 56, height: 40 }}
                >
                  <div
                    className="flex items-center justify-center rounded-full"
                    style={{
                      width: 40,
                      height: 40,
                      backgroundColor: isSelected
                        ? "rgba(249,54,60,0.14)"
                        : "transparent",
                    }}
                  >
                    <span
                      className="font-medium leading-[22px] text-[17px] text-center"
                      style={{
                        color: isSelected
                          ? "#000"
                          : isSelectable
                            ? "rgba(60,60,67,0.6)"
                            : "rgba(60,60,67,0.3)",
                      }}
                    >
                      {getDayNumber(date)}
                    </span>
                  </div>

                  {/* Red dot badge for dates with data (including selected) */}
                  {hasData && !isFuture && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 flex items-center justify-center" style={{ width: 16, height: 16 }}>
                      <div className="rounded-full bg-[#f9363c]" style={{ width: 4, height: 4 }} />
                    </div>
                  )}
                </button>
              </div>
            );
          })}

          {/* Right padding for centering last item */}
          <div className="shrink-0 w-[calc(50%-28px)]" />
        </div>
      </div>
    </div>
  );
}
