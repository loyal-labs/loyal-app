"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// transitions.dev "tabs sliding": the active pill slides between options;
// JS writes offsetLeft/offsetWidth, globals.css owns the tween.
export function SlidingTabs<T extends string>({
  activeTab,
  onSelect,
  tabs,
}: {
  activeTab: T;
  onSelect: (tab: T) => void;
  tabs: readonly T[];
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const hasPainted = useRef(false);

  const movePillToActiveTab = useCallback((animate: boolean) => {
    const bar = barRef.current;
    const pill = pillRef.current;
    const active = bar?.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]'
    );
    if (!(bar && pill && active)) {
      return;
    }
    if (animate) {
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      pill.style.width = `${active.offsetWidth}px`;
      return;
    }
    const previousTransition = pill.style.transition;
    pill.style.transition = "none";
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    pill.style.width = `${active.offsetWidth}px`;
    void pill.offsetWidth;
    pill.style.transition = previousTransition;
  }, []);

  // Re-measure when the tab set changes too (Earned appears with a position).
  useLayoutEffect(() => {
    movePillToActiveTab(hasPainted.current);
    hasPainted.current = true;
  }, [activeTab, movePillToActiveTab, tabs.length]);

  useEffect(() => {
    const handleResize = () => movePillToActiveTab(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [movePillToActiveTab]);

  return (
    <div className="t-tabs" ref={barRef} role="tablist">
      <span aria-hidden="true" className="t-tabs-pill" ref={pillRef} />
      {tabs.map((tab) => (
        <button
          aria-selected={activeTab === tab}
          className="t-tab whitespace-nowrap font-medium text-[14px] leading-5"
          key={tab}
          onClick={() => onSelect(tab)}
          role="tab"
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
