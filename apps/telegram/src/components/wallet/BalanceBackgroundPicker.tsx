"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Ban, X } from "lucide-react";
import Image from "next/image";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";
import {
  hideMainButton,
  hideSecondaryButton,
  showMainButton,
} from "@/lib/telegram/mini-app/buttons";

type BgOption = {
  id: string | null;
  src: string | null;
  thumb: string | null;
};

const BG_OPTIONS: BgOption[] = [
  {
    id: "balance-bg-01",
    src: "/bgs/balance-bg-01.png",
    thumb: "/bgs/previews/balance-bg-01-thumb.png",
  },
  {
    id: "balance-bg-02",
    src: "/bgs/balance-bg-02.png",
    thumb: "/bgs/previews/balance-bg-02-thumb.png",
  },
  {
    id: "balance-bg-03",
    src: "/bgs/balance-bg-03.png",
    thumb: "/bgs/previews/balance-bg-03-thumb.png",
  },
  {
    id: "balance-bg-04",
    src: "/bgs/balance-bg-04.png",
    thumb: "/bgs/previews/balance-bg-04-thumb.png",
  },
  {
    id: "balance-bg-05",
    src: "/bgs/balance-bg-05.png",
    thumb: "/bgs/previews/balance-bg-05-thumb.png",
  },
  { id: null, src: null, thumb: null },
];

const THUMB_SIZE = 72;
const THUMB_HALF = THUMB_SIZE / 2;
const RING_SIZE = 78;

const SHEET_TRANSITION = "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)";
const OVERLAY_TRANSITION = "opacity 0.3s ease";

export type BalanceBackgroundPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedBg: string | null;
  onSelect: (bg: string | null) => void;
  children: (previewBg: string | null) => ReactNode;
};

export default function BalanceBackgroundPicker({
  open,
  onOpenChange,
  selectedBg,
  onSelect,
  children,
}: BalanceBackgroundPickerProps) {
  const { bottom: safeBottom } = useTelegramSafeArea();
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [show, setShow] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const isDragging = useRef(false);
  const isClosing = useRef(false);

  const [previewBg, setPreviewBg] = useState<string | null>(selectedBg);
  const previewBgRef = useRef<string | null>(previewBg);
  const confirmedBgRef = useRef<string | null | undefined>(undefined);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCenteredRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Open: mount elements, force layout, then trigger CSS transition
  useEffect(() => {
    if (open) {
      isClosing.current = false;
      setPreviewBg(selectedBg);
      lastCenteredRef.current = null;
      setRendered(true);
    }
  }, [open, selectedBg]);

  useEffect(() => {
    if (rendered && open && !show && !isClosing.current) {
      sheetRef.current?.getBoundingClientRect();
      setShow(true);
    }
  }, [rendered, open, show]);

  // Measure header
  useEffect(() => {
    if (!open) return;
    const header = document.querySelector("header");
    if (header) {
      setHeaderHeight(header.getBoundingClientRect().bottom);
    }
  }, [open]);

  // Keep preview ref in sync so button onClick always reads the latest value
  useEffect(() => {
    previewBgRef.current = previewBg;
  }, [previewBg]);

  // Telegram Main Button — shown/hidden only by open+show, not by previewBg.
  // Using previewBgRef avoids teardown+recreate on every scroll, which caused
  // the "Done" button to flicker/disappear on slower Android devices.
  useEffect(() => {
    if (!open || !show) return;
    hideSecondaryButton();
    showMainButton({
      text: "Done",
      onClick: () => {
        confirmedBgRef.current = previewBgRef.current;
        closeSheet();
      },
    });
    return () => {
      hideMainButton();
      hideSecondaryButton();
    };
  }, [open, show]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to initial selection on open
  useEffect(() => {
    if (!open || !show) return;
    const idx = BG_OPTIONS.findIndex((o) => o.id === selectedBg);
    if (idx === -1) return;

    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const el = itemRefs.current.get(idx);
      if (!container || !el) return;

      const scrollLeft =
        el.offsetLeft - container.offsetWidth / 2 + el.offsetWidth / 2;
      container.scrollTo({ left: scrollLeft, behavior: "instant" });
      lastCenteredRef.current = idx;
    });
  }, [open, show, selectedBg]);

  // Lock body scroll
  useEffect(() => {
    if (rendered) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [rendered]);

  const unmount = useCallback(() => {
    hideMainButton();
    hideSecondaryButton();
    const confirmedBg = confirmedBgRef.current;
    confirmedBgRef.current = undefined;
    setRendered(false);
    setShow(false);
    onOpenChange(false);
    isClosing.current = false;
    if (confirmedBg !== undefined) {
      onSelect(confirmedBg);
    }
  }, [onOpenChange, onSelect]);

  const closeSheet = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    hideMainButton();
    hideSecondaryButton();
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (sheetRef.current) {
      sheetRef.current.style.transition = SHEET_TRANSITION;
      sheetRef.current.style.transform = "translateY(100%)";
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = OVERLAY_TRANSITION;
      overlayRef.current.style.opacity = "0";
    }
  }, []);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.propertyName === "transform" && isClosing.current) {
        unmount();
      }
    },
    [unmount],
  );

  // Pull-down-to-close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    dragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    dragDelta.current = Math.max(0, delta);
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dragDelta.current}px)`;
    }
    if (overlayRef.current) {
      const opacity = Math.max(0.2, 1 - dragDelta.current / 300);
      overlayRef.current.style.opacity = String(opacity);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragDelta.current > 120) {
      closeSheet();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transition = SHEET_TRANSITION;
        sheetRef.current.style.transform = "translateY(0px)";
      }
      if (overlayRef.current) {
        overlayRef.current.style.transition = OVERLAY_TRANSITION;
        overlayRef.current.style.opacity = "1";
      }
    }
    dragDelta.current = 0;
  }, [closeSheet]);

  const setItemRef = useCallback(
    (idx: number) => (el: HTMLDivElement | null) => {
      if (el) {
        itemRefs.current.set(idx, el);
      } else {
        itemRefs.current.delete(idx);
      }
    },
    [],
  );

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      const containerCenter =
        container.scrollLeft + container.offsetWidth / 2;

      let closestIdx = 0;
      let closestDist = Infinity;

      itemRefs.current.forEach((el, idx) => {
        const elCenter = el.offsetLeft + el.offsetWidth / 2;
        const dist = Math.abs(elCenter - containerCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      });

      if (closestIdx !== lastCenteredRef.current) {
        lastCenteredRef.current = closestIdx;
        const option = BG_OPTIONS[closestIdx];
        setPreviewBg(option.id);

        if (hapticFeedback.selectionChanged.isAvailable()) {
          hapticFeedback.selectionChanged();
        }
      }
    }, 80);
  }, []);

  const handleThumbClick = useCallback((idx: number) => {
    const container = scrollContainerRef.current;
    const el = itemRefs.current.get(idx);
    if (!container || !el) return;

    const scrollLeft =
      el.offsetLeft - container.offsetWidth / 2 + el.offsetWidth / 2;
    container.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }, []);

  if (!mounted || !rendered) return null;

  const sheetTopOffset = headerHeight || 56;

  const content = (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={closeSheet}
        className="fixed inset-0 z-[9998]"
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          opacity: show ? 1 : 0,
          transition: OVERLAY_TRANSITION,
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onTransitionEnd={handleTransitionEnd}
        className="fixed left-0 right-0 bottom-0 z-[9999] flex flex-col bg-white rounded-t-[38px] font-sans max-w-md mx-auto"
        style={{
          top: sheetTopOffset,
          transform: show ? "translateY(0)" : "translateY(100%)",
          transition: SHEET_TRANSITION,
          boxShadow: "0px -4px 40px rgba(0, 0, 0, 0.08)",
        }}
      >
        {/* Handle bar */}
        <div
          className="flex justify-center pt-2 pb-1 shrink-0 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="w-9 h-1 rounded-full"
            style={{ background: "rgba(0, 0, 0, 0.15)" }}
          />
        </div>

        {/* Header */}
        <div
          className="relative h-[44px] flex items-center justify-center shrink-0 px-4"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <span className="text-[17px] font-semibold text-black leading-[22px]">
            Choose your style
          </span>

          <button
            onClick={closeSheet}
            className="absolute right-3 w-[30px] h-[30px] rounded-full flex items-center justify-center active:scale-95 transition-all duration-150"
            style={{ background: "rgba(0, 0, 0, 0.06)" }}
          >
            <X
              size={20}
              strokeWidth={2}
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            />
          </button>
        </div>

        {/* Content */}
        <div
          className="flex-1 flex flex-col overflow-hidden"
          style={{ paddingBottom: Math.max(safeBottom, 24) + 80 }}
        >
          {/* Preview Card */}
          <div className="px-4 pt-2 pb-6">
            <div
              className="relative w-full overflow-hidden rounded-[26px]"
              style={{
                border: "2px solid rgba(255, 255, 255, 0.1)",
                aspectRatio: "361 / 203",
              }}
            >
              {/* Background layers */}
              <div
                className="absolute inset-0 rounded-[26px]"
                style={{ background: "#f2f2f7" }}
              />
              {previewBg && (
                <Image
                  src={`/bgs/${previewBg}.png`}
                  alt=""
                  fill
                  className="object-cover rounded-[26px]"
                  priority
                />
              )}
              <div
                className="absolute inset-0 rounded-[26px] pointer-events-none"
                style={{
                  boxShadow:
                    "inset 0px 0px 36px 0px rgba(255, 255, 255, 0.4)",
                }}
              />
              {/* Card content from parent */}
              <div className="relative flex flex-col justify-between h-full p-4">
                {children(previewBg)}
              </div>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Thumbnail Scroll with fixed center ring */}
          <div className="pb-4">
            <div className="relative">
              {/* Fixed center selection ring */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none z-10"
                style={{
                  width: RING_SIZE,
                  height: RING_SIZE,
                  border: "3px solid rgba(0, 0, 0, 0.15)",
                }}
              />

              <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex items-center overflow-x-auto h-[88px] hide-scrollbar"
                style={{
                  scrollSnapType: "x mandatory",
                  WebkitOverflowScrolling: "touch",
                  scrollbarWidth: "none",
                }}
              >
                {/* Left padding for centering */}
                <div
                  className="shrink-0"
                  style={{ width: `calc(50% - ${THUMB_HALF}px)` }}
                />

                {BG_OPTIONS.map((option, idx) => (
                  <div
                    key={option.id ?? "none"}
                    ref={setItemRef(idx)}
                    onClick={() => handleThumbClick(idx)}
                    className="shrink-0 flex items-center justify-center mx-2 cursor-pointer"
                    style={{
                      width: THUMB_SIZE,
                      height: THUMB_SIZE,
                      scrollSnapAlign: "center",
                      scrollSnapStop: "always",
                    }}
                  >
                    {option.thumb ? (
                      <div className="w-full h-full rounded-full overflow-hidden relative">
                        <Image
                          src={option.thumb}
                          alt=""
                          fill
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <div
                        className="w-full h-full rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0, 0, 0, 0.05)" }}
                      >
                        <Ban
                          size={28}
                          strokeWidth={1.5}
                          className="text-black/30"
                        />
                      </div>
                    )}
                  </div>
                ))}

                {/* Right padding for centering */}
                <div
                  className="shrink-0"
                  style={{ width: `calc(50% - ${THUMB_HALF}px)` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
