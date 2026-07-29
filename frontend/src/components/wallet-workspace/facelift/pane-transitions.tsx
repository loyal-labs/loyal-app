"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { readCssDurationMs } from "@/components/wallet-workspace/facelift/css-duration";

// transitions.dev "panel reveal": a root pane slides up into the region with a
// cross-blur when it mounts (boot-loader handoff; the root stays mounted under
// the action screens, so returns ride the page slide). Rendered closed,
// flipped open after a forced reflow so the transition plays; is-settled then
// clears the transform so the wrapper stops being a containing block for the
// pane's fixed overlays.
export function PaneReveal({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    void el.offsetHeight;
    el.dataset.open = "true";
    const openDur = readCssDurationMs("--panel-open-dur", 400);
    const timer = window.setTimeout(
      () => el.classList.add("is-settled"),
      openDur
    );
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className="t-panel-slide flex h-full min-w-0 flex-1 flex-col"
      data-open="false"
      ref={wrapRef}
      style={{ ["--panel-translate-y" as never]: "24px" }}
    >
      {children}
    </div>
  );
}

// transitions.dev "page side-by-side" (frontend/transitions/page-side-by-side.md):
// the root pane (page 1) and the action screens (page 2) slide between each
// other. Page 2 mounts in its exit-right state, flips in after a forced
// reflow, and unmounts once the exit completes; the settled page drops its
// transform so fixed overlays inside (mobile sheets) anchor to the viewport —
// same escape PaneReveal uses.
export function MiddlePaneSlide({
  actionPane,
  children,
}: {
  actionPane: ReactNode | null;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootPageRef = useRef<HTMLDivElement>(null);
  const actionPageRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [isActionMounted, setIsActionMounted] = useState(false);
  const lastActionPaneRef = useRef<ReactNode>(null);
  const isActionOpen = actionPane !== null;
  if (isActionOpen) {
    lastActionPaneRef.current = actionPane;
  }
  if (isActionOpen && !isActionMounted) {
    setIsActionMounted(true);
  }

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!(container && isActionMounted)) {
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // The second pane of multi-pane action screens lags by --page-stagger,
    // so settling/unmounting waits for the delayed transition too.
    const slideDur =
      readCssDurationMs("--page-slide-dur", 250) +
      readCssDurationMs("--page-stagger", 0);
    if (isActionOpen) {
      rootPageRef.current?.classList.remove("is-settled");
      void container.offsetHeight;
      container.dataset.page = "2";
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        actionPageRef.current?.classList.add("is-settled");
      }, slideDur);
      return;
    }
    actionPageRef.current?.classList.remove("is-settled");
    container.dataset.page = "1";
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      rootPageRef.current?.classList.add("is-settled");
      lastActionPaneRef.current = null;
      setIsActionMounted(false);
    }, slideDur);
  }, [isActionOpen, isActionMounted]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  return (
    <div
      className="t-page-slide flex h-full min-w-0 flex-1"
      data-page="1"
      ref={containerRef}
    >
      <div
        className="t-page is-settled flex min-w-0 flex-1"
        data-page-id="1"
        ref={rootPageRef}
      >
        {/* Plain inner wrapper receives the child-motion styles so they
            never collide with PaneReveal's own t-panel-slide transform. */}
        <div className="flex min-w-0 flex-1">{children}</div>
      </div>
      {isActionMounted ? (
        // gap-2 restores the shell row's gap for the action panes' sibling
        // sections (withdraw/autodeposit render two panes themselves).
        <div
          className="t-page flex gap-2 max-[795px]:gap-0"
          data-page-id="2"
          ref={actionPageRef}
        >
          {isActionOpen ? actionPane : lastActionPaneRef.current}
        </div>
      ) : null}
    </div>
  );
}
