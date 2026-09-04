"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { EarnStatsPanel } from "@/components/wallet-workspace/facelift/earn-stats-panel";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import {
  StaggerLine,
  StaggerReveal,
} from "@/components/wallet-workspace/facelift/stagger-reveal";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

export type FlowStep = {
  Icon: LucideIcon;
  body: string;
  title: string;
};

// Walkthrough clock: the spotlight advances every STEP_MS, dwells on the
// completed pipeline so it can be read as a whole, then fades back and loops.
const STEP_MS = 1300;
const LAST_DWELL_MS = 2000;
const RESET_MS = 500;

// Animated step diagram for the "How … works" explainer panes: each step is a
// node on a vertical pipeline, the active node lights up in sequence and the
// connector fills top-down like funds moving through it (CSS under t-flow in
// globals.css). Rows enter on the texts-reveal stagger; prefers-reduced-motion
// pins the finished all-lit state instead of cycling.
export function FlowDiagram({
  docsHref,
  footnote,
  steps,
}: {
  docsHref?: string;
  footnote?: string;
  steps: readonly FlowStep[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const [isStatic, setIsStatic] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsStatic(true);
    }
  }, []);

  useEffect(() => {
    if (isStatic) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        if (isResetting) {
          setIsResetting(false);
          setActiveIndex(0);
          return;
        }
        if (activeIndex >= steps.length - 1) {
          setIsResetting(true);
          setActiveIndex(-1);
          return;
        }
        setActiveIndex(activeIndex + 1);
      },
      isResetting
        ? RESET_MS
        : activeIndex === steps.length - 1
        ? LAST_DWELL_MS
        : STEP_MS
    );
    return () => window.clearTimeout(timer);
  }, [activeIndex, isResetting, isStatic, steps.length]);

  // The reset class lives on the per-row tracks, never on StaggerReveal's
  // className: StaggerReveal adds is-shown imperatively, so a changing
  // className prop would make React rewrite the attribute and wipe it —
  // hiding the whole diagram.
  return (
    <StaggerReveal className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-6 pt-2 pb-6">
      {steps.map(({ Icon, body, title }, index) => {
        const isLast = index === steps.length - 1;
        const isReached = isStatic || index <= activeIndex;
        const isActive = !isStatic && index === activeIndex;
        const isFilled = isStatic || index < activeIndex;
        return (
          <StaggerLine index={index} key={title}>
            <div className="flex w-full gap-3.5">
              <div className="flex shrink-0 flex-col items-center">
                <span
                  className={`t-flow-node flex size-11 shrink-0 items-center justify-center rounded-full ${
                    isReached ? "is-reached" : ""
                  } ${isActive ? "is-active" : ""}`}
                >
                  <Icon size={24} strokeWidth={2} />
                </span>
                {isLast ? null : (
                  <span
                    aria-hidden="true"
                    className={`t-flow-track ${isFilled ? "is-filled" : ""} ${
                      isResetting ? "is-resetting" : ""
                    }`}
                  >
                    <span className="t-flow-fill" />
                  </span>
                )}
              </div>
              <div
                className={`flex min-w-0 flex-1 flex-col gap-1 pt-0.5 ${
                  isLast ? "" : "pb-5"
                }`}
              >
                <p className="font-medium text-[16px] text-foreground leading-5">
                  {title}
                </p>
                <p className="text-[13px] leading-4 text-muted-foreground">
                  {body}
                </p>
              </div>
            </div>
          </StaggerLine>
        );
      })}
      {footnote ? (
        <StaggerLine index={steps.length}>
          <p className="pt-5 text-[13px] leading-4 text-tertiary">
            {footnote}
          </p>
        </StaggerLine>
      ) : null}
      {docsHref ? (
        <StaggerLine index={steps.length + (footnote ? 1 : 0)}>
          <a
            className="t-hover mt-5 inline-block font-medium text-[13px] leading-4 text-muted-foreground hover:text-foreground"
            href={docsHref}
            rel="noreferrer"
            target="_blank"
          >
            Learn more in the docs ↗
          </a>
        </StaggerLine>
      ) : null}
    </StaggerReveal>
  );
}

// Fixed right pane on wide viewports — the same scrollable 400px column the
// root chart pane uses, holding the explainer card with the protocol stats
// card below it (ASK-2047), so the action screens read as part of the
// workspace.
export function FlowExplainerAside({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <aside className="hidden h-full w-[400px] shrink-0 flex-col gap-2 overflow-y-auto [scrollbar-width:none] min-[1204px]:flex [&::-webkit-scrollbar]:hidden">
      <section className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-card">
        <header className="flex w-full items-center p-2">
          <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-foreground leading-6">
            {title}
          </h2>
        </header>
        {children}
      </section>
      <EarnStatsPanel />
    </aside>
  );
}

// Below 1204px the explainer opens from the header "?" as an overlay: card
// next to the sidebar on desktop widths, bottom sheet on mobile — rising on
// the panel-reveal clock like a native sheet.
export function FlowExplainerOverlay({
  children,
  isOpen,
  onClose,
  title,
}: {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  title: string;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <SheetReveal
      isOpen={isOpen}
      onClose={onClose}
      scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 pl-[368px] backdrop-blur-[4px] min-[1204px]:hidden max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8"
      sheetClassName="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
    >
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-foreground leading-6">
          {title}
        </h2>
        <button
          aria-label="Close info"
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent"
          onClick={onClose}
          type="button"
        >
          <ThemedIcon
            className="size-6 text-muted-foreground"
            src={`${ASSET_BASE}/icon-cross.svg`}
          />
        </button>
      </header>
      {children}
      <div className="w-full px-4 pt-2 pb-4 min-[796px]:hidden">
        <button
          className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-secondary font-medium text-[16px] text-foreground leading-5 hover:bg-accent-active"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>
    </SheetReveal>
  );
}
