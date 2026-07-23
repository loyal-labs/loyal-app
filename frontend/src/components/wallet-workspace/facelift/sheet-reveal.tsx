"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { readCssDurationMs } from "@/components/wallet-workspace/facelift/css-duration";

// transitions.dev "panel reveal" (frontend/transitions/panel-reveal.md) as
// the sheet/overlay motion: the surface rises into view on the panel clock —
// the scrim cross-fading on the same clock — and slides back down before
// unmounting. Runs on the keyframe mechanism (data-state flips, fill-mode
// both) exactly like the expanded-chart overlay: keyframes play whenever the
// selector matches, so the close can't be starved the way the transition
// form was. Mounting with data-state="open" plays the entrance on insertion.
export function SheetReveal({
  children,
  isOpen,
  onClose,
  scrimClassName,
  sheetClassName,
}: {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  scrimClassName: string;
  sheetClassName: string;
}) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  if (isOpen && !isMounted) {
    setIsMounted(true);
  }

  useLayoutEffect(() => {
    const scrim = scrimRef.current;
    const sheet = sheetRef.current;
    if (!(scrim && sheet)) {
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isOpen) {
      // No-op on first mount (JSX renders "open"); flips a mid-close reopen
      // back to the entrance animation.
      scrim.dataset.state = "open";
      sheet.dataset.state = "open";
      return;
    }
    scrim.dataset.state = "closed";
    sheet.dataset.state = "closed";
    const closeDur = readCssDurationMs("--panel-close-dur", 350);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setIsMounted(false);
    }, closeDur);
  }, [isOpen, isMounted]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  if (!isMounted) {
    return null;
  }
  // Portaled to <body>: the call sites live inside the page-slide wrappers,
  // whose child-motion rules and mid-slide transforms would interfere with a
  // fixed overlay — the chart overlay lives outside that subtree, and this
  // puts the sheets in the same position. isMounted is only ever set on the
  // client, so document is always defined here.
  return createPortal(
    <div
      className={`t-sheet-scrim ${scrimClassName}`}
      data-state="open"
      onClick={onClose}
      ref={scrimRef}
    >
      <div
        aria-modal="true"
        className={`t-sheet-panel ${sheetClassName}`}
        data-state="open"
        onClick={(event) => event.stopPropagation()}
        ref={sheetRef}
        role="dialog"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
