"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import {
  StaggerLine,
  StaggerReveal,
} from "@/components/wallet-workspace/facelift/stagger-reveal";

const ASSET_BASE = "/wallet-workspace/facelift";

export type FlowStep = {
  Icon: LucideIcon;
  body: string;
  title: string;
};

// Walkthrough clock: the spotlight advances every STEP_MS, dwells on the
// completed pipeline so it can be read as a whole, then fades back and loops.
const STEP_MS = 2400;
const LAST_DWELL_MS = 3600;
const RESET_MS = 500;

// Animated step diagram for the "How … works" explainer panes: each step is a
// node on a vertical pipeline, the active node lights up in sequence and the
// connector fills top-down like funds moving through it (CSS under t-flow in
// globals.css). Rows enter on the texts-reveal stagger; prefers-reduced-motion
// pins the finished all-lit state instead of cycling.
export function FlowDiagram({
  footnote,
  steps,
}: {
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

  return (
    <StaggerReveal
      className={`flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-6 pt-2 pb-6 ${
        isResetting ? "is-flow-resetting" : ""
      }`}
    >
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
                    className={`t-flow-track ${isFilled ? "is-filled" : ""}`}
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
                <p className="font-medium text-[16px] text-black leading-5">
                  {title}
                </p>
                <p className="text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                  {body}
                </p>
              </div>
            </div>
          </StaggerLine>
        );
      })}
      {footnote ? (
        <StaggerLine index={steps.length}>
          <p className="pt-5 text-[13px] leading-4 text-[rgba(60,60,67,0.45)]">
            {footnote}
          </p>
        </StaggerLine>
      ) : null}
    </StaggerReveal>
  );
}

// Fixed right pane on wide viewports — same 400px slot and card skin the
// chart column uses, so the explainer reads as part of the workspace.
export function FlowExplainerAside({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <aside className="hidden h-fit max-h-full w-[400px] shrink-0 flex-col overflow-clip rounded-3xl bg-white min-[1204px]:flex">
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-black leading-6">
          {title}
        </h2>
      </header>
      {children}
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
      sheetClassName="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-white max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
    >
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-black leading-6">
          {title}
        </h2>
        <button
          aria-label="Close info"
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
          onClick={onClose}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-cross.svg`}
          />
        </button>
      </header>
      {children}
      <div className="w-full px-4 pt-2 pb-4 min-[796px]:hidden">
        <button
          className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-[#f5f5f5] font-medium text-[16px] text-black leading-5 hover:bg-[#ececec]"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>
    </SheetReveal>
  );
}
